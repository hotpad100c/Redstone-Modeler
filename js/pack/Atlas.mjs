import { MISSING } from "../render/BlockMesher.mjs";
import { asset_path } from "./PackStack.mjs";

function make_canvas(width, height) {
    // A plain canvas: building the atlas happens on the main thread anyway, and OffscreenCanvas
    // is missing or incomplete in some Safari versions
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Uint8Array>}
 */
export async function canvas_to_png(canvas) {
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
        result => result ? resolve(result) : reject(new Error("The browser could not encode the texture atlas")),
        "image/png",
    ));
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Decodes PNG bytes. Prefers createImageBitmap, falls back to an image element for browsers
 * that lack it or reject its options.
 * @param {Uint8Array} bytes
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
export async function decode_png(bytes) {
    const blob = new Blob([bytes], { type: "image/png" });
    if (typeof createImageBitmap === "function") {
        try {
            return await createImageBitmap(blob);
        }
        catch {
            // Fall through to the image element
        }
    }
    const url = URL.createObjectURL(blob);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
    }
    finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Draws a decoded image onto a canvas. Canvases are the most widely supported WebGL texture source.
 * @param {ImageBitmap|HTMLImageElement} image
 * @returns {HTMLCanvasElement}
 */
export function image_to_canvas(image) {
    const canvas = make_canvas(image.width, image.height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas;
}

function next_pow2(n) {
    let p = 1;
    while (p < n) {
        p *= 2;
    }
    return p;
}

const MAX_SIZE = 8192;

function yield_to_ui() {
    return new Promise(resolve => setTimeout(resolve));
}

/**
 * Stitches textures into one image. Animated textures (tall strips) keep their first frame.
 * Every texture gets a one pixel border of its own edge pixels so nearest filtering never bleeds.
 * @param {import("./PackStack.mjs").PackStack} stack
 * @param {string[]} ids Texture ids
 * @param {(done: number, total: number) => void} [progress]
 */
export async function build_atlas(stack, ids, progress = () => {}) {
    const entries = [];
    const checker = make_canvas(16, 16);
    const check_ctx = checker.getContext("2d");
    check_ctx.fillStyle = "#000000";
    check_ctx.fillRect(0, 0, 16, 16);
    check_ctx.fillStyle = "#f800f8";
    check_ctx.fillRect(0, 0, 8, 8);
    check_ctx.fillRect(8, 8, 8, 8);
    entries.push({ id: MISSING, image: checker, w: 16, h: 16 });

    let done = 0;
    for (const id of ids) {
        const bytes = stack.get(asset_path("textures", id, "png"));
        if (bytes) {
            try {
                const image = await decode_png(bytes);
                const frame = image.height > image.width && image.height % image.width === 0 ? image.width : image.height;
                entries.push({ id, image, w: image.width, h: frame });
            }
            catch {
                console.warn(`Could not decode texture ${id}`);
            }
        }
        if (++done % 40 === 0) {
            progress(done, ids.length);
            await yield_to_ui();
        }
    }

    // Shelf packing, tallest first
    entries.sort((a, b) => b.h - a.h || b.w - a.w);
    const area = entries.reduce((sum, e) => sum + (e.w + 2) * (e.h + 2), 0);
    const widest = Math.max(...entries.map(e => e.w + 2));
    const width = next_pow2(Math.max(widest, Math.ceil(Math.sqrt(area * 1.15))));
    let x = 0;
    let y = 0;
    let row = 0;
    for (const entry of entries) {
        if (x + entry.w + 2 > width) {
            x = 0;
            y += row;
            row = 0;
        }
        entry.x = x + 1;
        entry.y = y + 1;
        x += entry.w + 2;
        row = Math.max(row, entry.h + 2);
    }
    const height = next_pow2(y + row);
    if (width > MAX_SIZE || height > MAX_SIZE) {
        throw new Error(`Texture atlas would be ${width}x${height}; the resource packs have too many or too large textures`);
    }

    const canvas = make_canvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    const textures = {};
    for (const { id, image, w, h, x: ix, y: iy } of entries) {
        ctx.drawImage(image, 0, 0, w, h, ix, iy, w, h);
        ctx.drawImage(image, 0, 0, w, 1, ix, iy - 1, w, 1);
        ctx.drawImage(image, 0, h - 1, w, 1, ix, iy + h, w, 1);
        ctx.drawImage(image, 0, 0, 1, h, ix - 1, iy, 1, h);
        ctx.drawImage(image, w - 1, 0, 1, h, ix + w, iy, 1, h);
        ctx.drawImage(image, 0, 0, 1, 1, ix - 1, iy - 1, 1, 1);
        ctx.drawImage(image, w - 1, 0, 1, 1, ix + w, iy - 1, 1, 1);
        ctx.drawImage(image, 0, h - 1, 1, 1, ix - 1, iy + h, 1, 1);
        ctx.drawImage(image, w - 1, h - 1, 1, 1, ix + w, iy + h, 1, 1);

        const pixels = ctx.getImageData(ix, iy, w, h).data;
        let opaque = true;
        let translucent = false;
        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] !== 255) {
                opaque = false;
                if (pixels[i] !== 0) {
                    translucent = true;
                }
            }
        }
        textures[id] = { x: ix, y: iy, w, h, opaque, translucent };
    }
    progress(ids.length, ids.length);
    return { atlas: { width, height, textures }, png: await canvas_to_png(canvas) };
}
