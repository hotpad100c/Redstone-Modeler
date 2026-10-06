import { strFromU8, strToU8, unzipSync, zipSync } from "../../lib/fflate.module.js";

export const FORMAT_VERSION = 1;

/**
 * `.rmpack` is a zip holding the compiled result of a resource pack stack:
 * `data.json` (blockstates, flattened models, property index, atlas layout),
 * `atlas.png`, optional `colormap/*.png` and `lang/<code>.json` (block names of one language each).
 * @param {object} data
 * @param {Uint8Array} atlas_png
 * @param {Record<string, Uint8Array>} colormaps File name to PNG bytes
 * @param {Record<string, Uint8Array>} lang Language code to the JSON bytes of `{block id: name}`
 * @returns {Uint8Array}
 */
export function write_rmpack(data, atlas_png, colormaps = {}, lang = {}) {
    const files = {
        "data.json": strToU8(JSON.stringify({ ...data, format: FORMAT_VERSION })),
        "atlas.png": [atlas_png, { level: 0 }],
    };
    for (const [name, bytes] of Object.entries(colormaps)) {
        files[`colormap/${name}`] = [bytes, { level: 0 }];
    }
    for (const [code, bytes] of Object.entries(lang)) {
        files[`lang/${code}.json`] = bytes;
    }
    return zipSync(files, { level: 6 });
}

/**
 * @param {Uint8Array} bytes
 */
export function read_rmpack(bytes) {
    const files = unzipSync(bytes);
    if (!files["data.json"] || !files["atlas.png"]) {
        throw new Error("Not a valid .rmpack file");
    }
    const data = JSON.parse(strFromU8(files["data.json"]));
    if (data.format !== FORMAT_VERSION) {
        throw new Error(`Unsupported .rmpack format ${data.format}`);
    }
    const colormaps = {};
    const lang = {};
    for (const [path, content] of Object.entries(files)) {
        if (path.startsWith("colormap/")) {
            colormaps[path.slice("colormap/".length)] = content;
        }
        else if (path.startsWith("lang/") && path.endsWith(".json")) {
            lang[path.slice("lang/".length, -".json".length)] = content;
        }
    }
    return { data, atlas_png: files["atlas.png"], colormaps, lang };
}
