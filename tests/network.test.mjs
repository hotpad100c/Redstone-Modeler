import assert from "node:assert/strict";
import { test } from "node:test";
import { NetworkError, download, parse_link, share_link, upload } from "../js/share/Network.mjs";
import { encode_code, is_compact } from "../js/share/Share.mjs";

const MAGIC = Uint8Array.from([0x52, 0x4D, 0x53, 0x32]);
const compact = Uint8Array.from([...new TextEncoder().encode("RMS2"), ...Array.from({ length: 3000 }, (_, i) => (i * 31) % 256)]);

/** A fake service: keeps what it is given, with a hook to damage it */
function service({ text, mangle = x => x, reply, status = 200, fail } = {}) {
    const store = new Map();
    const calls = [];
    const fetch_fn = async (url, init = {}) => {
        calls.push({ url, init });
        if (fail) {
            throw new TypeError("Failed to fetch");
        }
        if (init.method === "POST") {
            const body = text ? init.body.get("content") : init.body;
            store.set("abc123", mangle(typeof body === "string" ? new TextEncoder().encode(body) : body));
            return new Response(JSON.stringify(reply ?? (text ? { success: true, id: "abc123" } : { key: "abc123" })), { status });
        }
        const id = url.split("/").pop();
        return store.has(id) ? new Response(store.get(id)) : new Response("nope", { status: 404 });
    };
    return { fetch_fn, store, calls };
}

test("is_compact sees the magic bytes", () => {
    assert.ok(is_compact(compact));
    assert.ok(!is_compact(MAGIC.subarray(0, 2)));
});

test("a text service gets the share code and gives the same bytes back", async () => {
    const fake = service({ text: true });
    assert.deepEqual(await upload("mclogs", compact, fake.fetch_fn), { service: "mclogs", id: "abc123" });
    assert.equal(fake.calls[0].url, "https://api.mclo.gs/1/log");
    assert.equal(new TextDecoder().decode(fake.store.get("abc123")), encode_code(compact));
    assert.deepEqual(await download("mclogs", "abc123", fake.fetch_fn), compact);
    assert.equal(fake.calls[0].init.credentials, "omit");
});

test("a binary service gets the bytes", async () => {
    const fake = service({ text: false });
    assert.deepEqual(await upload("pastes", compact, fake.fetch_fn), { service: "pastes", id: "abc123" });
    assert.deepEqual(fake.store.get("abc123"), compact);
    assert.deepEqual(await download("pastes", "abc123", fake.fetch_fn), compact);
});

test("a service that changes the content is caught", async () => {
    for (const [key, text] of [["mclogs", true], ["pastes", false]]) {
        const fake = service({ text, mangle: bytes => bytes.slice(0, bytes.length - 5) });
        await assert.rejects(upload(key, compact, fake.fetch_fn), { kind: "changed" }, key);
    }
    const filtered = service({ text: true, mangle: bytes => new TextEncoder().encode(new TextDecoder().decode(bytes).replace(/[A-Z]/g, "*")) });
    await assert.rejects(upload("mclogs", compact, filtered.fetch_fn), { kind: "changed" });
});

test("errors say what happened", async () => {
    await assert.rejects(upload("mclogs", compact, service({ fail: true }).fetch_fn), { kind: "network" });
    await assert.rejects(upload("mclogs", compact, service({ text: true, status: 500 }).fetch_fn), { kind: "http", status: 500 });
    await assert.rejects(upload("mclogs", compact, service({ text: true, reply: { success: false, error: "Content too long" } }).fetch_fn), { kind: "refused", message: /Content too long/ });
    await assert.rejects(upload("mclogs", compact, service({ text: true, reply: { id: "../x" } }).fetch_fn), { kind: "refused" });
    await assert.rejects(upload("pastes", compact, async () => new Response("<html>")), { kind: "format" });
    await assert.rejects(upload("nowhere", compact, async () => new Response("{}")), { kind: "service" });
    await assert.rejects(download("mclogs", "missing", service({ text: true }).fetch_fn), { kind: "http", status: 404 });
    await assert.rejects(download("mclogs", "../etc", async () => new Response("")), { kind: "id" });
    await assert.rejects(download("mclogs", "abc", async () => new Response("just some log text")), { kind: "format" });
    await assert.rejects(download("pastes", "abc", async () => new Response(new Uint8Array(9 * 1024 * 1024))), NetworkError);
});

test("links are made and understood", () => {
    const link = share_link("https://me.github.io/Redstone-Modeler/?v=1#old", { service: "mclogs", id: "x1_-" });
    assert.equal(link, "https://me.github.io/Redstone-Modeler/?v=1#share=mclogs.x1_-");
    assert.deepEqual(parse_link(link), { service: "mclogs", id: "x1_-" });
    assert.deepEqual(parse_link("#share=pastes.AbC"), { service: "pastes", id: "AbC" });
    assert.deepEqual(parse_link("  https://mclo.gs/aB12  "), { service: "mclogs", id: "aB12" });
    assert.deepEqual(parse_link("https://api.mclo.gs/1/raw/aB12"), { service: "mclogs", id: "aB12" });
    assert.deepEqual(parse_link("https://pastes.dev/Zz9"), { service: "pastes", id: "Zz9" });
    for (const bad of ["", "hello", "#share=evil.abc", "#share=mclogs.", "#share=mclogs.a/b", "https://evil.example/aB12", "https://mclo.gs/a/b", "RMS1.abcd"]) {
        assert.equal(parse_link(bad), null, bad);
    }
});
