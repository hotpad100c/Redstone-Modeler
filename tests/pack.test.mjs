import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { enumerate_states, parse_variant_key, state_count, select_models, select_models_layered, when_matches } from "../js/pack/BlockStates.mjs";
import { collect, collect_lang } from "../js/pack/Compiler.mjs";
import { CompiledPack, pretty_name } from "../js/pack/CompiledPack.mjs";
import { read_rmpack, write_rmpack } from "../js/pack/Rmpack.mjs";
import { Pack, locate_assets, parse_json } from "../js/pack/Pack.mjs";
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
    assert.deepEqual([...pack.paths()], ["assets/minecraft/blockstates/a.json"]);
});

const located = paths => Object.fromEntries(locate_assets(paths));

test("assets folder is found at the top, one level down and deeper", () => {
    assert.deepEqual(located(["assets/m/models/a.json"]), { "assets/m/models/a.json": "assets/m/models/a.json" });
    assert.deepEqual(located(["Pack/assets/m/models/a.json"]), { "Pack/assets/m/models/a.json": "assets/m/models/a.json" });
    assert.deepEqual(
        located(["repo-main/src/main/resources/assets/mod/blockstates/b.json"]),
        { "repo-main/src/main/resources/assets/mod/blockstates/b.json": "assets/mod/blockstates/b.json" },
    );
});

test("only the shallowest level with an assets folder counts, and nested folders named assets stay intact", () => {
    const result = located([
        "assets/m/textures/assets/deep.png",
        "docs/assets/images/logo.png",
        "src/main/resources/assets/other/models/x.json",
    ]);
    assert.deepEqual(result, { "assets/m/textures/assets/deep.png": "assets/m/textures/assets/deep.png" });
});

test("several modules at the same depth are merged and the first file wins", () => {
    const paths = [
        "common/src/main/resources/assets/mod/models/block/a.json",
        "fabric/src/main/resources/assets/mod/models/block/a.json",
        "fabric/src/main/resources/assets/mod/models/block/b.json",
    ];
    assert.deepEqual(located(paths), Object.fromEntries(paths.map(p => [p, p.slice(p.indexOf("assets/"))])));
});

test("a zip of the contents of an assets folder is recognised by its namespace folders", () => {
    assert.deepEqual(
        located(["mymod/models/block/a.json", "mymod/textures/block/a.png", "readme/other.json"]),
        { "mymod/models/block/a.json": "assets/mymod/models/block/a.json", "mymod/textures/block/a.png": "assets/mymod/textures/block/a.png" },
    );
    assert.deepEqual(located(["Wrapper/mymod/blockstates/a.json"]), { "Wrapper/mymod/blockstates/a.json": "assets/mymod/blockstates/a.json" });
});

test("archives without any resource layout give nothing", () => {
    assert.equal(locate_assets(["readme.json", "src/Main.json", "assets/loose.png"]).size, 0);
});

test("zip loading finds a deep assets folder and keeps the first duplicate", () => {
    const zip = zip_of({
        "x/y/z/assets/mod/blockstates/a.json": { variants: { "": { model: "mod:block/a" } } },
        "x/y/z/assets/mod/models/block/a.json": { elements: [] },
    });
    const pack = Pack.from_zip("deep", zip);
    assert.deepEqual([...pack.paths()].sort(), ["assets/mod/blockstates/a.json", "assets/mod/models/block/a.json"]);
    assert.ok(pack.json("assets/mod/blockstates/a.json").variants);
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
    const lang = Object.fromEntries(Object.entries(data.lang).map(([code, names]) => [code, new TextEncoder().encode(JSON.stringify(names))]));
    return new CompiledPack({ ...data, name: "test", atlas: { width: 1024, height: 32, textures } }, { lang });
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

test("state enumeration covers the cartesian product", () => {
    const wire = {
        power: Array.from({ length: 16 }, (_, i) => String(i)),
        north: ["none", "side", "up"],
        east: ["none", "side", "up"],
        south: ["none", "side", "up"],
        west: ["none", "side", "up"],
    };
    assert.equal(state_count(wire), 1296);
    const all = [...enumerate_states(wire)];
    assert.equal(all.length, 1296);
    assert.equal(new Set(all.map(s => JSON.stringify(s))).size, 1296);
    assert.deepEqual(all[0], { power: "0", north: "none", east: "none", south: "none", west: "none" });
    assert.equal([...enumerate_states(wire, { power: "15", north: "up" })].length, 27);
    assert.equal([...enumerate_states(wire, { power: "99" })].length, 0);
    assert.deepEqual([...enumerate_states({})], [{}]);
    assert.equal(state_count({}), 1);
});

test("signature tells apart states that look different and merges ones that look the same", () => {
    const base = compiled(new PackStack([base_pack()]));
    const same = (a, b) => base.signature("minecraft:observer", a) === base.signature("minecraft:observer", b);
    assert.ok(same({ facing: "north", powered: "false" }, { facing: "north", powered: "true" }));
    assert.ok(!same({ facing: "north", powered: "false" }, { facing: "east", powered: "false" }));
    const layered = compiled(stack());
    assert.notEqual(
        layered.signature("minecraft:observer", { facing: "north", powered: "false" }),
        layered.signature("minecraft:observer", { facing: "north", powered: "true" }),
    );
});

test("several namespaces under one assets folder stay separate and can refer to each other", () => {
    const cube = textures => ({
        textures,
        elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(["down", "up", "north", "south", "west", "east"].map(d => [d, { texture: "#all" }])) }],
    });
    const zip = zip_of({
        "assets/minecraft/blockstates/stone.json": { variants: { "": { model: "block/stone" } } },
        "assets/minecraft/blockstates/chest.json": { variants: { "": { model: "block/chest" } } },
        "assets/minecraft/models/block/stone.json": cube({ all: "block/stone" }),
        "assets/minecraft/models/block/chest.json": cube({ all: "block/chest" }),
        "assets/minecraft/models/block/cube_all.json": cube({}),
        "assets/create/blockstates/cog.json": { variants: { "axis=x": { model: "create:block/cog", x: 90 }, "axis=y": { model: "create:block/cog" } } },
        "assets/create/blockstates/chest.json": { variants: { "": { model: "create:block/chest" } } },
        "assets/create/models/block/cog.json": { parent: "minecraft:block/cube_all", textures: { all: "create:block/cog", particle: "block/stone" } },
        "assets/create/models/block/chest.json": cube({ all: "create:block/chest" }),
    });
    const data = collect(new PackStack([Pack.from_zip("both", zip)]));
    assert.deepEqual(Object.keys(data.index), ["create:chest", "create:cog", "minecraft:chest", "minecraft:stone"]);
    assert.deepEqual(data.index["create:cog"], { axis: ["x", "y"] });
    assert.ok(data.models["create:block/cog"].elements.length === 1, "parent from the other namespace was used");
    assert.equal(data.models["create:block/cog"].elements[0].faces.up.texture, "create:block/cog");
    assert.equal(data.models["minecraft:block/chest"].elements[0].faces.up.texture, "minecraft:block/chest");
    assert.equal(data.models["create:block/chest"].elements[0].faces.up.texture, "create:block/chest");
    assert.ok(data.textures.includes("create:block/cog") && data.textures.includes("minecraft:block/stone"));
});

