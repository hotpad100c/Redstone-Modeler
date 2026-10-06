import { deflateSync, strFromU8, strToU8, unzipSync, zipSync } from "../../lib/fflate.module.js";
import { serialize } from "../model/Save.mjs";
import { repack_atlas } from "../pack/Atlas.mjs";
import { select_models_layered } from "../pack/BlockStates.mjs";
import { model_ids } from "../pack/Compiler.mjs";
import { normalize_id } from "../pack/PackStack.mjs";
import { read_rmpack, write_rmpack } from "../pack/Rmpack.mjs";
import { MISSING } from "../render/BlockMesher.mjs";

/** Start of a share code; tells it apart from the code of a save, which only holds the blocks. */
export const SHARE_PREFIX = "RMS1.";
/** Longest message of most chat services */
export const CHAT_LIMIT = 2000;

const MAX_CODE_LENGTH = 64_000_000;
const SHARED_SUFFIX = " (shared)";

/**
 * The block states a model uses, with every property filled in.
 * @param {import("../model/World.mjs").World} world
 * @param {import("../pack/CompiledPack.mjs").CompiledPack} pack
 * @returns {Map<string, Map<string, Record<string, string>>>} Block id to its states by key
 */
export function used_states(world, pack) {
    const used = new Map();
    for (const [, , , block] of world.entries()) {
        if (!pack.data.blockstates[block.name]) {
            continue;
        }
        const properties = pack.properties(block.name);
        const state = Object.fromEntries(Object.entries(properties).map(([prop, values]) => [prop, block.props[prop] ?? values[0]]));
        if (!used.has(block.name)) {
            used.set(block.name, new Map());
        }
        used.get(block.name).set(JSON.stringify(Object.values(state)), state);
    }
    return used;
}

/**
 * Everything a small resource pack needs for the blocks of a model, except the picture.
 * @param {import("../pack/CompiledPack.mjs").CompiledPack} pack
 * @param {ReturnType<typeof used_states>} used
 * @param {object} options
 * @param {"used"|"all"} options.scope `used`: only the states that are placed, `all`: every state of the blocks that are placed
 * @param {string[]} options.languages Language codes to take the block names of
 * @returns {{data: object, texture_ids: string[], lang: Record<string, Record<string, string>>}}
 */
export function build_mini_data(pack, used, { scope, languages }) {
    const blockstates = {};
    const index = {};
    const wanted_models = new Set();

    for (const [name, states] of used) {
        const defs = pack.data.blockstates[name];
        const properties = pack.properties(name);
        if (scope === "all") {
            blockstates[name] = defs;
            index[name] = properties;
            defs.flatMap(model_ids).forEach(id => wanted_models.add(normalize_id(id)));
            continue;
        }
        // One condition per placed state, with the models the layered packs pick for it
        const parts = [];
        const values = Object.fromEntries(Object.keys(properties).map(prop => [prop, new Set()]));
        for (const state of states.values()) {
            for (const prop of Object.keys(properties)) {
                values[prop].add(state[prop]);
            }
            for (const variant of select_models_layered(defs, state) ?? []) {
                const apply = { model: normalize_id(variant.model) };
                if (variant.x) {
                    apply.x = variant.x;
                }
                if (variant.y) {
                    apply.y = variant.y;
                }
                if (variant.uvlock) {
                    apply.uvlock = true;
                }
                parts.push({ when: { ...state }, apply });
                wanted_models.add(apply.model);
            }
        }
        blockstates[name] = [{ multipart: parts }];
        index[name] = Object.fromEntries(Object.entries(properties).map(([prop, list]) => [prop, list.filter(v => values[prop].has(v))]));
    }

    const models = {};
    const textures = new Set([MISSING]);
    for (const id of wanted_models) {
        const model = pack.data.models[id];
        if (model) {
            models[id] = model;
            for (const element of model.elements) {
                for (const face of Object.values(element.faces)) {
                    if (face.texture) {
                        textures.add(face.texture);
                    }
                }
            }
            if (model.particle) {
                textures.add(model.particle);
            }
        }
    }

    const lang = {};
    const language_list = [];
    for (const code of new Set(languages.filter(Boolean))) {
        const all = pack.lang_names(code);
        if (all) {
            lang[code] = Object.fromEntries([...used.keys()].filter(id => all[id]).map(id => [id, all[id]]));
            language_list.push(pack.languages.find(l => l.code === code) ?? { code, name: "", region: "" });
        }
    }

    const data = {
        name: `${pack.name.replace(/ \(shared\)$/, "")}${SHARED_SUFFIX}`,
        created: Date.now(),
        sources: [pack.name],
        atlas: null,
        index,
        blockstates,
        models,
        languages: language_list,
        tint_colors: pack.tint_colors(),
        shared: true,
    };
    return { data, texture_ids: [...textures].sort(), lang };
}

