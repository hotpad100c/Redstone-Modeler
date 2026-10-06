import { strToU8 } from "../../lib/fflate.module.js";
import { PackStack } from "./PackStack.mjs";
import { build_atlas, decode_png, image_to_canvas } from "./Atlas.mjs";
import { CompiledPack } from "./CompiledPack.mjs";
import { collect } from "./Compiler.mjs";
import { read_rmpack, write_rmpack } from "./Rmpack.mjs";

const COLORMAPS = ["grass", "foliage"];

/**
 * Decodes a colour map PNG into raw RGBA.
 * @param {Uint8Array} bytes
 */
async function decode_colormap(bytes) {
    const canvas = image_to_canvas(await decode_png(bytes));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
}

/**
 * Compiles a stack of resource packs into the bytes of a `.rmpack` file.
 * @param {import("./Pack.mjs").Pack[]} packs Highest priority first
 * @param {object} options
 * @param {string} options.name
 * @param {Record<string, Record<string, string[]>>} [options.extra_properties]
 * @param {{blockstates: object, models: object}} [options.fallback] Entity block models, see collect()
 * @param {(key: string, vars?: object) => void} [options.progress] Called with a key of the interface texts (`compile.*`) and its values
 * @returns {Promise<Uint8Array>}
 */
export async function compile(packs, { name, extra_properties = {}, fallback, progress = () => {} }) {
    const stack = new PackStack(packs);
    progress("compile.reading");
    const data = collect(stack, extra_properties, fallback);
    if (Object.keys(data.index).length === 0) {
        throw Object.assign(new Error("No blocks were found in these files"), { code: "no_assets" });
    }
    const { atlas, png } = await build_atlas(
        stack,
        data.textures,
        (done, total) => progress("compile.atlas", { done, total }),
    );
    const colormaps = {};
    for (const map of COLORMAPS) {
        const bytes = stack.get(`assets/minecraft/textures/colormap/${map}.png`);
        if (bytes) {
            colormaps[`${map}.png`] = bytes;
        }
    }
    progress("compile.packing");
    const lang = Object.fromEntries(Object.entries(data.lang).map(([code, names]) => [code, strToU8(JSON.stringify(names))]));
    return write_rmpack({
        name,
        created: Date.now(),
        sources: packs.map(pack => pack.name),
        atlas,
        index: data.index,
        blockstates: data.blockstates,
        models: data.models,
        languages: data.languages,
    }, png, colormaps, lang);
}

/**
 * @param {Uint8Array} bytes Contents of a `.rmpack`
 * @returns {Promise<{pack: CompiledPack, atlas_image: HTMLCanvasElement}>}
 */
export async function load_compiled(bytes) {
    const { data, atlas_png, colormaps, lang } = read_rmpack(bytes);
    const decoded = {};
    for (const map of COLORMAPS) {
        if (colormaps[`${map}.png`]) {
            decoded[map] = await decode_colormap(colormaps[`${map}.png`]);
        }
    }
    return {
        pack: new CompiledPack(data, { colormaps: decoded, lang }),
        atlas_image: image_to_canvas(await decode_png(atlas_png)),
    };
}
