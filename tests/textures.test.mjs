import assert from "node:assert/strict";
import { deflateSync } from "../lib/fflate.module.js";
import { test } from "node:test";
import { decode_textures, encode_textures, reduce_colors } from "../js/share/Textures.mjs";

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/** A picture like block textures are: a few base colours with blotchy noise, some with transparency */
function texture(size, { colors = 8, alpha = false, noise = 0 } = {}) {
    const base = Array.from({ length: colors }, () => [rnd() * 255 | 0, rnd() * 255 | 0, rnd() * 255 | 0]);
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const [r, g, b] = base[Math.floor((rnd() * 0.5 + (i % size) / size * 0.5) * colors) % colors];
        const j = (rnd() - 0.5) * noise;
        rgba.set([r + j, g + j, b + j, alpha && rnd() < 0.2 ? 0 : alpha && rnd() < 0.1 ? 120 : 255], i * 4);
    }
    return { w: size, h: size, rgba };
}

const raw = pictures => Buffer.concat(pictures.map(p => Buffer.from(p.rgba)));

test("textures come back pixel for pixel", () => {
    const pictures = [texture(16, { colors: 6 }), texture(16, { colors: 12, alpha: true }), texture(32, { colors: 20, noise: 12 })];
    const back = decode_textures(encode_textures(pictures));
    assert.equal(back.length, 3);
    back.forEach((picture, i) => {
        assert.equal(picture.w, pictures[i].w);
        assert.equal(picture.h, pictures[i].h);
        // Fully transparent pixels all become the same colour; everything else is exact
        for (let p = 0; p < picture.w * picture.h * 4; p += 4) {
            const was = pictures[i].rgba.subarray(p, p + 4);
            const now = picture.rgba.subarray(p, p + 4);
            assert.deepEqual([...now], was[3] === 0 ? [0, 0, 0, 0] : [...was], `texture ${i} pixel ${p / 4}`);
        }
    });
});

test("more than 256 colours still work and are exact", () => {
    const pictures = [texture(32, { colors: 40, noise: 80 }), texture(32, { colors: 40, noise: 80 })];
    const distinct = new Set();
    for (const p of pictures) {
        for (let i = 0; i < p.rgba.length; i += 4) {
            distinct.add(`${p.rgba[i]},${p.rgba[i + 1]},${p.rgba[i + 2]}`);
        }
    }
    assert.ok(distinct.size > 256, `${distinct.size} colours`);
    const back = decode_textures(encode_textures(pictures));
    pictures.forEach((p, i) => assert.deepEqual([...back[i].rgba], [...p.rgba]));
});

/** Textures of one material: shades of a few hues, as the blocks of a build are */
function material_textures(count) {
    const hues = [[120, 120, 120], [90, 90, 90], [150, 150, 150], [60, 120, 40], [110, 80, 50], [180, 40, 40], [30, 30, 30]];
    return Array.from({ length: count }, (_, n) => {
        const rgba = new Uint8ClampedArray(16 * 16 * 4);
        for (let i = 0; i < 256; i++) {
            const [r, g, b] = hues[Math.floor(rnd() * hues.length)];
            const shade = Math.floor(rnd() * 4) * 8;
            rgba.set([r - shade, g - shade, b - shade, n % 5 === 0 && rnd() < 0.2 ? 0 : 255], i * 4);
        }
        return { w: 16, h: 16, rgba };
    });
}

test("with few colours it is a lot smaller than the pixels, also once both are compressed", () => {
    const pictures = material_textures(40);
    const packed = deflateSync(encode_textures(pictures), { level: 9 }).length;
    const plain = deflateSync(raw(pictures), { level: 9 }).length;
    assert.ok(packed < plain * 0.75, `${packed} against ${plain} after compression`);
});

test("with very many colours it is never worse than compressing the pixels", () => {
    const pictures = Array.from({ length: 40 }, (_, i) => texture(16, { colors: 5 + (i % 10), alpha: i % 4 === 0, noise: 10 }));
    const packed = deflateSync(encode_textures(pictures), { level: 9 }).length;
    const plain = deflateSync(raw(pictures), { level: 9 }).length;
    assert.ok(packed <= plain + 16, `${packed} against ${plain} after compression`);
});

test("reducing to 256 colours is where the palette gets really small", () => {
    const pictures = Array.from({ length: 40 }, (_, i) => texture(16, { colors: 5 + (i % 10), alpha: i % 4 === 0, noise: 10 }));
    const lossless = deflateSync(encode_textures(pictures), { level: 9 }).length;
    const reduced = deflateSync(encode_textures(pictures, { max_colors: 256 }), { level: 9 }).length;
    assert.ok(reduced < lossless * 0.6, `${reduced} with 256 colours against ${lossless}`);
});

