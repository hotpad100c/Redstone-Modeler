import assert from "node:assert/strict";
import { deflateSync } from "../lib/fflate.module.js";
import { test } from "node:test";
import { Reader, Writer, pack, unpack } from "../js/share/Compact.mjs";

const roundtrip = value => unpack(pack(value));

test("every kind of JSON value survives", () => {
    const values = [
        null, true, false, 0, 1, 239, 240, 255, 256, 65535, 1e9, 2 ** 40, Number.MAX_SAFE_INTEGER, -1, -240, -(2 ** 40), Number.MIN_SAFE_INTEGER,
        0.8, -0.5, 22.5, 15.2, 1e-7, 1.7976931348623157e308, 5e-324, 123456789.123,
        "", "a", "minecraft:activator_rail", "中文名字", "emoji 🧱 and \u0000 control", "x".repeat(10_000),
        [], {}, [[]], [{}], { a: [] }, [1, "a", null, true, 0.5, [2, [3, [4]]]],
        { facing: "north", powered: "true", nested: { from: [0, 0, 0], to: [16, 16, 16], rotation: { angle: -22.5 } } },
        Uint8Array.from([0, 1, 2, 255]), new Uint8Array(0), { bytes: Uint8Array.from([9, 8, 7]) },
    ];
    for (const value of values) {
        assert.deepEqual(roundtrip(value), value, JSON.stringify(value)?.slice(0, 80));
    }
});

test("negative zero and undefined behave like in JSON", () => {
    assert.equal(Object.is(roundtrip(-0), 0), true);
    assert.deepEqual(roundtrip({ a: undefined, b: 1 }), { b: 1 });
    assert.deepEqual(roundtrip([undefined]), [null]);
});

test("a string is stored once, and the most used ones come first", () => {
    const value = Array.from({ length: 500 }, (_, i) => ({ name: "minecraft:activator_rail", props: { powered: "true" }, rare: `r${i % 3}` }));
    const bytes = pack(value);
    const text = new TextDecoder().decode(bytes);
    assert.equal(text.split("minecraft:activator_rail").length - 1, 1);
    assert.equal(text.split("powered").length - 1, 1);
    assert.ok(bytes.length < JSON.stringify(value).length / 4, `${bytes.length} bytes against ${JSON.stringify(value).length} of JSON`);
    assert.deepEqual(unpack(bytes), value);
});

test("small whole numbers take one byte", () => {
    assert.equal(pack([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).length, 1 + 1 + 1 + 10, "empty table, array tag, length, ten numbers");
    assert.ok(pack(300).length > pack(3).length);
});

test("it is smaller than JSON, also once both are compressed", () => {
    const element = i => ({
        from: [0, 0, 0],
        to: [16, 16 - (i % 5), 16],
        faces: Object.fromEntries(["down", "up", "north", "south", "west", "east"].map(d => [d, { texture: `minecraft:block/texture_${i % 7}`, uv: [0, 0, 16, 16 - (i % 5)], cullface: d }])),
    });
    const value = { models: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`minecraft:block/model_${i}`, { elements: [element(i), element(i + 1)], particle: "minecraft:block/texture_1" }])) };
    const json = new TextEncoder().encode(JSON.stringify(value));
    const compact = pack(value);
    assert.ok(compact.length < json.length / 2, `${compact.length} against ${json.length}`);
    assert.ok(deflateSync(compact, { level: 9 }).length < deflateSync(json, { level: 9 }).length, "also after compression");
});

test("varints and zigzag cover the whole safe range", () => {
    for (const n of [0, 1, 127, 128, 16383, 16384, 2 ** 31, 2 ** 32, 2 ** 40, Number.MAX_SAFE_INTEGER]) {
        const writer = new Writer();
        writer.varint(n);
        assert.equal(new Reader(writer.finish()).varint(), n);
    }
    assert.throws(() => new Writer().varint(-1), /Cannot store/);
    assert.throws(() => new Writer().varint(0.5), /Cannot store/);
});

test("values that cannot be stored are refused", () => {
    assert.throws(() => pack(NaN), /not finite/);
    assert.throws(() => pack(Infinity), /not finite/);
    assert.throws(() => pack(() => 1), /type function/);
    assert.throws(() => pack(1n), /type bigint/);
    let deep = [];
    for (let i = 0; i < 100; i++) {
        deep = [deep];
    }
    assert.throws(() => pack(deep), /nested too deeply/);
});

test("damaged and hostile data is refused without using up memory", () => {
    const good = pack({ name: "x", list: [1, 2, 3], text: "hello" });
    for (let cut = 0; cut < good.length; cut++) {
        assert.throws(() => unpack(good.subarray(0, cut)), undefined, `cut at ${cut}`);
    }
    assert.throws(() => unpack(new Uint8Array([...good, 0])), /left over/);
    // An array that says it has billions of items
    assert.throws(() => unpack(Uint8Array.from([0, 6, 0xFF, 0xFF, 0xFF, 0xFF, 0x0F])), /ends too early/);
    // A string table that says it has billions of strings
    assert.throws(() => unpack(Uint8Array.from([0xFF, 0xFF, 0xFF, 0xFF, 0x0F, 0])), /ends too early/);
    // A string that is not there
    assert.throws(() => unpack(Uint8Array.from([0, 4, 5])), /not there/);
    // Nested too deeply
    assert.throws(() => unpack(Uint8Array.from([0, ...Array(200).fill([6, 1]).flat(), 0])), /nested too deeply|ends too early/);
    // Unknown tag
    assert.throws(() => unpack(Uint8Array.from([0, 9])), /known format/);
    // A varint that never ends
    assert.throws(() => unpack(Uint8Array.from([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])), /too long/);
    // Text that is not UTF-8
    assert.throws(() => unpack(Uint8Array.from([1, 2, 0xC3, 0x28, 4, 0])), /not valid/);
});

test("a key called __proto__ is refused instead of changing the prototype of the result", () => {
    const writer = new Writer();
    const key = new TextEncoder().encode("__proto__");
    writer.varint(1);
    writer.varint(key.length);
    writer.bytes(key);
    writer.byte(7); // object
    writer.varint(1);
    writer.varint(0);
    writer.byte(7);
    writer.varint(0);
    assert.throws(() => unpack(writer.finish()), /not allowed/);
    assert.equal({}.polluted, undefined);
});
