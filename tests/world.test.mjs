import assert from "node:assert/strict";
import { test } from "node:test";
import { World } from "../js/model/World.mjs";
import { DEFAULTS, normalize, valid_size } from "../js/model/Settings.mjs";

const stone = { name: "minecraft:stone", props: {} };

test("the world copies the size it is given", () => {
    const size = { x: 4, y: 4, z: 4 };
    const world = new World(size);
    world.resize({ x: 2, y: 2, z: 2 });
    assert.deepEqual(size, { x: 4, y: 4, z: 4 });
});

test("shrinking removes blocks outside and reports how many", () => {
    const world = new World({ x: 6, y: 6, z: 6 });
    world.set(0, 0, 0, stone);
    world.set(1, 1, 1, stone);
    world.set(5, 0, 0, stone);
    world.set(0, 5, 0, stone);
    world.set(0, 0, 5, stone);
    assert.equal(world.count_outside({ x: 3, y: 3, z: 3 }), 3);
    assert.equal(world.count, 5, "counting does not change anything");
    const before = world.version;
    assert.equal(world.resize({ x: 3, y: 3, z: 3 }), 3);
    assert.equal(world.count, 2);
    assert.ok(world.version > before);
    assert.equal(world.in_bounds(3, 0, 0), false);
});

test("growing keeps every block", () => {
    const world = new World({ x: 2, y: 2, z: 2 });
    world.set(1, 1, 1, stone);
    assert.equal(world.resize({ x: 10, y: 3, z: 7 }), 0);
    assert.ok(world.get(1, 1, 1));
    assert.equal(world.set(9, 2, 6, stone), true);
});

test("size validation", () => {
    assert.equal(valid_size({ x: 1, y: 64, z: 20 }), true);
    assert.equal(valid_size({ x: 1, y: 4096, z: 20 }), true, "bigger than the old limit of 64");
    for (const bad of [{ x: 0, y: 1, z: 1 }, { x: 4097, y: 1, z: 1 }, { x: 1.5, y: 1, z: 1 }, { x: 1, y: 1 }, null, "20"]) {
        assert.equal(valid_size(bad), false, JSON.stringify(bad));
    }
});

test("settings fall back to the defaults and are clamped", () => {
    assert.deepEqual(normalize(null), normalize(undefined));
    assert.deepEqual(normalize({}).size, DEFAULTS.size);
    assert.deepEqual(normalize({ size: { x: 100000, y: -3, z: "8" } }).size, { x: 4096, y: 1, z: 8 });
    assert.deepEqual(normalize({ size: { x: "abc", y: 5.6, z: null } }).size, { x: 20, y: 6, z: 1 });
    assert.equal(normalize({ background: "red" }).background, DEFAULTS.background);
    assert.equal(normalize({ background: "#FF0000" }).background, "#ff0000");
    assert.equal(normalize({ plane_color: "#12" }).plane_color, DEFAULTS.plane_color);
    assert.equal(normalize({ plane_opacity: 5 }).plane_opacity, 1);
    assert.equal(normalize({ plane_opacity: -1 }).plane_opacity, 0);
    assert.equal(normalize({ plane_opacity: "x" }).plane_opacity, DEFAULTS.plane_opacity);
    assert.equal(normalize({ plane_opacity: null }).plane_opacity, DEFAULTS.plane_opacity);
    assert.equal(normalize({ plane_opacity: 0 }).plane_opacity, 0);
    assert.equal(normalize({}).search_language, "zh_cn", "Chinese by default");
    assert.equal(normalize({ search_language: "" }).search_language, "", "English only");
    assert.equal(normalize({ search_language: "de_de" }).search_language, "de_de");
    assert.equal(normalize({ search_language: "No Way!" }).search_language, "zh_cn");
    assert.equal(normalize({ search_language: 5 }).search_language, "zh_cn");
    assert.equal(normalize({}).language, "auto");
    assert.equal(normalize({ language: "zh-CN" }).language, "zh-CN");
    assert.equal(normalize({ language: "en" }).language, "en");
    assert.equal(normalize({ language: "<script>" }).language, "auto");
    assert.equal(normalize({ language: 3 }).language, "auto");
});

