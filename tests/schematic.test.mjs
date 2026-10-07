import assert from "node:assert/strict";
import { gzipSync } from "../lib/fflate.module.js";
import { test } from "node:test";
import { World } from "../js/model/World.mjs";
import { TAG, byte, double, float, list, long, read_nbt, short, write_nbt } from "../js/schematic/Nbt.mjs";
import { BlueprintBuilder, SchematicError, blueprint_from_world, fill_world, format_state, parse_state } from "../js/schematic/Blueprint.mjs";
import { TARGETS, read_blueprint, write_blueprint } from "../js/schematic/index.mjs";

const states_of = (blueprint) => {
    const map = new Map();
    for (let i = 0; i < blueprint.ps.length; i++) {
        map.set(`${blueprint.xs[i]},${blueprint.ys[i]},${blueprint.zs[i]}`, format_state(blueprint.palette[blueprint.ps[i]]));
    }
    return map;
};

/** A box with `count` kinds of block, filled at random (the same every time) */
function random_blueprint(kinds, size = { x: 13, y: 9, z: 11 }) {
    const builder = new BlueprintBuilder(size);
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF) / 0x7FFFFFFF;
    const entries = Array.from({ length: kinds }, (_, i) => builder.entry({ name: `test:block_${i}`, props: i % 3 ? { level: String(i % 7), kind: "a" } : {} }));
    for (let y = 0; y < size.y; y++) {
        for (let z = 0; z < size.z; z++) {
            for (let x = 0; x < size.x; x++) {
                if (random() < 0.7) {
                    builder.add(x, y, z, entries[Math.floor(random() * kinds)]);
                }
            }
        }
    }
    return builder.finish();
}

test("NBT: every kind of tag is written and read back", () => {
    const value = {
        b: byte(-5), s: short(-300), i: 123456, l: long(2n ** 62n + 7n), f: float(1.5), d: double(-2.25), text: "ünï 中文",
        bytes: Int8Array.of(1, -2, 3), ints: Int32Array.of(-1, 0, 2 ** 31 - 1), longs: BigInt64Array.of(-1n, 2n ** 63n - 1n),
        nested: { list_of_ints: list(TAG.INT, [1, 2, 3]), list_of_compounds: list(TAG.COMPOUND, [{ a: 1 }, { a: 2 }]), empty: list(TAG.COMPOUND, []) },
    };
    for (const gzip of [true, false]) {
        const { name, value: back } = read_nbt(write_nbt(value, "root", { gzip }));
        assert.equal(name, "root");
        assert.deepEqual(back, {
            b: -5, s: -300, i: 123456, l: 2n ** 62n + 7n, f: 1.5, d: -2.25, text: "ünï 中文",
            bytes: Int8Array.of(1, -2, 3), ints: Int32Array.of(-1, 0, 2 ** 31 - 1), longs: BigInt64Array.of(-1n, 2n ** 63n - 1n),
            nested: { list_of_ints: { type: TAG.INT, items: [1, 2, 3] }, list_of_compounds: { type: TAG.COMPOUND, items: [{ a: 1 }, { a: 2 }] }, empty: { type: TAG.COMPOUND, items: [] } },
        });
    }
});

test("NBT: damaged, hostile and foreign data is refused", () => {
    const good = write_nbt({ a: 1, list: list(TAG.INT, [1, 2, 3]), text: "hello" }, "", { gzip: false });
    for (let cut = 0; cut < good.length; cut++) {
        assert.throws(() => read_nbt(good.subarray(0, cut)), undefined, `cut at ${cut}`);
    }
    assert.throws(() => read_nbt(Uint8Array.of(1, 2, 3)), /not an NBT/);
    // A list that says it has billions of items
    assert.throws(() => read_nbt(Uint8Array.of(10, 0, 0, 9, 0, 1, 97, 3, 0x7F, 0xFF, 0xFF, 0xFF, 0)), /ends too early/);
    // A negative length
    assert.throws(() => read_nbt(Uint8Array.of(10, 0, 0, 7, 0, 1, 97, 0xFF, 0xFF, 0xFF, 0xFF, 0)), /negative/);
    // Nested too deeply
    let deep = {};
    for (let i = 0; i < 100; i++) {
        deep = { deep };
    }
    assert.throws(() => read_nbt(write_nbt(deep, "", { gzip: false })), /nested too deeply/);
    // A name that would change a prototype
    const proto = write_nbt({ x: 1 }, "", { gzip: false });
    const text = new TextDecoder().decode(proto).replace("x", "x");
    assert.ok(text.length > 0);
    assert.throws(() => read_nbt(gzipSync(Uint8Array.of(10, 0, 0, 1, 0, 9, ...new TextEncoder().encode("__proto__"), 1, 0))), /not allowed/);
    assert.equal({}.polluted, undefined);
    assert.throws(() => read_nbt(Uint8Array.of(0x1F, 0x8B, 8, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3)), /unpacked/);
});

