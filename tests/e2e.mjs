/**
 * Browser test: imports synthetic resource packs, compiles, places blocks, checks the rendering,
 * the IndexedDB cache, .rmpack export/import and save codes.
 *
 * Needs Playwright with a Chromium: `node tests/e2e.mjs`
 * (set PLAYWRIGHT_MODULES to a node_modules folder if `playwright` is not installed here)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { base_files, overlay_files, zip_of } from "./fixtures.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png" };

const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    try {
        const file = join(root, path.endsWith("/") ? `${path}index.html` : path);
        const body = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
        res.end(body);
    }
    catch {
        res.writeHead(404);
        res.end();
    }
});
await new Promise(resolve => server.listen(0, resolve));
const url = `http://localhost:${server.address().port}/`;

let chromium;
try {
    ({ chromium } = await import("playwright"));
}
catch {
    ({ chromium } = createRequire(process.env.PLAYWRIGHT_MODULES ?? "/node-tools/node_modules/")("playwright"));
}

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const problems = [];
page.on("pageerror", e => problems.push(e.message));
page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) {
        problems.push(m.text());
    }
});

async function step(name, fn) {
    await fn();
    console.log(`ok - ${name}`);
}

/** Counts rendered pixels that satisfy a colour test. */
function count_pixels(test_source) {
    return page.evaluate((source) => {
        const test = new Function("r", "g", "b", `return ${source}`);
        const src = document.getElementById("canvas3d");
        const copy = document.createElement("canvas");
        copy.width = src.width;
        copy.height = src.height;
        const ctx = copy.getContext("2d");
        ctx.drawImage(src, 0, 0);
        const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (test(data[i], data[i + 1], data[i + 2])) {
                n++;
            }
        }
        return n;
    }, test_source);
}

const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

await page.goto(url);
await page.waitForFunction(() => window.__rm);

await step("onboarding shows until a pack is loaded", async () => {
    assert.equal(await page.locator("#onboarding").isVisible(), true);
});

await step("stack two packs and compile", async () => {
    await page.click("#pack_button");
    await page.setInputFiles("#pack_file", [
        { name: "overlay.zip", mimeType: "application/zip", buffer: Buffer.from(zip_of(overlay_files())) },
        { name: "wrapped_base.zip", mimeType: "application/zip", buffer: Buffer.from(zip_of(Object.fromEntries(Object.entries(base_files()).map(([k, v]) => [`wrapped/${k}`, v])))) },
    ]);
    await page.waitForFunction(() => document.querySelectorAll("#source_list li:not(.note)").length === 2);
    await page.fill("#pack_name", "Test stack");
    await page.click("#compile_button");
    await page.waitForFunction(() => document.querySelector("#compile_status").textContent.startsWith("Done"), null, { timeout: 30000 });
    await page.click("#pack_close");
    assert.equal(await page.locator("#onboarding").isVisible(), false);
    assert.equal(await page.textContent("#pack_summary"), "Test stack");
});

await step("block list and states come from the stacked packs", async () => {
    const names = await page.$$eval(".block_item", items => items.map(i => i.dataset.name));
    for (const name of ["minecraft:stone", "minecraft:observer", "minecraft:oak_fence"]) {
        assert.ok(names.includes(name), name);
    }
    await page.fill("#block_search", "observ");
    assert.equal(await page.locator(".block_item:visible").count(), 1);
    await page.click(".block_item:visible");
    const props = await page.$$eval("#block_states select", s => s.map(x => x.dataset.property));
    assert.deepEqual(props.sort(), ["facing", "powered"]);
    await page.fill("#block_search", "");
});

await step("entity blocks get the bundled fallback model", async () => {
    const quads = await page.evaluate(() => window.__rm.resources.pack.geometry("minecraft:chest", { facing: "north", type: "single" }).quads.length);
    assert.ok(quads > 6, `chest quads: ${quads}`);
});

await step("clicking the floor places the selected block", async () => {
    await page.evaluate(() => window.__rm.picker.select("minecraft:stone"));
    const pos = await page.evaluate(() => window.__rm.scene.screen_position(10, -0.5, 10));
    await page.mouse.click(pos.x, pos.y);
    assert.equal(await page.evaluate(() => window.__rm.world.blocks.size), 1);
    await page.mouse.click(pos.x, pos.y, { button: "right" });
    assert.equal(await page.evaluate(() => window.__rm.world.blocks.size), 0);
});

await step("powered observer renders with the overlay texture, unpowered with the base one", async () => {
    await page.evaluate(() => {
        window.__rm.world.clear();
        window.__rm.world.set(10, 0, 10, { name: "minecraft:observer", props: { facing: "south", powered: "false" } });
    });
    await frame();
    const red_off = await count_pixels("r > 150 && g < 80 && b < 80");
    await page.evaluate(() => window.__rm.world.set(10, 0, 10, { name: "minecraft:observer", props: { facing: "south", powered: "true" } }));
    await frame();
    const red_on = await count_pixels("r > 150 && g < 80 && b < 80");
    assert.equal(red_off, 0);
    assert.ok(red_on > 200, `red pixels when powered: ${red_on}`);
});

