import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse_variant_key, select_models, select_models_layered, when_matches } from "../js/pack/BlockStates.mjs";
import { collect } from "../js/pack/Compiler.mjs";
import { CompiledPack } from "../js/pack/CompiledPack.mjs";
import { Pack, parse_json } from "../js/pack/Pack.mjs";
import { PackStack } from "../js/pack/PackStack.mjs";
import { base_pack, make_pack, overlay_pack, stack, zip_of, base_files } from "./fixtures.mjs";

const extra = JSON.parse(readFileSync(new URL("../data/block_properties.json", import.meta.url), "utf8"));

test("variant keys", () => {
    assert.deepEqual(parse_variant_key("facing=north,powered=true"), { facing: "north", powered: "true" });
    assert.deepEqual(parse_variant_key(""), {});
    assert.deepEqual(parse_variant_key("normal"), {});
});

test("multipart when clauses", () => {
    assert.equal(when_matches({ north: "true" }, { north: "true" }), true);
    assert.equal(when_matches({ north: "side|up" }, { north: "up" }), true);
    assert.equal(when_matches({ north: "side|up" }, { north: "none" }), false);
    assert.equal(when_matches({ OR: [{ east: "true" }, { west: "true" }] }, { west: "true", east: "false" }), true);
    assert.equal(when_matches({ AND: [{ east: "true" }, { west: "true" }] }, { west: "true", east: "false" }), false);
});

test("variants pick the most specific match, weighted lists use the first entry", () => {
    const def = {
        variants: {
            "": { model: "a" },
            "facing=north": [{ model: "b", y: 90 }, { model: "c" }],
        },
    };
    assert.deepEqual(select_models(def, { facing: "north" }), [{ model: "b", x: 0, y: 90, uvlock: false }]);
    assert.equal(select_models(def, { facing: "south" })[0].model, "a");
});

test("lenient json", () => {
    assert.deepEqual(parse_json("﻿{ // note\n \"a\": [1, 2,], /* x */ \"b\": \"//kept\", }"), { a: [1, 2], b: "//kept" });
});

test("zip loading strips a wrapper folder and drops unrelated files", () => {
    const zip = zip_of({ "MyPack/assets/minecraft/blockstates/a.json": { variants: {} }, "MyPack/pack.mcmeta": {}, "MyPack/sounds/x.ogg": new Uint8Array(3) });
    const pack = Pack.from_zip("wrapped", zip);
    assert.ok(pack.has("assets/minecraft/blockstates/a.json"));
    assert.ok(pack.has("pack.mcmeta"));
    assert.equal([...pack.paths()].length, 2);
});

test("stack: the top layer wins for files", () => {
    const top = make_pack("top", { "assets/minecraft/models/block/x.json": { v: "top" } });
    const bottom = make_pack("bottom", { "assets/minecraft/models/block/x.json": { v: "bottom" }, "assets/minecraft/models/block/y.json": { v: "y" } });
    const s = new PackStack([top, bottom]);
    assert.equal(s.json("assets/minecraft/models/block/x.json").v, "top");
    assert.equal(s.json("assets/minecraft/models/block/y.json").v, "y");
    assert.deepEqual(s.list_ids("models", "json").sort(), ["minecraft:block/x", "minecraft:block/y"]);
});

test("layered overlay exposes `powered` that the base pack never mentions", () => {
    const base_only = collect(new PackStack([base_pack()]));
    assert.deepEqual(Object.keys(base_only.index["minecraft:observer"]), ["facing"]);

    const stacked = collect(stack());
    assert.deepEqual(Object.keys(stacked.index["minecraft:observer"]).sort(), ["facing", "powered"]);
    assert.deepEqual(stacked.index["minecraft:observer"].powered, ["false", "true"]);
});

test("property supplement adds vanilla properties no file mentions", () => {
    const compiled = collect(new PackStack([base_pack()]), extra);
    assert.deepEqual(Object.keys(compiled.index["minecraft:observer"]).sort(), ["facing", "powered"]);
    assert.equal(compiled.index["minecraft:observer"].facing[0], "north");
});

test("layers fall through: powered=false uses the base model, powered=true the overlay", () => {
    const { blockstates } = collect(stack());
    const defs = blockstates["minecraft:observer"];
    assert.equal(defs.length, 2);
    assert.equal(select_models_layered(defs, { facing: "north", powered: "true" })[0].model, "minecraft:block/observer_on");
    assert.equal(select_models_layered(defs, { facing: "north", powered: "false" })[0].model, "minecraft:block/observer");
});