test("states are written the way Sponge schematics do, and read back", () => {
    assert.deepEqual(parse_state("minecraft:stone"), { name: "minecraft:stone", props: {} });
    assert.deepEqual(parse_state("minecraft:observer[powered=true,facing=north]"), { name: "minecraft:observer", props: { powered: "true", facing: "north" } });
    assert.equal(format_state({ name: "minecraft:observer", props: { powered: "true", facing: "north" } }), "minecraft:observer[facing=north,powered=true]");
    assert.equal(format_state({ name: "minecraft:stone", props: {} }), "minecraft:stone");
});

test("every format gives back the blocks that were written, whatever the size of the palette", () => {
    for (const kinds of [1, 2, 3, 4, 5, 16, 17, 31, 255, 256, 1000, 5000]) {
        const blueprint = random_blueprint(kinds);
        const expected = states_of(blueprint);
        for (const format of ["litematic", "schem", "nbt"]) {
            const back = read_blueprint(write_blueprint(blueprint, format, {}));
            assert.equal(back.meta.format, format);
            assert.deepEqual(back.size, blueprint.size);
            assert.deepEqual(states_of(back), expected, `${format} with ${kinds} kinds of block`);
        }
    }
});

test("the files say which game they are for", () => {
    const blueprint = random_blueprint(3);
    for (const target of TARGETS) {
        for (const format of ["litematic", "schem", "nbt"]) {
            assert.equal(read_blueprint(write_blueprint(blueprint, format, { target: target.id })).meta.data_version, target.data_version);
        }
    }
    assert.throws(() => write_blueprint(blueprint, "schem", { target: "0.1" }), SchematicError);
    assert.throws(() => write_blueprint(blueprint, "pdf", {}), SchematicError);
});

/** A litematic region of `size` at `pos`, cell i holds block number i % 3 + 1 of a palette of air and three blocks */
function region(pos, size) {
    const [sx, sy, sz] = size.map(Math.abs);
    const words = new Uint32Array(Math.ceil(sx * sy * sz * 2 / 64) * 2);
    for (let i = 0; i < sx * sy * sz; i++) {
        words[(i * 2) >>> 5] |= ((i % 3) + 1) << ((i * 2) & 31);
    }
    return {
        Position: { x: pos[0], y: pos[1], z: pos[2] },
        Size: { x: size[0], y: size[1], z: size[2] },
        BlockStatePalette: list(TAG.COMPOUND, [{ Name: "minecraft:air" }, { Name: "minecraft:stone" }, { Name: "minecraft:dirt" }, { Name: "minecraft:sand" }]),
        BlockStates: new BigInt64Array(words.buffer, 0, words.length / 2),
        TileEntities: list(TAG.COMPOUND, [{ id: "x" }]), Entities: list(TAG.COMPOUND, [{ id: "y" }, { id: "z" }]),
    };
}
const litematic = regions => write_nbt({ MinecraftDataVersion: 3955, Version: 7, Metadata: { Name: "t", Author: "me" }, Regions: regions }, "");

test("litematic: a negative size reaches towards smaller coordinates, several regions are put together", () => {
    const positive = read_blueprint(litematic({ a: region([10, 5, 7], [3, 2, 2]) }));
    assert.deepEqual(positive.size, { x: 3, y: 2, z: 2 });
    assert.equal(positive.ps.length, 12);
    assert.equal(states_of(positive).get("0,0,0"), "minecraft:stone");
    assert.equal(states_of(positive).get("1,0,0"), "minecraft:dirt");
    assert.equal(states_of(positive).get("2,0,0"), "minecraft:sand");
    assert.equal(states_of(positive).get("1,1,0"), "minecraft:dirt", "cells run x first, then z, then y: cell 7 is x = 1, y = 1");
    assert.equal(states_of(positive).get("2,0,1"), "minecraft:sand", "cell 5 is x = 2, z = 1");
    assert.equal(states_of(positive).get("1,0,1"), "minecraft:dirt", "cell 4 is x = 1, z = 1");
    // The same cells, as a region that starts at its far corner: only the position of the box differs, not the cells
    const negative = read_blueprint(litematic({ a: region([12, 6, 8], [-3, -2, -2]) }));
    assert.deepEqual(states_of(negative), states_of(positive));
    // Two regions: the box that holds both, the corner nearest to the origin at 0
    const both = read_blueprint(litematic({ a: region([0, 0, 0], [3, 2, 2]), b: region([5, 0, 3], [-2, 2, 2]) }));
    assert.deepEqual(both.size, { x: 6, y: 2, z: 5 });
    assert.equal(both.ps.length, 12 + 8);
    assert.equal(both.meta.ignored.block_entities, 2);
    assert.equal(both.meta.ignored.entities, 4);
    assert.equal(both.meta.name, "t");
    assert.equal(both.meta.author, "me");
});

