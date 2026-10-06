import assert from "node:assert/strict";
import { test } from "node:test";
import { World } from "../js/model/World.mjs";
import { select_models_layered } from "../js/pack/BlockStates.mjs";
import { CompiledPack } from "../js/pack/CompiledPack.mjs";
import { normalize_id } from "../js/pack/PackStack.mjs";
import { read_rmpack, write_rmpack } from "../js/pack/Rmpack.mjs";
import { SHARE_PREFIX, build_mini_data, decode_code, encode_code, read_model, used_states } from "../js/share/Share.mjs";
import { compiled_pack, stack } from "./fixtures.mjs";

const pack = compiled_pack(stack());

function model() {
    const world = new World({ x: 8, y: 8, z: 8 });
    world.set(0, 0, 0, { name: "minecraft:observer", props: { facing: "south", powered: "true" } });
    world.set(1, 0, 0, { name: "minecraft:observer", props: { facing: "north", powered: "false" } });
    world.set(2, 0, 0, { name: "minecraft:observer", props: { facing: "north", powered: "false" } });
    world.set(3, 0, 0, { name: "minecraft:stone", props: {} });
    world.set(4, 0, 0, { name: "minecraft:oak_fence", props: { north: "true", stray: "x" } });
    world.set(5, 0, 0, { name: "minecraft:nope", props: {} });
    return world;
}

const picks = (defs, state) => (select_models_layered(defs, state) ?? []).map(v => ({ model: normalize_id(v.model), x: v.x, y: v.y, uvlock: v.uvlock }));

test("the states of a model are counted once, with every property filled in, unknown blocks left out", () => {
    const used = used_states(model(), pack);
    assert.deepEqual([...used.keys()].sort(), ["minecraft:observer", "minecraft:oak_fence", "minecraft:stone"].sort());
    assert.equal(used.get("minecraft:observer").size, 2);
    assert.deepEqual([...used.get("minecraft:stone").values()], [{}]);
    const [fence] = [...used.get("minecraft:oak_fence").values()];
    assert.equal(fence.north, "true");
    assert.equal(fence.east, "false", "filled in with the default");
    assert.ok(!("stray" in fence), "a property the block does not have is dropped");
});

test("only the used states: the same models are picked as in the full pack, and unused states have none", () => {
    const used = used_states(model(), pack);
    const { data } = build_mini_data(pack, used, { scope: "used", languages: ["en_us", "zh_cn"] });
    for (const [name, states] of used) {
        for (const state of states.values()) {
            assert.deepEqual(picks(data.blockstates[name], state), picks(pack.data.blockstates[name], state), `${name} ${JSON.stringify(state)}`);
        }
    }
    const unused = { facing: "east", powered: "false" };
    assert.ok(picks(pack.data.blockstates["minecraft:observer"], unused).length > 0);
    assert.deepEqual(picks(data.blockstates["minecraft:observer"], unused), []);
    // The overlay pack on top decides powered, the base pack the rest
    assert.equal(picks(data.blockstates["minecraft:observer"], { facing: "south", powered: "true" })[0].model, "minecraft:block/observer_on");
    assert.equal(picks(data.blockstates["minecraft:observer"], { facing: "north", powered: "false" })[0].model, "minecraft:block/observer");
});

test("only the models, textures and names that the model needs are kept", () => {
    const used = used_states(model(), pack);
    const { data, texture_ids, lang } = build_mini_data(pack, used, { scope: "used", languages: ["en_us", "zh_cn", ""] });
    assert.deepEqual(Object.keys(data.models).sort(), [
        "minecraft:block/observer", "minecraft:block/observer_on", "minecraft:block/post", "minecraft:block/side", "minecraft:block/stone",
    ].sort());
    assert.ok(texture_ids.includes("minecraft:missing"));
    assert.ok(texture_ids.includes("minecraft:block/observer_front_on"));
    assert.ok(texture_ids.includes("minecraft:block/stone"));
    assert.ok(!texture_ids.includes("minecraft:block/lamp"), "the lamp is not in the model");
    assert.ok(!texture_ids.includes("minecraft:block/glass"));
    assert.deepEqual(Object.keys(data.index).sort(), ["minecraft:observer", "minecraft:oak_fence", "minecraft:stone"].sort());
    assert.deepEqual(data.index["minecraft:observer"], { facing: ["north", "south"], powered: ["false", "true"] }, "only the values that are used");
    assert.deepEqual(Object.keys(lang).sort(), ["en_us", "zh_cn"], "no other language");
    assert.deepEqual(lang.zh_cn, { "minecraft:observer": "侦测器（红石版）", "minecraft:stone": "石头" });
    assert.deepEqual(data.languages.map(l => l.code).sort(), ["en_us", "zh_cn"]);
    assert.deepEqual(data.tint_colors.grass, [0x91, 0xBD, 0x59]);
    assert.equal(data.name, "test (shared)");
    assert.equal(data.shared, true);
});