test("collect resolves parents and texture variables", () => {
    const { models, textures } = collect(new PackStack([base_pack()]));
    const stone = models["minecraft:block/stone"];
    assert.equal(stone.elements.length, 1);
    assert.equal(stone.elements[0].faces.north.texture, "minecraft:block/stone");
    assert.ok(textures.includes("minecraft:block/observer_front"));
    assert.equal(models["minecraft:block/chest"].elements.length, 0);
    assert.equal(models["minecraft:block/chest"].particle, "minecraft:block/stone");
});

function compiled(s) {
    const data = collect(s, extra);
    const textures = Object.fromEntries([...data.textures, "minecraft:missing"].map((id, i) => [id, {
        x: i * 18, y: 0, w: 16, h: 16, opaque: !id.endsWith("glass"), translucent: id.endsWith("glass"),
    }]));
    return new CompiledPack({ ...data, name: "test", atlas: { width: 1024, height: 32, textures } });
}

test("compiled pack: powered observer uses the overlay texture, unpowered the base", () => {
    const pack = compiled(stack());
    const off = pack.geometry("minecraft:observer", { facing: "north", powered: "false" });
    const on = pack.geometry("minecraft:observer", { facing: "north", powered: "true" });
    assert.ok(off.quads.some(q => q.tex === "minecraft:block/observer_front"));
    assert.ok(on.quads.some(q => q.tex === "minecraft:block/observer_front_on"));
    assert.ok(!on.quads.some(q => q.tex === "minecraft:block/observer_front"));
});

test("compiled pack: observer faces rotate with the facing property", () => {
    const pack = compiled(stack());
    const front_dir = (facing) => {
        const quad = pack.geometry("minecraft:observer", { facing, powered: "false" }).quads.find(q => q.tex === "minecraft:block/observer_front");
        const c = [0, 1, 2].map(k => [0, 1, 2, 3].reduce((s, i) => s + quad.pos[i * 3 + k], 0) / 4 - 0.5);
        return c.map(v => Math.round(v * 2));
    };
    assert.deepEqual(front_dir("north"), [0, 0, -1]);
    assert.deepEqual(front_dir("east"), [1, 0, 0]);
    assert.deepEqual(front_dir("south"), [0, 0, 1]);
    assert.deepEqual(front_dir("up"), [0, 1, 0]);
    assert.deepEqual(front_dir("down"), [0, -1, 0]);
});

test("compiled pack: occlusion, multipart, tint and fallbacks", () => {
    const pack = compiled(stack());
    assert.equal(pack.geometry("minecraft:stone", {}).occludes, true);
    assert.equal(pack.geometry("minecraft:glass", {}).occludes, false);
    assert.equal(pack.geometry("minecraft:oak_slab", { type: "bottom" }).occludes, false);
    assert.equal(pack.geometry("minecraft:oak_fence", {}).quads.length, 6);
    assert.equal(pack.geometry("minecraft:oak_fence", { north: "true" }).quads.length, 12);
    assert.equal(pack.geometry("minecraft:oak_fence", { east: "true", west: "true" }).quads.length, 12);
    assert.ok(pack.geometry("minecraft:grass_block", {}).quads.some(q => q.tint === 0));
    // Entity model without elements still shows something
    assert.equal(pack.geometry("minecraft:chest", {}).quads.length, 6);
    // State no layer knows about: missing cube
    assert.ok(pack.geometry("minecraft:oak_slab", { type: "nope" }).quads.every(q => q.tex === "minecraft:missing"));
    assert.deepEqual(pack.default_state("minecraft:observer"), { facing: "north", powered: "false" });
});

test("fixtures are valid packs", () => {
    assert.ok(overlay_pack().has("assets/minecraft/blockstates/observer.json"));
    assert.ok(Object.keys(base_files()).length > 20);
});

test("entity blocks use the fallback model only when the packs give them no geometry", () => {
    const fallback = {
        blockstates: {
            chest: { variants: { "": { model: "custom:entity/chest" } } },
            stone: { variants: { "": { model: "custom:entity/chest" } } },
        },
        models: {
            "custom:entity/chest": {
                textures: { all: "block/stone" },
                elements: [{ from: [1, 0, 1], to: [15, 10, 15], faces: { north: { texture: "#all", uv: [0, 0, 4, 4] } } }],
            },
        },
    };
    const data = collect(new PackStack([base_pack()]), extra, fallback);
    assert.equal(data.blockstates["minecraft:chest"][0], fallback.blockstates.chest);
    assert.notEqual(data.blockstates["minecraft:stone"][0], fallback.blockstates.stone, "blocks with real models keep them");
    assert.equal(data.models["custom:entity/chest"].elements.length, 1);
    assert.ok(data.textures.includes("minecraft:block/stone"));
});