await step("hidden faces are culled and translucent blocks draw", async () => {
    await page.evaluate(() => {
        const { world } = window.__rm;
        world.clear();
        world.set(10, 0, 10, { name: "minecraft:stone", props: {} });
        world.set(11, 0, 10, { name: "minecraft:stone", props: {} });
        world.set(10, 1, 10, { name: "minecraft:glass", props: {} });
        world.set(12, 0, 10, { name: "minecraft:grass_block", props: {} });
    });
    await frame();
    const quads = await page.evaluate(() => window.__rm.scene.world_mesh.meshes.reduce((n, m) => n + m.userData.cells.length, 0));
    // 2 stones: 10 faces (the shared face is culled), glass on top of stone: 5 (its bottom face is hidden), grass block: 2
    assert.equal(quads, 10 + 5 + 2);
    assert.ok(await count_pixels("g > r + 20 && g > b + 20") > 50, "grass tint is green");
});

const view_of = () => page.evaluate(() => window.__rm.scene.view);
const settled = () => page.waitForFunction(() => window.__rm.scene.animation === null);

async function click_gizmo(name) {
    const pos = await page.evaluate(n => window.__rm.scene.gizmo.axis_screen_position(n), name);
    await page.mouse.click(pos.x, pos.y);
    await settled();
}

/** Strongest vertex colour of the quads of one cell */
function brightness_of(cell) {
    return page.evaluate((c) => {
        let best = 0;
        for (const mesh of window.__rm.scene.world_mesh.meshes) {
            const colors = mesh.geometry.getAttribute("color");
            mesh.userData.cells.forEach((cell, quad) => {
                if (cell && cell.join() === c.join()) {
                    for (let i = 0; i < 12; i++) {
                        best = Math.max(best, colors.array[quad * 12 + i]);
                    }
                }
            });
        }
        return best;
    }, cell);
}

await step("axis gizmo: top view enters 2D with the plane in the middle of the cube", async () => {
    assert.equal(await page.locator("#plane_controls").isVisible(), false, "no plane controls in 3D");
    await page.evaluate(() => {
        const { world } = window.__rm;
        world.clear();
        world.set(10, 10, 10, { name: "minecraft:stone", props: {} }); // on the plane
        world.set(12, 12, 10, { name: "minecraft:stone", props: {} }); // between plane and camera
        world.set(14, 8, 10, { name: "minecraft:stone", props: {} }); // behind the plane
    });
    await click_gizmo("+y");
    assert.deepEqual(await view_of(), { axis: 1, side: 1 });
    assert.equal(await page.evaluate(() => window.__rm.scene.plane), 10);
    assert.equal(await page.locator("#plane_controls").isVisible(), true);
    assert.equal(await page.textContent("#layer_number"), "y = 10");
    const direction = await page.evaluate(() => {
        const { camera, controls } = window.__rm.scene;
        return camera.position.clone().sub(controls.target).normalize().toArray();
    });
    assert.ok(direction[1] > 0.999999, `camera looks straight down: ${direction}`);
});

await step("2D view hides blocks in front of the plane and dims blocks behind it", async () => {
    const cells = await page.evaluate(() => window.__rm.scene.world_mesh.meshes.flatMap(m => m.userData.cells).map(c => c.join()));
    assert.ok(cells.includes("10,10,10"));
    assert.ok(cells.includes("14,8,10"));
    assert.ok(!cells.includes("12,12,10"));
    const on_plane = await brightness_of([10, 10, 10]);
    const behind = await brightness_of([14, 8, 10]);
    assert.ok(behind < on_plane * 0.5, `dimmed: ${behind} vs ${on_plane}`);
});

await step("2D view: click places on the plane, right click removes, plane moves with + and -", async () => {
    await page.evaluate(() => window.__rm.picker.select("minecraft:stone"));
    const at = (x, z) => page.evaluate(([a, b]) => window.__rm.scene.screen_position(a, 10, b), [x, z]);
    let pos = await at(5, 5);
    await page.mouse.click(pos.x, pos.y);
    assert.ok(await page.evaluate(() => window.__rm.world.get(5, 10, 5) !== null), "placed on the plane");
    // Replacing: another block over it
    await page.evaluate(() => window.__rm.picker.select("minecraft:glass"));
    await page.mouse.click(pos.x, pos.y);
    assert.equal(await page.evaluate(() => window.__rm.world.get(5, 10, 5).name), "minecraft:glass");
    await page.mouse.click(pos.x, pos.y, { button: "right" });
    assert.equal(await page.evaluate(() => window.__rm.world.get(5, 10, 5)), null);

    await page.click("#layer_up");
    assert.equal(await page.textContent("#layer_number"), "y = 11");
    pos = await at(6, 6);
    await page.evaluate(() => window.__rm.picker.select("minecraft:stone"));
    await page.mouse.click(pos.x, pos.y);
    assert.ok(await page.evaluate(() => window.__rm.world.get(6, 11, 6) !== null), "placed one level higher");
    await page.click("#layer_down");
    await page.click("#layer_down");
    assert.equal(await page.textContent("#layer_number"), "y = 9");
    await page.keyboard.press("]");
    assert.equal(await page.textContent("#layer_number"), "y = 10");
});

