import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { test } from "node:test";
import { read_png } from "../js/pack/Png.mjs";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

/** Applies a filter to a line, the way an encoder does */
function filter_line(type, line, previous, bpp) {
    const out = Buffer.alloc(line.length);
    for (let i = 0; i < line.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = previous[i];
        const c = i >= bpp ? previous[i - bpp] : 0;
        let predicted = 0;
        if (type === 1) {
            predicted = a;
        }
        else if (type === 2) {
            predicted = b;
        }
        else if (type === 3) {
            predicted = (a + b) >> 1;
        }
        else if (type === 4) {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        out[i] = (line[i] - predicted) & 255;
    }
    return out;
}

/**
 * A PNG from lines of bytes (already packed to the bit depth); `lines` are filtered with `filters[y % filters.length]`.
 * For an interlaced one pass `passes`: an array of `{width, height, lines}`.
 */
function make_png({ w, h, depth, color, lines, palette, transparency, filters = [0], interlace = 0, passes = null }) {
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
    const bpp = Math.max(1, (channels * depth) >> 3);
    const encode = (set) => {
        const parts = [];
        let previous = Buffer.alloc(set[0]?.length ?? 0);
        set.forEach((line, y) => {
            const type = filters[y % filters.length];
            parts.push(Buffer.from([type]), filter_line(type, Buffer.from(line), previous, bpp));
            previous = Buffer.from(line);
        });
        return Buffer.concat(parts);
    };
    const raw = passes ? Buffer.concat(passes.map(pass => (pass.lines.length > 0 ? encode(pass.lines) : Buffer.alloc(0)))) : encode(lines);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header.set([depth, color, 0, 0, interlace], 8);
    return new Uint8Array(Buffer.concat([
        SIGNATURE,
        chunk("IHDR", header),
        ...(palette ? [chunk("PLTE", Buffer.from(palette.flat()))] : []),
        ...(transparency ? [chunk("tRNS", Buffer.from(transparency))] : []),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]));
}

const pixel = (image, x, y) => [...image.rgba.subarray((y * image.w + x) * 4, (y * image.w + x) * 4 + 4)];

test("8 bit RGBA, with each of the five filters", () => {
    const lines = [0, 1, 2, 3, 4].map(y => Array.from({ length: 5 * 4 }, (_, i) => (i * 13 + y * 41) & 255));
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4]]) {
        const image = read_png(make_png({ w: 5, h: 5, depth: 8, color: 6, lines, filters }));
        assert.equal(image.w, 5);
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 5; x++) {
                assert.deepEqual(pixel(image, x, y), lines[y].slice(x * 4, x * 4 + 4), `filters ${filters} at ${x},${y}`);
            }
        }
    }
});

test("grey with alpha, the kind of the black stained glass", () => {
    const lines = [[10, 255, 20, 128, 30, 0], [40, 255, 50, 255, 60, 7]];
    const image = read_png(make_png({ w: 3, h: 2, depth: 8, color: 4, lines, filters: [1, 4] }));
    assert.deepEqual(pixel(image, 0, 0), [10, 10, 10, 255]);
    assert.deepEqual(pixel(image, 1, 0), [20, 20, 20, 128]);
    assert.deepEqual(pixel(image, 2, 0), [30, 30, 30, 0]);
    assert.deepEqual(pixel(image, 2, 1), [60, 60, 60, 7]);
});

test("grey and RGB without alpha, and a transparent grey", () => {
    const grey = read_png(make_png({ w: 2, h: 1, depth: 8, color: 0, lines: [[0, 200]] }));
    assert.deepEqual(pixel(grey, 1, 0), [200, 200, 200, 255]);
    const keyed = read_png(make_png({ w: 2, h: 1, depth: 8, color: 0, lines: [[0, 200]], transparency: [0, 200] }));
    assert.deepEqual(pixel(keyed, 0, 0), [0, 0, 0, 255]);
    assert.deepEqual(pixel(keyed, 1, 0), [200, 200, 200, 0]);
    const rgb = read_png(make_png({ w: 2, h: 1, depth: 8, color: 2, lines: [[1, 2, 3, 4, 5, 6]], filters: [3] }));
    assert.deepEqual(pixel(rgb, 1, 0), [4, 5, 6, 255]);
});