test("litematic: a region with less blocks than its size, or a block outside the palette, is refused", () => {
    const short_region = region([0, 0, 0], [3, 2, 2]);
    short_region.BlockStates = new BigInt64Array(0);
    assert.throws(() => read_blueprint(litematic({ a: short_region })), /less blocks/);
    const words = new Uint32Array(2);
    words[0] = 3 << 2; // cell 1 holds number 3, the palette has two entries
    const outside = region([0, 0, 0], [2, 1, 1]);
    outside.BlockStatePalette = list(TAG.COMPOUND, [{ Name: "minecraft:air" }, { Name: "minecraft:stone" }]);
    outside.BlockStates = new BigInt64Array(words.buffer, 0, 1);
    assert.throws(() => read_blueprint(litematic({ a: outside })), /not in its palette/);
    assert.throws(() => read_blueprint(litematic({})), /no region/);
    assert.throws(() => read_blueprint(litematic({ a: { ...region([0, 0, 0], [1, 1, 1]), Size: undefined } })), /no position or size/);
});

test("Sponge: version 2 (fields in the root) and version 3 (a Schematic compound with Blocks)", () => {
    const palette = { "minecraft:air": 0, "minecraft:stone": 1, "minecraft:oak_stairs[facing=north,half=bottom]": 2 };
    // 2 x 1 x 2: cells x + z * 2: stone, stairs, air, stone
    const data = Int8Array.of(1, 2, 0, 1);
    const v2 = write_nbt({ Version: 2, DataVersion: 3955, Width: short(2), Height: short(1), Length: short(2), Palette: palette, BlockData: data, BlockEntities: list(TAG.COMPOUND, [{ Id: "x" }]) }, "Schematic");
    const v3 = write_nbt({ Schematic: { Version: 3, DataVersion: 3955, Width: short(2), Height: short(1), Length: short(2), Blocks: { Palette: palette, Data: data, BlockEntities: list(TAG.COMPOUND, []) } } }, "");
    for (const bytes of [v2, v3]) {
        const blueprint = read_blueprint(bytes);
        assert.equal(blueprint.meta.format, "schem");
        assert.deepEqual(blueprint.size, { x: 2, y: 1, z: 2 });
        assert.deepEqual([...states_of(blueprint)].sort(), [
            ["0,0,0", "minecraft:stone"], ["1,0,1", "minecraft:stone"], ["1,0,0", "minecraft:oak_stairs[facing=north,half=bottom]"],
        ].sort());
    }
    assert.equal(read_blueprint(v2).meta.ignored.block_entities, 1);
    // A palette number of more than 127 takes two bytes
    const wide_palette = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`test:b${i}`, i]));
    const wide = write_nbt({ Version: 2, Width: short(2), Height: short(1), Length: short(1), Palette: wide_palette, BlockData: Int8Array.of(0xAC - 256, 0x02, 5) }, "Schematic");
    const back = read_blueprint(wide);
    assert.equal(format_state(back.palette[back.ps[0]]), "test:b300");
    assert.equal(back.ps.length, 2);
    // Damaged: not enough data, or a number that is not in the palette
    assert.throws(() => read_blueprint(write_nbt({ Version: 2, Width: short(3), Height: short(1), Length: short(1), Palette: palette, BlockData: Int8Array.of(1) }, "Schematic")), /less blocks/);
    assert.throws(() => read_blueprint(write_nbt({ Version: 2, Width: short(1), Height: short(1), Length: short(1), Palette: palette, BlockData: Int8Array.of(9) }, "Schematic")), /not in its palette/);
    assert.throws(() => read_blueprint(write_nbt({ Version: 2, Width: short(1), Height: short(1), Length: short(1), Palette: palette, BlockData: Int8Array.of(-1, -1, -1, -1, -1, -1) }, "Schematic")), /too long/);
});