test("every state of the blocks: the original definitions and everything they refer to", () => {
    const used = used_states(model(), pack);
    const { data } = build_mini_data(pack, used, { scope: "all", languages: ["en_us"] });
    assert.deepEqual(data.blockstates["minecraft:observer"], pack.data.blockstates["minecraft:observer"]);
    assert.deepEqual(data.index["minecraft:observer"], pack.data.index["minecraft:observer"]);
    // east/powered=false was not placed, but it works here
    assert.deepEqual(picks(data.blockstates["minecraft:observer"], { facing: "east", powered: "false" }), picks(pack.data.blockstates["minecraft:observer"], { facing: "east", powered: "false" }));
    assert.ok("minecraft:block/observer" in data.models && "minecraft:block/observer_on" in data.models);
    assert.ok(!("minecraft:block/lamp" in data.models));
});

test("a shared pack builds the same geometry as the pack it came from", () => {
    const used = used_states(model(), pack);
    for (const scope of ["used", "all"]) {
        const { data, texture_ids, lang } = build_mini_data(pack, used, { scope, languages: ["en_us"] });
        // Same rectangles, only for the textures that were kept
        data.atlas = { width: 1024, height: 32, textures: Object.fromEntries(texture_ids.map(id => [id, pack.data.atlas.textures[id]])) };
        const lang_bytes = Object.fromEntries(Object.entries(lang).map(([code, names]) => [code, new TextEncoder().encode(JSON.stringify(names))]));
        const copy = new CompiledPack(data, { lang: lang_bytes });
        for (const [name, states] of used) {
            for (const state of states.values()) {
                assert.deepEqual(copy.geometry(name, state), pack.geometry(name, state), `${scope} ${name} ${JSON.stringify(state)}`);
            }
        }
        assert.equal(copy.display_name("minecraft:stone", "en_us"), "Stone");
        assert.ok(JSON.stringify(data).length < JSON.stringify(pack.data).length, `${scope} is smaller than the whole pack`);
    }
});

test("a pack that is already shared keeps a single suffix", () => {
    const shared = new CompiledPack({ ...pack.data, name: "Mine (shared)" });
    const { data } = build_mini_data(shared, used_states(model(), shared), { scope: "used", languages: [] });
    assert.equal(data.name, "Mine (shared)");
});

test("share codes carry the bytes, ignore white space and refuse what is not a code", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7 + (i >> 5)) % 256);
    const code = encode_code(bytes);
    assert.ok(code.startsWith(SHARE_PREFIX));
    assert.deepEqual(decode_code(`  ${code.slice(0, 50)}\n${code.slice(50)}  `), bytes);
    assert.throws(() => decode_code("hello"), /not a share code/);
    assert.throws(() => decode_code(`${SHARE_PREFIX}!!!not base64`), /damaged/);
    assert.deepEqual(decode_code(SHARE_PREFIX), new Uint8Array(0));
});

test("a shared model is a resource pack with the model in it", () => {
    const save = { version: 2, size: { x: 4, y: 4, z: 4 }, packs: [], palette: [], blocks: [] };
    const bytes = write_rmpack({ name: "x", atlas: {}, index: {} }, new Uint8Array([1, 2, 3]), {}, {}, { "world.json": new TextEncoder().encode(JSON.stringify(save)) });
    assert.deepEqual(read_model(bytes).world, save);
    assert.equal(read_rmpack(bytes).data.name, "x", "it also loads as a plain pack");
    const without = write_rmpack({ name: "x", atlas: {}, index: {} }, new Uint8Array([1]));
    assert.throws(() => read_model(without), /no model in it/);
    assert.throws(() => read_model(new Uint8Array([1, 2, 3, 4])), /could not be read/);
});

test("a file that unpacks to something huge is refused", () => {
    const bytes = write_rmpack({ name: "x", atlas: {}, index: {} }, new Uint8Array([1]), {}, { aa: new Uint8Array(2_000_000) });
    assert.throws(() => read_rmpack(bytes, 1_000_000), /too big/);
    assert.doesNotThrow(() => read_rmpack(bytes));
});

test("a damaged model in a shared pack shows as a missing block instead of breaking", () => {
    const broken = new CompiledPack({
        ...pack.data,
        models: { "minecraft:block/stone": { elements: "nonsense", builtin: null, particle: null } },
        blockstates: { "minecraft:stone": [{ variants: { "": { model: "minecraft:block/stone" } } }] },
    });
    const geometry = broken.geometry("minecraft:stone", {});
    assert.equal(geometry.quads.length, 6);
    assert.ok(geometry.quads.every(q => q.tex === "minecraft:missing"));
});