test("the most used colours get the first and shortest indices", () => {
    const rgba = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < 256; i++) {
        rgba.set(i < 200 ? [10, 20, 30, 255] : i < 250 ? [200, 0, 0, 255] : [0, 255, 0, 255], i * 4);
    }
    const encoded = encode_textures([{ w: 16, h: 16, rgba }], { form: "palette" });
    // count, form, palette size, no alpha, three colours
    assert.deepEqual([...encoded.subarray(0, 13)], [1, 0, 3, 0, 10, 20, 30, 200, 0, 0, 0, 255, 0]);
    assert.deepEqual([...encoded.subarray(13, 15)], [16, 16], "width and height");
    assert.equal(encoded[15], 0, "the first pixel has the first colour");
});

test("colours can be reduced to a limit, and the picture stays close", () => {
    const pictures = [texture(32, { colors: 60, noise: 120 }), texture(32, { colors: 60, noise: 120, alpha: true })];
    const encoded = encode_textures(pictures, { max_colors: 64 });
    const back = decode_textures(encoded);
    const palette_size = encoded[1];
    assert.ok(palette_size <= 64, `palette of ${palette_size}`);
    assert.ok(encoded.length < encode_textures(pictures).length, "smaller than lossless");
    let error = 0;
    let n = 0;
    pictures.forEach((p, i) => {
        for (let k = 0; k < p.rgba.length; k += 4) {
            if (p.rgba[k + 3] === 0) {
                assert.equal(back[i].rgba[k + 3], 0, "transparent stays transparent");
            }
            else {
                assert.ok(back[i].rgba[k + 3] > 0, "visible stays visible");
                error += Math.abs(p.rgba[k] - back[i].rgba[k]) + Math.abs(p.rgba[k + 1] - back[i].rgba[k + 1]) + Math.abs(p.rgba[k + 2] - back[i].rgba[k + 2]);
                n += 3;
            }
        }
    });
    assert.ok(error / n < 40, `average error ${error / n}`);
});

test("reducing keeps exactly the limit and merges only when it has to", () => {
    const few = [{ key: 0x102030FF, count: 5 }, { key: 0xA0B0C0FF, count: 5 }];
    const same = reduce_colors(few, 8);
    assert.equal(new Set(same.values()).size, 2);
    assert.equal(same.get(0x102030FF), 0x102030FF);
    const many = Array.from({ length: 500 }, (_, i) => ({ key: ((i % 256) << 24 | (i * 7 % 256) << 16 | (i * 13 % 256) << 8 | 255) >>> 0, count: 1 + i % 5 }));
    assert.ok(new Set(reduce_colors(many, 16).values()).size <= 16);
    assert.equal(new Set(reduce_colors(many, 1).values()).size, 1);
});

test("an empty list, a one pixel texture and a single colour work", () => {
    assert.deepEqual(decode_textures(encode_textures([])), []);
    for (const form of ["palette", "planes"]) {
        assert.deepEqual(decode_textures(encode_textures([], { form })), []);
    }
    const one = { w: 1, h: 1, rgba: Uint8ClampedArray.from([1, 2, 3, 255]) };
    assert.deepEqual([...decode_textures(encode_textures([one]))[0].rgba], [1, 2, 3, 255]);
    const clear = { w: 2, h: 1, rgba: new Uint8ClampedArray(8) };
    assert.deepEqual([...decode_textures(encode_textures([clear]))[0].rgba], new Array(8).fill(0));
});

test("wrong sizes and damaged data are refused", () => {
    assert.throws(() => encode_textures([{ w: 2, h: 2, rgba: new Uint8ClampedArray(4) }]), /wrong number/);
    const good = encode_textures([texture(16, { colors: 4 })]);
    for (let cut = 0; cut < good.length; cut += 7) {
        assert.throws(() => decode_textures(good.subarray(0, cut)), undefined, `cut at ${cut}`);
    }
    assert.throws(() => decode_textures(Uint8Array.from([...good, 0])), /left over/);
    // A palette of a million colours that is not there
    assert.throws(() => decode_textures(Uint8Array.from([1, 0, 0xC0, 0x84, 0x3D, 0])), /damaged/);
    // A texture of 4 billion pixels, in both forms
    assert.throws(() => decode_textures(Uint8Array.from([1, 0, 1, 0, 1, 2, 3, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F, 2])), /damaged or too large/);
    for (const form of [1, 2]) {
        assert.throws(() => decode_textures(Uint8Array.from([1, form, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F, 2, 0])), /damaged or too large/);
    }
    // An index outside the palette
    assert.throws(() => decode_textures(Uint8Array.from([1, 0, 1, 0, 1, 2, 3, 1, 1, 5])), /not there/);
    // A form that does not exist
    assert.throws(() => decode_textures(Uint8Array.from([1, 9])), /not known/);
    assert.throws(() => decode_textures(Uint8Array.from([1, 3])), /not known/);
});
