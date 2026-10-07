import { block_properties } from "./BlockStates.mjs";
import { ModelResolver } from "./Models.mjs";
import { asset_path, normalize_id } from "./PackStack.mjs";

/**
 * Model ids used by blockstate files.
 * @param {object} def
 */
export function model_ids(def) {
    const ids = [];
    const take = (entry) => {
        for (const variant of Array.isArray(entry) ? entry : [entry]) {
            if (variant?.model) {
                ids.push(variant.model);
            }
        }
    };
    Object.values(def.variants ?? {}).forEach(take);
    (def.multipart ?? []).forEach(part => take(part.apply));
    return ids;
}

/**
 * True when none of the models the blockstate files use has any geometry.
 * @param {object[]} defs
 * @param {ModelResolver} resolver
 */
function is_entity_only(defs, resolver) {
    const ids = defs.flatMap(model_ids);
    return ids.length > 0 && ids.every((id) => {
        const model = resolver.resolve(id);
        return model && model.elements.length === 0;
    });
}

/**
 * Block names of every language the packs have a language file for.
 * Layers merge like in Minecraft: a pack higher in the stack overrides the names of the packs below.
 * The key of a block is `block.<namespace>.<path>`, with `/` in the path written as `.`.
 * @param {import("./PackStack.mjs").PackStack} stack
 * @param {string[]} ids Block ids such as `minecraft:stone`
 * @returns {{languages: {code: string, name: string, region: string}[], names: Record<string, Record<string, string>>}}
 */
export function collect_lang(stack, ids) {
    const files = new Map(); // code to [layer index, path][]
    stack.layers.forEach((pack, layer) => {
        for (const path of pack.paths()) {
            const match = /^assets\/[^/]+\/lang\/([^/]+)\.json$/i.exec(path);
            if (match) {
                const code = match[1].toLowerCase();
                if (!files.has(code)) {
                    files.set(code, []);
                }
                files.get(code).push([layer, path]);
            }
        }
    });
    const languages = [];
    const names = {};
    for (const [code, list] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        const merged = {};
        // Lowest layer first so that higher layers win
        for (const [layer, path] of [...list].sort((a, b) => b[0] - a[0])) {
            const json = stack.layers[layer].json(path);
            if (json && typeof json === "object") {
                for (const [key, value] of Object.entries(json)) {
                    if (typeof value === "string") {
                        merged[key] = value;
                    }
                }
            }
        }
        const found = {};
        for (const id of ids) {
            const colon = id.indexOf(":");
            const key = `block.${id.slice(0, colon)}.${id.slice(colon + 1).replace(/\//g, ".")}`;
            if (merged[key]) {
                found[id] = merged[key];
            }
        }
        if (Object.keys(found).length > 0) {
            names[code] = found;
            languages.push({ code, name: merged["language.name"] ?? "", region: merged["language.region"] ?? "" });
        }
    }
    return { languages, names };
}

/**
 * Reads every blockstate in the stack and everything it references.
 * Pure data work, no images, so it runs anywhere.
 * @param {import("./PackStack.mjs").PackStack} stack
 * @param {Record<string, Record<string, string[]>>} [extra_properties] Short block name to property table
 * @param {{blockstates: Record<string, object>, models: Record<string, object>}} [fallback]
 *   Models for blocks the game draws with entity code. They only apply to blocks whose
 *   models in the packs have no elements.
 */
export function collect(stack, extra_properties = {}, fallback = { blockstates: {}, models: {} }) {
    const resolver = new ModelResolver(id => stack.json(asset_path("models", id, "json")) ?? fallback.models[id]);
    const blockstates = {};
    const index = {};
    const models = {};
    const textures = new Set();
    const forced = new Set();

    for (const name of stack.list_ids("blockstates", "json").sort()) {
        let defs = stack.json_all(asset_path("blockstates", name, "json"))
            .filter(def => def && typeof def === "object" && (def.variants || def.multipart));
        if (defs.length === 0) {
            continue;
        }
        const short = name.startsWith("minecraft:") ? name.slice("minecraft:".length) : name;
        const substitute = name.startsWith("minecraft:") ? fallback.blockstates[short] : undefined;
        if (substitute && is_entity_only(defs, resolver)) {
            defs = [substitute];
        }
        blockstates[name] = defs;
        index[name] = block_properties(defs, extra_properties[short]);
        for (const def of defs) {
            for (const id of model_ids(def)) {
                const key = normalize_id(id);
                if (!(key in models)) {
                    const model = resolver.resolve(key);
                    models[key] = model;
                    for (const id of model?.force_translucent ?? []) {
                        forced.add(id);
                    }
                    if (model) {
                        // Only the pack needs it, to draw such textures as see-through; the model does not
                        delete model.force_translucent;
                    }
                    for (const element of model?.elements ?? []) {
                        for (const face of Object.values(element.faces)) {
                            if (face.texture) {
                                textures.add(face.texture);
                            }
                        }
                    }
                    if (model?.particle) {
                        textures.add(model.particle);
                    }
                }
            }
        }
    }
    for (const key of Object.keys(models)) {
        if (models[key] === null) {
            delete models[key];
        }
    }
    const { languages, names } = collect_lang(stack, Object.keys(index));
    return { blockstates, index, models, textures: [...textures].sort(), force_translucent: [...forced].sort(), languages, lang: names };
}