await step("another axis resets the plane to the centre; rotating leaves 2D", async () => {
    await page.click("#layer_up");
    await click_gizmo("-x");
    assert.deepEqual(await view_of(), { axis: 0, side: -1 });
    assert.equal(await page.textContent("#layer_number"), "x = 10");
    const box = await page.locator("#canvas3d").boundingBox();
    await page.mouse.move(box.x + 200, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 290, box.y + 330, { steps: 5 });
    await page.mouse.up();
    await frame();
    assert.equal(await view_of(), null);
    assert.equal(await page.locator("#plane_controls").isVisible(), false);
    await click_gizmo("iso");
    assert.equal(await view_of(), null);
});

await step("state bar renders every combination and sets the held state", async () => {
    await page.evaluate(() => window.__rm.picker.select("minecraft:observer", { facing: "south", powered: "false" }));
    await page.click("#state_toggle");
    await page.waitForFunction(() => document.querySelectorAll(".state_tile").length === 12);
    await page.waitForFunction(() => [...document.querySelectorAll(".state_tile img")].every(i => i.src.startsWith("data:")));
    assert.equal(await page.locator(".state_tile.selected").count(), 1);
    await page.click(".state_tile[title='facing=east, powered=true']");
    assert.deepEqual(await page.evaluate(() => window.__rm.picker.selected.props), { facing: "east", powered: "true" });
    assert.equal(await page.inputValue("#block_states select[data-property=powered]"), "true");
    assert.equal(await page.locator(".state_tile.selected").getAttribute("title"), "facing=east, powered=true");
    await page.selectOption("#state_filters select[data-property=powered]", "false");
    await page.waitForFunction(() => document.querySelectorAll(".state_tile").length === 6);
    await page.selectOption("#state_filters select[data-property=powered]", "");
    await page.waitForFunction(() => document.querySelectorAll(".state_tile").length === 12);
    // The overlay pack makes powered observers look different, so nothing is hidden
    await page.check("#state_dedupe");
    await page.waitForFunction(() => document.querySelectorAll(".state_tile").length === 12);
    await page.uncheck("#state_dedupe");
});

await step("look-alike states can be hidden", async () => {
    await page.evaluate(() => window.__rm.picker.select("minecraft:lever"));
    // face (3) x facing (4) x powered (2); the fixture draws all of them the same
    await page.waitForFunction(() => document.querySelectorAll(".state_tile").length === 24);
    await page.check("#state_dedupe");
    await page.waitForFunction(() => document.querySelectorAll(".state_tile").length === 1);
    await page.uncheck("#state_dedupe");
    await page.click("#state_toggle");
    assert.equal(await page.locator("#state_bar").isVisible(), false);
    await page.evaluate(() => {
        window.__rm.world.clear();
        for (const [x, y, z] of [[10, 0, 10], [11, 0, 10], [12, 0, 10], [12, 1, 10]]) {
            window.__rm.world.set(x, y, z, { name: "minecraft:stone", props: {} });
        }
        window.__rm.world.set(13, 1, 10, { name: "minecraft:stone", props: {} });
    });
});

await step("save code round trip", async () => {
    await page.click("#save_button");
    await page.waitForFunction(() => document.querySelector("#save_button").textContent === "Code copied");
    const code = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(code, /^[A-Za-z0-9+/=]+$/);
    await page.evaluate(() => window.__rm.world.clear());
    await page.fill("#load_input", code);
    await page.click("#load_button");
    await page.waitForFunction(() => window.__rm.world.blocks.size === 5);
});

await step("compiled pack is cached in the browser and restored after reload", async () => {
    await page.reload();
    await page.waitForFunction(() => window.__rm?.resources, null, { timeout: 15000 });
    assert.equal(await page.textContent("#pack_summary"), "Test stack");
    assert.equal(await page.evaluate(() => window.__rm.world.blocks.size), 5, "model autosaved");
    assert.ok(await page.locator(".block_item").count() > 5);
});

await step("export .rmpack, delete it, import it again", async () => {
    await page.click("#pack_button");
    await page.waitForSelector("#library_list li button");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#library_list li button:text('Export')")]);
    const path = await download.path();
    const bytes = await readFile(path);
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    await page.click("#library_list li button:text('Delete')");
    await page.waitForSelector("#library_list li.note");
    await page.setInputFiles("#pack_file", [{ name: "Test stack.rmpack", mimeType: "application/zip", buffer: bytes }]);
    await page.waitForSelector("#library_list li .pack_label");
    assert.equal(await page.locator("#library_list li").count(), 1);
    assert.equal(await page.textContent("#pack_summary"), "Test stack");
});

await browser.close();
server.close();
assert.deepEqual(problems, [], `browser errors:\n${problems.join("\n")}`);
console.log("all browser checks passed");
