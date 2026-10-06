import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "../lib/fflate.module.js";
import { test } from "node:test";
import { Pack } from "../js/pack/Pack.mjs";
import { PackStack } from "../js/pack/PackStack.mjs";
import { collect } from "../js/pack/Compiler.mjs";
import { is_rmpack, write_rmpack } from "../js/pack/Rmpack.mjs";
import { VanillaError, fetch_vanilla, list_versions } from "../js/pack/Vanilla.mjs";
import { base_files, zip_of } from "./fixtures.mjs";

const json = value => strToU8(JSON.stringify(value));
const sha1 = bytes => createHash("sha1").update(bytes).digest("hex");

/** A zip like a mod: classes, a manifest, data and assets, and optionally a mod inside it */
function jar_of(files, { inner } = {}) {
    const entries = {
        "META-INF/MANIFEST.MF": strToU8("Manifest-Version: 1.0"),
        "com/example/Mod.class": Uint8Array.from([0xCA, 0xFE, 0xBA, 0xBE]),
        "data/example/recipes/x.json": json({ type: "crafting" }),
        "example.mixins.json": json({}),
    };
    for (const [path, value] of Object.entries(files)) {
        entries[path] = value instanceof Uint8Array ? value : json(value);
    }
    if (inner) {
        entries["META-INF/jars/inner-1.0.jar"] = inner;
    }
    return zipSync(entries);
}

test("a jar gives its assets, and nothing else", () => {
    const jar = jar_of(base_files());
    const pack = Pack.from_zip("mod", jar, { jar: true });
    const paths = [...pack.paths()];
    assert.ok(paths.length > 0);
    assert.ok(paths.every(path => path.startsWith("assets/")), paths.join());
    assert.ok(!paths.some(path => path.includes("recipes") || path.endsWith(".mixins.json")));
    assert.ok(pack.has("assets/minecraft/blockstates/stone.json"));
});

test("the assets of the mods inside a jar are read too, one level deep", () => {
    const inner = jar_of({ "assets/inner/blockstates/gem.json": { variants: { "": { model: "inner:block/gem" } } } }, { inner: zipSync({ "assets/deeper/x.json": json({}) }) });
    const outer = jar_of({ "assets/outer/blockstates/box.json": { variants: { "": { model: "outer:block/box" } } } }, { inner });
    const pack = Pack.from_zip("fat", outer, { jar: true });
    assert.ok(pack.has("assets/outer/blockstates/box.json"));
    assert.ok(pack.has("assets/inner/blockstates/gem.json"));
    assert.ok(![...pack.paths()].some(path => path.includes("deeper")));
    // A broken mod inside does not spoil the rest
    const damaged = Pack.from_zip("fat", jar_of({ "assets/outer/blockstates/box.json": {} }, { inner: Uint8Array.from([1, 2, 3, 4]) }), { jar: true });
    assert.ok(damaged.has("assets/outer/blockstates/box.json"));
});

test("a jar with a mod's assets compiles into blocks, as the game's own jar does", () => {
    const pack = Pack.from_zip("Minecraft", jar_of(base_files()), { jar: true });
    const data = collect(new PackStack([pack]), {});
    assert.ok(Object.keys(data.index).includes("minecraft:stone"));
});

test("a compiled pack is known by what is in it, not by what it is called", () => {
    const compiled = write_rmpack({ name: "x", atlas: {}, index: {} }, Uint8Array.from([1, 2, 3]));
    assert.equal(is_rmpack(compiled), true);
    assert.equal(is_rmpack(zip_of(base_files())), false, "a resource pack");
    assert.equal(is_rmpack(jar_of(base_files())), false);
    assert.equal(is_rmpack(Uint8Array.from([1, 2, 3, 4, 5])), false);
    assert.equal(is_rmpack(new Uint8Array(0)), false);
    assert.equal(is_rmpack(Uint8Array.from([0x50, 0x4B, 3, 4, 9, 9, 9])), false, "damaged zip");
});

