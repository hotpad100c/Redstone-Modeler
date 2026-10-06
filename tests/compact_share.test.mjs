import assert from "node:assert/strict";
import { deflateSync } from "../lib/fflate.module.js";
import { test } from "node:test";
import { World } from "../js/model/World.mjs";
import { CompiledPack } from "../js/pack/CompiledPack.mjs";
import { serialize } from "../js/model/Save.mjs";
import { COMPACT_PREFIX, build_mini_data, decode_code, encode_code, is_code, is_compact, pack_compact, unpack_compact, used_states } from "../js/share/Share.mjs";
import { shorten } from "../js/share/Shorten.mjs";
import { compiled_pack, stack } from "./fixtures.mjs";

const pack = compiled_pack(stack());

function model() {
    const world = new World({ x: 8, y: 8, z: 8 });
    world.set(0, 0, 0, { name: "minecraft:observer", props: { facing: "south", powered: "true" } });
    world.set(1, 0, 0, { name: "minecraft:observer", props: { facing: "north", powered: "false" } });
    world.set(3, 0, 0, { name: "minecraft:stone", props: {} });
    world.set(4, 0, 0, { name: "minecraft:oak_fence", props: { north: "true" } });
    return world;
}

function pictures_for(ids) {
    return ids.map((id, n) => {
        const rgba = new Uint8ClampedArray(16 * 16 * 4);
        for (let i = 0; i < 256; i++) {
            const alpha = n % 3 === 0 && i % 7 === 0 ? 0 : 255;
            rgba.set([(i * 3 + n * 40) % 256, (i * 5) % 256, (n * 17 + (i >> 4) * 9) % 256, alpha], i * 4);
        }
        return { id, w: 16, h: 16, rgba };
    });
}

function parts(scope = "used") {
    const world = model();
    const used = used_states(world, pack);
    const { data, texture_ids, lang } = build_mini_data(pack, used, { scope, languages: ["en_us", "zh_cn"] });
    const save = serialize(world, [pack.name]);
    return { data, lang, save, texture_ids, pictures: pictures_for(texture_ids), used };
}

test("the compact form brings back the data, the textures and the model", () => {
    const { data, lang, save, pictures } = parts();
    const { raw } = pack_compact({ data, lang, save, pictures });
    assert.ok(is_compact(raw));
    const back = unpack_compact(raw);
    const expected = { ...data };
    delete expected.atlas;
    assert.deepEqual(back.data, JSON.parse(JSON.stringify(expected)));
    assert.deepEqual(back.lang, lang);
    assert.deepEqual(back.save, save);
    assert.equal(back.pictures.length, pictures.length);
    back.pictures.forEach((picture, i) => {
        assert.equal(picture.id, pictures[i].id);
        for (let p = 0; p < 256; p++) {
            const a = pictures[i].rgba[p * 4 + 3];
            assert.equal(picture.rgba[p * 4 + 3], a);
            if (a !== 0) {
                assert.deepEqual([...picture.rgba.subarray(p * 4, p * 4 + 4)], [...pictures[i].rgba.subarray(p * 4, p * 4 + 4)]);
            }
        }
    });
});

test("the compact form is smaller than the standard one, and a code of it starts with RMS2", () => {
    const { data, lang, save, pictures } = parts();
    const { raw } = pack_compact({ data, lang, save, pictures });
    const json = deflateSync(new TextEncoder().encode(JSON.stringify({ data, lang, save })), { level: 9 }).length;
    assert.ok(raw.length < json + pictures.length * 256 * 4, "smaller than raw pixels and compressed JSON together");
    const code = encode_code(raw);
    assert.ok(code.startsWith(COMPACT_PREFIX));
    assert.ok(is_code(code));
    assert.deepEqual(decode_code(code), raw);
});

test("damaged or hostile compact data is refused", () => {
    const { data, lang, save, pictures } = parts();
    const { raw } = pack_compact({ data, lang, save, pictures });
    assert.throws(() => unpack_compact(new Uint8Array([1, 2, 3])), /not a compact/);
    for (const cut of [5, 20, Math.floor(raw.length / 2), raw.length - 3]) {
        assert.throws(() => unpack_compact(raw.subarray(0, cut)), /share/i, `cut at ${cut}`);
    }
    const bomb = new Uint8Array(raw.length);
    bomb.set(raw.subarray(0, 4));
    assert.throws(() => unpack_compact(bomb), /share/i);
    const huge = deflateSync(new Uint8Array(80 * 1024 * 1024), { level: 1 });
    const hostile = new Uint8Array(4 + huge.length);
    hostile.set(raw.subarray(0, 4));
    hostile.set(huge, 4);
    assert.throws(() => unpack_compact(hostile), /too big/);
});

