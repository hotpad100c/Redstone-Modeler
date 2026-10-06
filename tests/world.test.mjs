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
    assert.equal(world.blocks.size, 5, "counting does not change anything");
    const before = world.version;
    assert.equal(world.resize({ x: 3, y: 3, z: 3 }), 3);
    assert.equal(world.blocks.size, 2);
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
    for (const bad of [{ x: 0, y: 1, z: 1 }, { x: 65, y: 1, z: 1 }, { x: 1.5, y: 1, z: 1 }, { x: 1, y: 1 }, null, "20"]) {
        assert.equal(valid_size(bad), false, JSON.stringify(bad));
    }
});

test("settings fall back to the defaults and are clamped", () => {
    assert.deepEqual(normalize(null), normalize(undefined));
    assert.deepEqual(normalize({}).size, DEFAULTS.size);
    assert.deepEqual(normalize({ size: { x: 1000, y: -3, z: "8" } }).size, { x: 64, y: 1, z: 8 });
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