/** Size of some bytes once compressed, for telling where the size of a share goes. */
function packed_size(bytes) {
    return deflateSync(bytes, { level: 9 }).length;
}

/**
 * @typedef {object} Exported
 * @property {Uint8Array} bytes The `.rmmodel` file
 * @property {string} code The same as a share code
 * @property {{blocks: number, models: number, textures: number, bytes: number, code_length: number,
 *   parts: {models: number, pictures: number, names: number, model: number}}} stats
 */

/**
 * Packs the model with the resources it needs.
 * @param {import("../render/Resources.mjs").Resources} resources
 * @param {import("../model/World.mjs").World} world
 * @param {object} options
 * @param {"used"|"all"|"pack"} options.scope `pack`: the whole compiled pack, needs `resources.bytes`
 * @param {string} options.language Language of the block names to keep next to English, "" for English only
 * @param {boolean} [options.all_languages] With `pack`: keep the names of every language
 * @returns {Promise<Exported>}
 */
export async function export_model(resources, world, { scope, language, all_languages = false }) {
    const { pack } = resources;
    const save = strToU8(JSON.stringify(serialize(world, [pack.name])));
    let bytes;
    let counts;
    let parts;

    if (scope === "pack") {
        const files = unzipSync(resources.bytes);
        const data = JSON.parse(strFromU8(files["data.json"]));
        const keep = new Set(["en_us", language].filter(Boolean));
        if (!all_languages) {
            for (const path of Object.keys(files)) {
                const code = /^lang\/(.+)\.json$/.exec(path)?.[1];
                if (code && !keep.has(code)) {
                    delete files[path];
                }
            }
            data.languages = (data.languages ?? []).filter(l => keep.has(l.code));
        }
        files["data.json"] = strToU8(JSON.stringify(data));
        files["world.json"] = save;
        const names = Object.entries(files).filter(([path]) => path.startsWith("lang/"));
        parts = {
            models: packed_size(files["data.json"]),
            pictures: files["atlas.png"].length,
            names: names.reduce((sum, [, content]) => sum + packed_size(content), 0),
            model: packed_size(save),
        };
        counts = { blocks: Object.keys(data.index).length, models: Object.keys(data.models).length, textures: Object.keys(data.atlas.textures).length };
        bytes = zipSync(Object.fromEntries(Object.entries(files).map(([path, content]) => [path, path.endsWith(".png") ? [content, { level: 0 }] : content])), { level: 9 });
    }
    else {
        const used = used_states(world, pack);
        const { data, texture_ids, lang } = build_mini_data(pack, used, { scope, languages: ["en_us", language] });
        const { atlas, png } = await repack_atlas(resources.texture.image, pack.data.atlas.textures, texture_ids);
        data.atlas = atlas;
        const lang_bytes = Object.fromEntries(Object.entries(lang).map(([code, names]) => [code, strToU8(JSON.stringify(names))]));
        bytes = write_rmpack(data, png, {}, lang_bytes, { "world.json": save });
        parts = {
            models: packed_size(strToU8(JSON.stringify(data))),
            pictures: png.length,
            names: Object.values(lang_bytes).reduce((sum, content) => sum + packed_size(content), 0),
            model: packed_size(save),
        };
        counts = { blocks: used.size, models: Object.keys(data.models).length, textures: texture_ids.length };
    }
    const code = encode_code(bytes);
    return { bytes, code, stats: { ...counts, bytes: bytes.length, code_length: code.length, parts } };
}

/** @param {Uint8Array} bytes */
export function encode_code(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return SHARE_PREFIX + btoa(text);
}

/**
 * @param {string} code
 * @returns {Uint8Array}
 */
export function decode_code(code) {
    const text = code.replace(/\s+/g, "");
    if (!text.startsWith(SHARE_PREFIX)) {
        throw new Error("This is not a share code");
    }
    if (text.length > MAX_CODE_LENGTH) {
        throw new Error("The share code is too long");
    }
    try {
        return Uint8Array.from(atob(text.slice(SHARE_PREFIX.length)), c => c.charCodeAt(0));
    }
    catch {
        throw new Error("The share code is damaged");
    }
}

/**
 * Reads a `.rmmodel`: a resource pack that has a model in it.
 * @param {Uint8Array} bytes
 * @returns {{data: object, world: object}}
 */
export function read_model(bytes) {
    let parts;
    try {
        parts = read_rmpack(bytes);
    }
    catch (error) {
        throw new Error(`The shared model could not be read: ${error.message}`);
    }
    if (!parts.world) {
        throw new Error("This file has no model in it");
    }
    return { data: parts.data, world: parts.world };
}
