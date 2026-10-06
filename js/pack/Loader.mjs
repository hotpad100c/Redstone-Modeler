import { PackStack } from "./PackStack.mjs";
import { build_atlas, decode_png } from "./Atlas.mjs";
import { CompiledPack } from "./CompiledPack.mjs";
import { collect } from "./Compiler.mjs";
import { read_rmpack, write_rmpack } from "./Rmpack.mjs";

const COLORMAPS = ["grass", "foliage"];

/**
 * Decodes a colour map PNG into raw RGBA.
 * @param {Uint8Array} bytes
 */
async function decode_colormap(bytes) {
    const image = await decode_png(bytes);
    const canvas = typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(image.width, image.height)
        : Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
}

/**
 * Compiles a stack of resource packs into the bytes of a `.rmpack` file.
 * @param {import("./Pack.mjs").Pack[]} packs Highest priority first
 * @param {object} options
 * @param {string} options.name
 * @param {Record<string, Record<string, string[]>>} [options.extra_properties]
 * @param {{blockstates: object, models: object}} [options.fallback] Entity block models, see collect()
 * @param {(message: string) => void} [options.progress]
 * @returns {Promise<Uint8Array>}
 */
export async function compile(packs, { name, extra_properties = {}, fallback, progress = () => {} }) {
    const stack = new PackStack(packs);
    progress("Reading block states and models");
    const data = collect(stack, extra_properties, fallback);
    const { atlas, png } = await build_atlas(
        stack,
        data.textures,
        (done, total) => progress(`Building texture atlas ${done}/${total}`),
    );
    const colormaps = {};
    for (const map of COLORMAPS) {
        const bytes = stack.get(`assets/minecraft/textures/colormap/${map}.png`);
        if (bytes) {
            colormaps[`${map}.png`] = bytes;
        }
    }
    progress("Packing");
    return write_rmpack({
        name,
        created: Date.now(),
        sources: packs.map(pack => pack.name),
        atlas,
        index: data.index,
        blockstates: data.blockstates,
        models: data.models,
    }, png, colormaps);
}

/**
 * @param {Uint8Array} bytes Contents of a `.rmpack`
 * @returns {Promise<{pack: CompiledPack, atlas_image: ImageBitmap}>}
 */
export async function load_compiled(bytes) {
    const { data, atlas_png, colormaps } = read_rmpack(bytes);
    const decoded = {};
    for (const map of COLORMAPS) {
        if (colormaps[`${map}.png`]) {
            decoded[map] = await decode_colormap(colormaps[`${map}.png`]);
        }
    }
    return {
        pack: new CompiledPack(data, { colormaps: decoded }),
        atlas_image: await decode_png(atlas_png),
    };
}