/** Stands in for Mojang */
function mojang({ lang = true, tamper = false } = {}) {
    const jar = jar_of(base_files());
    const zh = json({ "block.minecraft.stone": "石头" });
    const calls = [];
    const index = { objects: { "minecraft/lang/zh_cn.json": { hash: sha1(zh), size: zh.length } } };
    const info = {
        downloads: { client: { url: "https://piston-data.mojang.com/v1/objects/abc/client.jar", sha1: sha1(jar), size: jar.length } },
        assetIndex: { url: "https://piston-meta.mojang.com/v1/packages/idx/26.json" },
    };
    const manifest = {
        latest: { release: "1.21.9", snapshot: "26w01a" },
        versions: [
            { id: "26w01a", type: "snapshot", url: "https://piston-meta.mojang.com/v1/packages/s.json" },
            { id: "1.21.9", type: "release", url: "https://piston-meta.mojang.com/v1/packages/r.json" },
            { id: "1.20.1", type: "release", url: "https://piston-meta.mojang.com/v1/packages/o.json" },
        ],
    };
    const fetch_fn = async (url) => {
        calls.push(url);
        const reply = body => new Response(body instanceof Uint8Array ? body : JSON.stringify(body));
        if (url.endsWith("version_manifest_v2.json")) {
            return reply(manifest);
        }
        if (url.endsWith("/r.json") || url.endsWith("/o.json")) {
            return reply(info);
        }
        if (url.endsWith("client.jar")) {
            return reply(tamper ? jar.slice(0, jar.length - 1) : jar);
        }
        if (url.endsWith("26.json")) {
            return reply(index);
        }
        if (url.startsWith("https://resources.download.minecraft.net/") && lang) {
            return url.endsWith(`${sha1(zh).slice(0, 2)}/${sha1(zh)}`) ? reply(zh) : new Response("no", { status: 404 });
        }
        return new Response("no", { status: 404 });
    };
    return { fetch_fn, calls, jar };
}

test("the list of versions has releases only", async () => {
    const { latest, versions } = await list_versions(mojang().fetch_fn);
    assert.equal(latest, "1.21.9");
    assert.deepEqual(versions.map(v => v.id), ["1.21.9", "1.20.1"]);
});

test("the game is downloaded, checked and read, with the block names of the chosen language", async () => {
    const service = mojang();
    const steps = [];
    const result = await fetch_vanilla({ version: "latest", languages: ["zh_cn", "en_us", "../bad"], fetch_fn: service.fetch_fn, progress: (stage, done, total, id) => steps.push([stage, id]) });
    assert.equal(result.version, "1.21.9");
    assert.equal(result.name, "Minecraft 1.21.9");
    assert.deepEqual(result.languages, ["zh_cn"]);
    assert.ok(result.pack.has("assets/minecraft/lang/zh_cn.json"));
    assert.ok(result.pack.has("assets/minecraft/blockstates/stone.json"));
    assert.ok(steps.some(([stage]) => stage === "jar") && steps.some(([stage]) => stage === "read"));
    assert.ok(!service.calls.some(url => url.includes("bad")));
    const chosen = await fetch_vanilla({ version: "1.20.1", fetch_fn: service.fetch_fn });
    assert.equal(chosen.version, "1.20.1");
});

test("when the names cannot be had the game is still added", async () => {
    const result = await fetch_vanilla({ version: "latest", languages: ["zh_cn"], fetch_fn: mojang({ lang: false }).fetch_fn });
    assert.deepEqual(result.languages, []);
    assert.ok(result.pack.has("assets/minecraft/blockstates/stone.json"));
});

test("a download that is not what Mojang announced is refused, and so are failures", async () => {
    await assert.rejects(fetch_vanilla({ version: "latest", fetch_fn: mojang({ tamper: true }).fetch_fn }), { kind: "changed" });
    await assert.rejects(fetch_vanilla({ version: "9.9", fetch_fn: mojang().fetch_fn }), { kind: "version" });
    await assert.rejects(fetch_vanilla({ version: "latest", fetch_fn: async () => {
        throw new TypeError("Failed to fetch");
    } }), (error) => {
        assert.ok(error instanceof VanillaError);
        assert.equal(error.kind, "network");
        return true;
    });
    await assert.rejects(fetch_vanilla({ version: "latest", fetch_fn: async () => new Response("x", { status: 503 }) }), { kind: "http", status: 503 });
    await assert.rejects(fetch_vanilla({ version: "latest", fetch_fn: async () => new Response("<html>") }), { kind: "format" });
});

test("addresses that are not Mojang's are not followed", async () => {
    const manifest = { latest: { release: "1.0" }, versions: [{ id: "1.0", type: "release", url: "https://evil.example/r.json" }] };
    await assert.rejects(fetch_vanilla({ version: "latest", fetch_fn: async () => new Response(JSON.stringify(manifest)) }), { kind: "format", message: /not theirs/ });
});