test("less colours: at most 256, in the lossy form", () => {
    const { data, lang, save, pictures } = parts();
    const { raw } = pack_compact({ data, lang, save, pictures }, { max_colors: 8 });
    const back = unpack_compact(raw);
    const colors = new Set();
    for (const picture of back.pictures) {
        for (let i = 0; i < picture.rgba.length; i += 4) {
            if (picture.rgba[i + 3] !== 0) {
                colors.add(picture.rgba.slice(i, i + 4).join(","));
            }
        }
    }
    assert.ok(colors.size <= 8, `${colors.size} colours`);
});

function shortened() {
    const { data, lang, save, texture_ids, used } = parts();
    const tint_rules = { "minecraft:oak_fence": { kind: "rgb", rgb: [10, 20, 30] } };
    const short = shorten({ data, lang, save, textures: texture_ids, tint_rules });
    return { data, lang, save, texture_ids, used, short };
}

test("shortened data has no readable ids, yet gives the same geometry", () => {
    const { data, texture_ids, used, short } = shortened();
    const text = JSON.stringify(short.data) + JSON.stringify(short.save);
    for (const word of ["minecraft", "observer", "powered", "facing", "oak_fence", "block/"]) {
        assert.ok(!text.includes(word), `"${word}" is still there`);
    }
    assert.equal(short.data.minimal, true);
    const atlas = { width: 1024, height: 32, textures: {} };
    for (const id of texture_ids) {
        atlas.textures[short.maps.texture.get(id) ?? id] = pack.data.atlas.textures[id];
    }
    const lang_bytes = Object.fromEntries(Object.entries(short.lang).map(([code, names]) => [code, new TextEncoder().encode(JSON.stringify(names))]));
    const copy = new CompiledPack({ ...short.data, atlas }, { lang: lang_bytes });
    const code = (map, key) => map.get(key) ?? key;
    for (const [name, states] of used) {
        for (const state of states.values()) {
            const coded = Object.fromEntries(Object.entries(state).map(([p, v]) => [code(short.maps.property, p), code(short.maps.value, v)]));
            const expected = pack.geometry(name, state).quads.map(q => ({ ...q, tex: code(short.maps.texture, q.tex) }));
            assert.deepEqual(copy.geometry(short.maps.block.get(name), coded).quads, expected, `${name} ${JSON.stringify(state)}`);
        }
    }
    assert.equal(data.index["minecraft:stone"] !== undefined, true);
});

test("every shortened block has a name, and the names are what is left to find it by", () => {
    const { short } = shortened();
    for (const id of Object.keys(short.data.index)) {
        assert.ok(short.lang.en_us[id], `${id} has an English name`);
    }
    assert.equal(short.lang.en_us[short.maps.block.get("minecraft:stone")], "Stone");
    assert.equal(short.lang.zh_cn[short.maps.block.get("minecraft:stone")], "石头");
    assert.ok(Object.keys(short.lang.en_us).every(id => id.startsWith("b:")));
});

test("shortened colour rules and the model follow the codes", () => {
    const { short, save } = shortened();
    assert.deepEqual(short.data.tint_rules[short.maps.block.get("minecraft:oak_fence")], { kind: "rgb", rgb: [10, 20, 30] });
    assert.equal(short.save.blocks.length, save.blocks.length);
    for (const { name } of short.save.palette) {
        assert.ok(short.data.index[name], `${name} is a known block`);
    }
});

test("shortened data survives the compact form", () => {
    const { short } = shortened();
    const pictures = pictures_for(short.textures);
    const { raw } = pack_compact({ data: short.data, lang: short.lang, save: short.save, pictures }, { max_colors: 256 });
    const back = unpack_compact(raw);
    assert.deepEqual(back.save, short.save);
    assert.equal(back.data.minimal, true);
    assert.deepEqual(back.pictures.map(p => p.id), pictures.map(p => p.id));
});