test("blocks are found again, across chunks and with a count", () => {
    const world = new World({ x: 100, y: 100, z: 100 });
    const cells = [[0, 0, 0], [15, 15, 15], [16, 0, 0], [0, 16, 0], [0, 0, 16], [99, 99, 99], [31, 32, 33]];
    for (const cell of cells) {
        assert.equal(world.set(...cell, { ...stone, props: { at: cell.join() } }), true);
    }
    assert.equal(world.count, cells.length);
    for (const cell of cells) {
        assert.equal(world.get(...cell).props.at, cell.join());
    }
    assert.equal(world.get(1, 1, 1), null);
    assert.equal(world.get(-1, 0, 0), null);
    assert.equal(world.get(500, 500, 500), null);
    assert.deepEqual([...world.entries()].map(([x, y, z]) => [x, y, z]).sort(), [...cells].sort());
    // Replacing a block does not change the count; removing does
    world.set(0, 0, 0, stone);
    assert.equal(world.count, cells.length);
    assert.equal(world.remove(0, 0, 0), true);
    assert.equal(world.remove(0, 0, 0), false);
    assert.equal(world.count, cells.length - 1);
    assert.equal(world.chunks.size, 6, "an empty chunk is dropped");
});

test("a change marks its own chunk, and the neighbours when it is on the border", () => {
    const world = new World({ x: 64, y: 64, z: 64 });
    const keys = () => world.take_dirty().map(key => World.chunk_coords(key).join()).sort();
    world.set(5, 5, 5, stone);
    assert.deepEqual(keys(), ["0,0,0"], "in the middle: itself only");
    assert.deepEqual(keys(), [], "taken once");
    world.set(16, 5, 5, stone);
    assert.deepEqual(keys(), ["0,0,0", "1,0,0"], "x border: the chunk at the west too");
    world.set(31, 16, 5, stone);
    assert.deepEqual(keys(), ["1,0,0", "1,1,0", "2,1,0"].sort(), "low y border and high x border");
    world.set(20, 20, 47, stone);
    assert.deepEqual(keys(), ["1,1,2", "1,1,3"], "high z border");
    world.remove(20, 20, 47);
    assert.deepEqual(keys(), ["1,1,2", "1,1,3"], "a removal marks the same");
    assert.equal(world.remove(20, 20, 47), false);
    assert.deepEqual(keys(), [], "nothing was removed, nothing to build");
    world.set(0, 0, 0, stone);
    assert.deepEqual(keys(), ["0,0,0"], "the edge of the world has no neighbour outside");
});

test("resize drops what is outside, also inside a chunk that stays", () => {
    const world = new World({ x: 64, y: 64, z: 64 });
    for (const cell of [[1, 1, 1], [20, 1, 1], [40, 40, 40], [17, 3, 3]]) {
        world.set(...cell, stone);
    }
    world.take_dirty();
    assert.equal(world.count_outside({ x: 18, y: 64, z: 64 }), 2);
    assert.equal(world.resize({ x: 18, y: 64, z: 64 }), 2);
    assert.equal(world.count, 2);
    assert.equal(world.get(20, 1, 1), null);
    assert.equal(world.get(17, 3, 3) !== null, true);
    assert.deepEqual(world.size, { x: 18, y: 64, z: 64 });
    assert.ok(world.dirty.size > 0, "what is left is built again");
    assert.equal(world.set(18, 0, 0, stone), false);
});

test("a world of any size: far away blocks and a large sparse model", () => {
    const world = new World({ x: 4096, y: 300, z: 4096 });
    assert.equal(world.set(4095, 299, 4095, stone), true);
    assert.equal(world.get(4095, 299, 4095), stone);
    for (let x = 0; x < 600; x += 3) {
        for (let z = 0; z < 600; z += 3) {
            world.set(x, (x + z) % 40, z, stone);
        }
    }
    assert.equal(world.count, 200 * 200 + 1);
    let seen = 0;
    for (const [x, , z] of world.entries()) {
        assert.ok((x % 3 === 0 && z % 3 === 0) || x === 4095);
        seen++;
    }
    assert.equal(seen, world.count);
    world.clear();
    assert.equal(world.count, 0);
    assert.equal([...world.entries()].length, 0);
});
