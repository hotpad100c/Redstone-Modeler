import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { collect } from "../js/pack/Compiler.mjs";
import { PackStack } from "../js/pack/PackStack.mjs";
import { make_pack } from "./fixtures.mjs";

const fallback = JSON.parse(readFileSync(new URL("../data/fallback.json", import.meta.url), "utf8"));
const DIRECTIONS = ["north", "east", "south", "west", "up", "down"];

test("the file is what scripts/make_fallback.mjs writes", () => {
    const script = new URL("../scripts/make_fallback.mjs", import.meta.url);
    const before = readFileSync(new URL("../data/fallback.json", import.meta.url), "utf8");
    const result = spawnSync(process.execPath, [script.pathname], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(new URL("../data/fallback.json", import.meta.url), "utf8"), before);
});

test("every model has boxes with faces that point somewhere on the texture", () => {
    assert.deepEqual(Object.keys(fallback.models).sort(), ["custom:entity/chest", "custom:entity/chest_left", "custom:entity/chest_right", "custom:entity/shulker_box"]);
    for (const [id, model] of Object.entries(fallback.models)) {
        assert.match(model.textures.all, /^minecraft:entity\//, id);
        assert.ok(model.elements.length >= 2, id);
        for (const element of model.elements) {
            assert.ok(element.from.every((v, i) => v >= 0 && v <= 16 && element.to[i] > v && element.to[i] <= 16), `${id} box ${element.from} ${element.to}`);
            for (const [direction, face] of Object.entries(element.faces)) {
                assert.ok(DIRECTIONS.includes(direction), direction);
                assert.equal(face.texture, "#all");
                const [x1, y1, x2, y2] = face.uv;
                assert.ok(x1 >= 0 && y1 >= 0 && x2 <= 16 && y2 <= 16 && x1 < x2 && y1 < y2, `${id} ${direction} ${face.uv}`);
            }
        }
    }
});

test("the halves of a double chest are open towards each other, and the whole is closed on the outside", () => {
    const sides = id => fallback.models[id].elements[0].faces;
    assert.equal("east" in sides("custom:entity/chest_left"), false, "the left half has no wall to the east");
    assert.equal("west" in sides("custom:entity/chest_left"), true);
    assert.equal("west" in sides("custom:entity/chest_right"), false, "the right half has no wall to the west");
    assert.equal("east" in sides("custom:entity/chest_right"), true);
    const box = id => fallback.models[id].elements[0];
    assert.equal(box("custom:entity/chest_left").to[0], 16, "it reaches the middle of the double chest");
    assert.equal(box("custom:entity/chest_right").from[0], 0);
    for (const id of ["custom:entity/chest", "custom:entity/chest_left", "custom:entity/chest_right"]) {
        const open = id.endsWith("left") ? "east" : id.endsWith("right") ? "west" : null;
        assert.deepEqual(DIRECTIONS.filter(d => !(d in sides(id))), open ? [open] : [], id);
    }
});

test("chests and shulker boxes have a state for every way they can stand", () => {
    const chest = Object.keys(fallback.blockstates.chest.variants);
    assert.equal(chest.length, 12);
    for (const facing of ["north", "south", "east", "west"]) {
        for (const type of ["single", "left", "right"]) {
            assert.ok(chest.includes(`facing=${facing},type=${type}`));
        }
    }
    assert.deepEqual(Object.keys(fallback.blockstates.shulker_box.variants).sort(), ["facing=down", "facing=east", "facing=north", "facing=south", "facing=up", "facing=west"]);
});

test("a block that the packs give no geometry takes its model from the fallback", () => {
    const pack = make_pack("p", {
        "assets/minecraft/blockstates/chest.json": { variants: { "": { model: "minecraft:block/chest" } } },
        "assets/minecraft/blockstates/shulker_box.json": { variants: { "": { model: "minecraft:block/shulker_box" } } },
        "assets/minecraft/models/block/chest.json": { textures: { particle: "minecraft:block/oak_planks" } },
        "assets/minecraft/models/block/shulker_box.json": { textures: { particle: "minecraft:block/shulker_box" } },
    });
    const data = collect(new PackStack([pack]), {}, fallback);
    assert.ok("minecraft:chest" in data.index && "minecraft:shulker_box" in data.index);
    assert.ok(Object.keys(data.models).includes("custom:entity/chest_left"));
    assert.ok(data.textures.includes("minecraft:entity/chest/normal") && data.textures.includes("minecraft:entity/shulker/shulker"));
    assert.deepEqual(Object.keys(data.index["minecraft:chest"]).sort(), ["facing", "type"]);
});
