import assert from "node:assert/strict";
import { test } from "node:test";
import { World } from "../js/model/World.mjs";
import { decode, deserialize, encode, serialize } from "../js/model/Save.mjs";

test("world roundtrip through serialize/deserialize", () => {
    const world = new World({ x: 4, y: 4, z: 4 });
    world.set(0, 0, 0, { name: "minecraft:stone", props: {} });
    world.set(1, 2, 3, { name: "minecraft:observer", props: { facing: "up", powered: "true" } });
    world.set(2, 2, 2, { name: "minecraft:observer", props: { powered: "true", facing: "up" } });
    const save = serialize(world, ["a", "b"]);
    assert.equal(save.palette.length, 2, "same state with different key order shares a palette entry");
    const copy = new World({ x: 4, y: 4, z: 4 });
    assert.equal(deserialize(JSON.parse(JSON.stringify(save)), copy), 0);
    assert.deepEqual(copy.get(1, 2, 3), { name: "minecraft:observer", props: { facing: "up", powered: "true" } });
    assert.equal(copy.blocks.size, 3);
});

test("blocks outside a smaller world are dropped and counted", () => {
    const world = new World({ x: 4, y: 4, z: 4 });
    world.set(3, 3, 3, { name: "minecraft:stone", props: {} });
    const small = new World({ x: 2, y: 2, z: 2 });
    assert.equal(deserialize(serialize(world), small), 1);
});

test("old saves are rejected", () => {
    assert.throws(() => deserialize({ palette: ["assets/stone.png"], data: [] }, new World({ x: 1, y: 1, z: 1 })), /version 2/);
});

test("code encoding keeps the old base64 byte format", async () => {
    const save = { version: 2, hello: "world" };
    const lzma = {
        compress: (text, _mode, cb) => cb([...Buffer.from(text)].map(v => v - 128)),
        decompress: (bytes, cb) => cb(Buffer.from(bytes.map(v => v + 128)).toString()),
    };
    const code = await encode(save, lzma);
    assert.match(code, /^[A-Za-z0-9+/=]+$/);
    assert.deepEqual(await decode(code, lzma), save);
    await assert.rejects(decode("!!!", lzma));
});