test("a palette with and without transparency, at every depth", () => {
    const palette = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [9, 9, 9]];
    // 2 bit indices 0 1 2 3, then 4 bit, then 8 bit, then 1 bit (palette of two used)
    const two = read_png(make_png({ w: 4, h: 1, depth: 2, color: 3, lines: [[0b00011011]], palette, transparency: [255, 128] }));
    assert.deepEqual([0, 1, 2, 3].map(x => pixel(two, x, 0)), [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 255], [9, 9, 9, 255]]);
    const four = read_png(make_png({ w: 3, h: 1, depth: 4, color: 3, lines: [[0x12, 0x30]], palette }));
    assert.deepEqual(pixel(four, 0, 0), [0, 255, 0, 255]);
    assert.deepEqual(pixel(four, 1, 0), [0, 0, 255, 255]);
    assert.deepEqual(pixel(four, 2, 0), [9, 9, 9, 255]);
    const one = read_png(make_png({ w: 9, h: 1, depth: 1, color: 3, lines: [[0b10100000, 0b10000000]], palette }));
    assert.deepEqual([0, 1, 2, 8].map(x => pixel(one, x, 0).slice(0, 3)), [[0, 255, 0], [255, 0, 0], [0, 255, 0], [0, 255, 0]]);
    const eight = read_png(make_png({ w: 2, h: 1, depth: 8, color: 3, lines: [[3, 2]], palette }));
    assert.deepEqual(pixel(eight, 1, 0), [0, 0, 255, 255]);
});

test("16 bit and low bit greys are scaled to 8 bits", () => {
    const wide = read_png(make_png({ w: 2, h: 1, depth: 16, color: 0, lines: [[0xFF, 0xFF, 0x80, 0x00]] }));
    assert.deepEqual(pixel(wide, 0, 0), [255, 255, 255, 255]);
    assert.deepEqual(pixel(wide, 1, 0), [128, 128, 128, 255]);
    const rgba = read_png(make_png({ w: 1, h: 1, depth: 16, color: 6, lines: [[0xFF, 0xFF, 0, 0, 0x80, 0, 0xFF, 0xFF]] }));
    assert.deepEqual(pixel(rgba, 0, 0), [255, 0, 128, 255]);
    const bits = read_png(make_png({ w: 4, h: 1, depth: 2, color: 0, lines: [[0b00011011]] }));
    assert.deepEqual([0, 1, 2, 3].map(x => pixel(bits, x, 0)[0]), [0, 85, 170, 255]);
    const one = read_png(make_png({ w: 2, h: 1, depth: 1, color: 0, lines: [[0b01000000]] }));
    assert.deepEqual([0, 1].map(x => pixel(one, x, 0)[0]), [0, 255]);
});

test("interlaced (Adam7) pictures come out in the right places", () => {
    const w = 9;
    const h = 9;
    const value = (x, y) => (x * 20 + y * 3) & 255;
    const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]].map(([x0, y0, dx, dy]) => {
        const width = Math.ceil((w - x0) / dx);
        const height = Math.ceil((h - y0) / dy);
        const lines = [];
        for (let j = 0; j < height; j++) {
            lines.push(Array.from({ length: width }, (_, i) => value(x0 + i * dx, y0 + j * dy)));
        }
        return { width, height, lines: width > 0 && height > 0 ? lines : [] };
    });
    const image = read_png(make_png({ w, h, depth: 8, color: 0, interlace: 1, passes, filters: [0, 1, 2, 3, 4] }));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            assert.equal(pixel(image, x, y)[0], value(x, y), `${x},${y}`);
        }
    }
});

test("damaged and foreign files are refused", () => {
    const good = make_png({ w: 2, h: 2, depth: 8, color: 6, lines: [new Array(8).fill(1), new Array(8).fill(2)] });
    assert.throws(() => read_png(new Uint8Array(10)), /not a PNG/);
    assert.throws(() => read_png(good.subarray(0, 40)), /ends too early|no picture/);
    assert.throws(() => read_png(Uint8Array.from([...good.subarray(0, 8), 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0])), /no picture/);
    const garbage = Uint8Array.from(good);
    garbage.fill(7, 40, 50);
    assert.throws(() => read_png(garbage), /damaged|less picture|filter|no picture|ends too early/);
    const short = make_png({ w: 4, h: 4, depth: 8, color: 6, lines: [new Array(16).fill(1)] });
    assert.throws(() => read_png(short), /less picture/);
    const huge = Buffer.from(good);
    huge.writeUInt32BE(100000, 16);
    assert.throws(() => read_png(huge), /not supported/);
    const no_palette = make_png({ w: 1, h: 1, depth: 8, color: 3, lines: [[0]] });
    assert.throws(() => read_png(no_palette), /no palette/);
});