test("block names are read from the language files of every pack, higher packs win", () => {
    const { languages, names } = collect_lang(stack(), ["minecraft:stone", "minecraft:observer", "minecraft:chest", "minecraft:missing"]);
    assert.deepEqual(languages.map(l => l.code), ["de_de", "en_us", "zh_cn"]);
    assert.deepEqual(languages.find(l => l.code === "zh_cn"), { code: "zh_cn", name: "简体中文", region: "中国" });
    assert.equal(names.zh_cn["minecraft:observer"], "侦测器（红石版）", "the overlay pack renames the block");
    assert.equal(names.zh_cn["minecraft:stone"], "石头", "other names come from the base pack");
    assert.equal(names.en_us["minecraft:chest"], "Chest");
    assert.equal(names.zh_cn["minecraft:chest"], undefined, "no entry for a name nobody has");
    assert.equal(names.en_us["minecraft:missing"], undefined);
    assert.deepEqual(Object.keys(names.de_de), ["minecraft:stone"]);
});

test("block name keys follow the game: namespace, then the path with dots for slashes", () => {
    const pack = make_pack("m", {
        "assets/mod/lang/en_us.json": { "block.mod.sub.thing": "Sub Thing", "block.mod.plain": "Plain", "block.other.plain": "Not ours" },
        "assets/mod/lang/ZH_CN.json": { "block.mod.plain": "朴素" },
    });
    const { names } = collect_lang(new PackStack([pack]), ["mod:sub/thing", "mod:plain"]);
    assert.deepEqual(names.en_us, { "mod:sub/thing": "Sub Thing", "mod:plain": "Plain" });
    assert.deepEqual(names.zh_cn, { "mod:plain": "朴素" }, "language file names are matched without regard to case");
});

test("display names fall back to English and then to a name made from the id", () => {
    const pack = compiled(stack());
    assert.equal(pack.display_name("minecraft:stone", "zh_cn"), "石头");
    assert.equal(pack.display_name("minecraft:chest", "zh_cn"), "Chest", "not in Chinese, so English");
    assert.equal(pack.display_name("minecraft:stone", ""), "Stone");
    assert.equal(pack.display_name("minecraft:stone", "xx_xx"), "Stone", "unknown language");
    assert.equal(pack.display_name("minecraft:oak_stairs", "zh_cn"), "Oak Stairs", "in no language file");
    assert.equal(pretty_name("create:copper/casing_block"), "Casing Block");
    assert.deepEqual(pack.languages.map(l => l.code), ["de_de", "en_us", "zh_cn"]);
});

test("a compiled pack without language data still works", () => {
    const data = collect(new PackStack([make_pack("x", { "assets/minecraft/blockstates/stone.json": { variants: { "": { model: "block/stone" } } } })]));
    const pack = new CompiledPack({ ...data, name: "old", atlas: { width: 16, height: 16, textures: {} } });
    assert.deepEqual(pack.languages, []);
    assert.equal(pack.display_name("minecraft:stone", "zh_cn"), "Stone");
});

test(".rmpack keeps the language files", () => {
    const bytes = write_rmpack({ name: "x", atlas: {}, index: {} }, new Uint8Array([1, 2, 3]), {}, { zh_cn: new TextEncoder().encode("{\"a\":\"b\"}") });
    const { lang } = read_rmpack(bytes);
    assert.deepEqual(Object.keys(lang), ["zh_cn"]);
    assert.equal(new TextDecoder().decode(lang.zh_cn), "{\"a\":\"b\"}");
    assert.deepEqual(read_rmpack(write_rmpack({ name: "x", atlas: {}, index: {} }, new Uint8Array([1]))).lang, {});
});