test("structures: air is skipped, blocks outside the box and unknown keys are left alone, the first of several palettes is used", () => {
    const structure = (extra = {}) => write_nbt({
        DataVersion: 3955, size: list(TAG.INT, [2, 2, 2]), Railways_DataVersion: 2,
        palette: list(TAG.COMPOUND, [{ Name: "minecraft:air" }, { Name: "minecraft:lever", Properties: { face: "floor", powered: "true" } }]),
        blocks: list(TAG.COMPOUND, [
            { pos: list(TAG.INT, [0, 0, 0]), state: 1 }, { pos: list(TAG.INT, [1, 0, 0]), state: 0 }, { pos: list(TAG.INT, [1, 1, 1]), state: 1, nbt: { id: "x" } },
            { pos: list(TAG.INT, [5, 0, 0]), state: 1 },
        ]),
        entities: list(TAG.COMPOUND, [{ pos: list(TAG.DOUBLE, [0, 0, 0]) }]),
        ...extra,
    }, "");
    const blueprint = read_blueprint(structure());
    assert.deepEqual([...states_of(blueprint).keys()].sort(), ["0,0,0", "1,1,1"]);
    assert.equal(blueprint.meta.ignored.block_entities, 1);
    assert.equal(blueprint.meta.ignored.entities, 1);
    const several = read_blueprint(structure({ palette: undefined, palettes: list(TAG.LIST, [list(TAG.COMPOUND, [{ Name: "minecraft:air" }, { Name: "minecraft:stone" }])]) }));
    assert.equal(states_of(several).get("0,0,0"), "minecraft:stone");
    assert.throws(() => read_blueprint(structure({ blocks: list(TAG.COMPOUND, [{ pos: list(TAG.INT, [0, 0, 0]), state: 7 }]) })), /not understood/);
});

test("what cannot be read says why", () => {
    const legacy = write_nbt({ Width: short(1), Height: short(1), Length: short(1), Materials: "Alpha", Blocks: Int8Array.of(1), Data: Int8Array.of(0) }, "Schematic");
    assert.throws(() => read_blueprint(legacy), (error) => {
        assert.ok(error instanceof SchematicError);
        assert.equal(error.code, "legacy");
        assert.match(error.message, /old \.schematic/);
        return true;
    });
    // A Bedrock structure: uncompressed, little endian, but it starts like Java NBT
    assert.throws(() => read_blueprint(Uint8Array.of(10, 0, 0, 3, 7, 0, 102, 111, 114, 109, 97, 116, 95, 118, 1, 0, 0, 0, 0)), { code: "bedrock" });
    assert.throws(() => read_blueprint(Uint8Array.of(80, 75, 3, 4, 0, 0)), { code: "unknown" });
    assert.throws(() => read_blueprint(write_nbt({ hello: 1 }, "")), { code: "unknown", message: /not a litematic/ });
    assert.throws(() => read_blueprint(write_nbt({ size: list(TAG.INT, [0, 1, 1]), palette: list(TAG.COMPOUND, []), blocks: list(TAG.COMPOUND, []) }, "")), { code: "damaged" });
    assert.throws(() => read_blueprint(new Uint8Array(0)), SchematicError);
});

test("a world becomes a blueprint of the smallest box, and a blueprint fills a world of its size", () => {
    const world = new World({ x: 100, y: 100, z: 100 });
    world.set(10, 20, 30, { name: "minecraft:stone", props: {} });
    world.set(12, 21, 35, { name: "minecraft:observer", props: { facing: "north", powered: "true" } });
    world.set(11, 20, 31, { name: "minecraft:stone", props: {} });
    const blueprint = blueprint_from_world(world);
    assert.deepEqual(blueprint.size, { x: 3, y: 2, z: 6 });
    assert.equal(blueprint.palette.length, 2, "the same state is in the palette once");
    assert.equal(blueprint_from_world(new World({ x: 5, y: 5, z: 5 })), null);
    const bytes = write_blueprint(blueprint, "litematic", {});
    const target = new World({ x: 4, y: 4, z: 4 });
    target.set(0, 0, 0, { name: "minecraft:dirt", props: {} });
    assert.equal(fill_world(read_blueprint(bytes), target), 3);
    assert.deepEqual(target.size, { x: 3, y: 2, z: 6 });
    assert.equal(target.get(0, 0, 0).name, "minecraft:stone");
    assert.deepEqual(target.get(2, 1, 5), { name: "minecraft:observer", props: { facing: "north", powered: "true" } });
    assert.equal(target.get(1, 0, 1).name, "minecraft:stone");
    assert.equal(target.get(1, 1, 1), null);
});

test("a big file: a model of 300 x 40 x 300 goes through every format", () => {
    const world = new World({ x: 300, y: 40, z: 300 });
    for (let x = 0; x < 300; x += 2) {
        for (let z = 0; z < 300; z += 2) {
            world.set(x, (x + z) % 40, z, { name: x % 3 ? "minecraft:stone" : "minecraft:glass", props: {} });
        }
    }
    world.set(299, 39, 299, { name: "minecraft:dirt", props: {} });
    const blueprint = blueprint_from_world(world);
    assert.deepEqual(blueprint.size, { x: 300, y: 40, z: 300 });
    for (const format of ["litematic", "schem", "nbt"]) {
        const back = read_blueprint(write_blueprint(blueprint, format, {}));
        assert.equal(back.ps.length, world.count, format);
        assert.deepEqual(back.size, blueprint.size);
    }
});
