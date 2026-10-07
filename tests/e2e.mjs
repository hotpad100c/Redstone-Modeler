/**
 * Browser test: imports synthetic resource packs, compiles, places blocks, checks the rendering,
 * the IndexedDB cache, .rmpack export/import and save codes.
 *
 * Needs Playwright with a Chromium: `node tests/e2e.mjs`
 * (set PLAYWRIGHT_MODULES to a node_modules folder if `playwright` is not installed here)
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "../lib/fflate.module.js";
import { BlueprintBuilder } from "../js/schematic/Blueprint.mjs";
import { write_nbt, short } from "../js/schematic/Nbt.mjs";
import { write_blueprint } from "../js/schematic/index.mjs";
import { base_files, overlay_files, png, zip_of } from "./fixtures.mjs";

// SITE_ROOT points at an assembled site (scripts/build-site.sh) to test what gets deployed
const root = process.env.SITE_ROOT ?? fileURLToPath(new URL("..", import.meta.url));
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

let playwright;
try {
    playwright = await import("playwright");
}
catch {
    playwright = createRequire(process.env.PLAYWRIGHT_MODULES ?? "/node-tools/node_modules/")("playwright");
}

// BROWSER=webkit runs the same test in WebKit, the engine of Safari
const engine = process.env.BROWSER ?? "chromium";
const browser = await playwright[engine].launch(engine === "chromium"
    ? { executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] }
    : {});
const context = await browser.newContext({ locale: "en-US", viewport: { width: 1100, height: 760 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const problems = [];
page.on("pageerror", e => problems.push(e.message));
page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) {
        problems.push(`${m.text()} ${m.location().url}`);
    }
});

let rmpack_bytes = null;

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

await step("block names: shown and searched in the chosen language and in English", async () => {
    const visible_names = () => page.$$eval(".block_item:not([hidden])", items => items.map(i => i.dataset.name));
    // Chinese is the default language for names
    assert.equal(await page.locator(".block_item[data-name=\"minecraft:stone\"] .block_name").textContent(), "石头");
    assert.equal(await page.locator(".block_item[data-name=\"minecraft:stone\"] .block_id").textContent(), "minecraft:stone");
    assert.equal(await page.locator(".block_item[data-name=\"minecraft:observer\"] .block_name").textContent(), "侦测器（红石版）", "the pack on top renames it");
    assert.equal(await page.locator(".block_item[data-name=\"minecraft:chest\"] .block_name").textContent(), "Chest", "no Chinese name, so English");
    assert.equal(await page.locator(".block_item[data-name=\"minecraft:oak_stairs\"]").count(), 0);
    for (const [query, expected] of [["石头", ["minecraft:stone"]], ["stone", ["minecraft:redstone_lamp", "minecraft:stone"]], ["Stone", ["minecraft:redstone_lamp", "minecraft:stone"]], ["stone block", []], ["侦测", ["minecraft:observer"]], ["红石灯", ["minecraft:redstone_lamp"]], ["oak slab", ["minecraft:oak_slab"]], ["橡木", ["minecraft:oak_slab"]]]) {
        await page.fill("#block_search", query);
        assert.deepEqual(await visible_names(), expected, query);
    }
    await page.fill("#block_search", "");
    // Switch to English only: the Chinese names no longer find anything
    await page.click("#settings_button");
    assert.deepEqual(await page.$$eval("#search_language option", o => o.map(x => x.value)), ["", "de_de", "zh_cn"], "English is not listed twice");
    assert.equal(await page.locator("#search_language option[value=zh_cn]").textContent(), "简体中文 (中国)");
    assert.equal(await page.inputValue("#search_language"), "zh_cn");
    await page.selectOption("#search_language", "");
    await page.click("#settings_close");
    assert.equal(await page.locator(".block_item[data-name=\"minecraft:stone\"] .block_name").textContent(), "Stone");
    await page.fill("#block_search", "石头");
    assert.deepEqual(await visible_names(), []);
    await page.fill("#block_search", "stone");
    assert.deepEqual(await visible_names(), ["minecraft:redstone_lamp", "minecraft:stone"]);
    // Another language from the pack
    await page.click("#settings_button");
    await page.selectOption("#search_language", "de_de");
    await page.click("#settings_close");
    await page.fill("#block_search", "stein");
    assert.deepEqual(await visible_names(), ["minecraft:stone"]);
    assert.equal(await page.locator(".block_item[data-name=\"minecraft:stone\"] .block_name").textContent(), "Stein");
    // The choice is remembered
    await page.reload();
    await page.waitForFunction(() => window.__rm?.resources, null, { timeout: 15000 });
    assert.equal(await page.locator(".block_item[data-name=\"minecraft:stone\"] .block_name").textContent(), "Stein");
    await page.click("#settings_button");
    await page.selectOption("#search_language", "zh_cn");
    await page.click("#settings_close");
    await page.fill("#block_search", "");
});

await step("the name of the picked block is shown above the hotbar and fades out", async () => {
    const shown = () => page.evaluate(() => document.getElementById("held_name").classList.contains("show"));
    const opacity = () => page.evaluate(() => Number(getComputedStyle(document.getElementById("held_name")).opacity));
    await page.click(".block_item[data-name=\"minecraft:stone\"]");
    assert.equal(await shown(), true);
    assert.equal(await page.textContent("#held_name"), "石头");
    assert.equal(await opacity(), 1);
    await page.waitForFunction(() => !document.getElementById("held_name").classList.contains("show"), null, { timeout: 4000 });
    await page.waitForFunction(() => Number(getComputedStyle(document.getElementById("held_name")).opacity) === 0, null, { timeout: 4000 });
    // Changing only the state does not bring it back
    await page.evaluate(() => window.__rm.picker.select("minecraft:observer"));
    await page.waitForFunction(() => !document.getElementById("held_name").classList.contains("show"), null, { timeout: 4000 });
    await page.selectOption("#block_states select[data-property=powered]", "true");
    assert.equal(await shown(), false);
    // Switching to a slot with a block does, an empty slot does not
    await page.evaluate(() => window.__rm.picker.set_slot(1));
    assert.equal(await shown(), false);
    await page.evaluate(() => window.__rm.picker.select("minecraft:glass"));
    await page.evaluate(() => window.__rm.picker.set_slot(0));
    assert.equal(await shown(), true);
    assert.equal(await page.textContent("#held_name"), "侦测器（红石版）");
    // Picking with Alt+click does too (it goes through the same path)
    await page.evaluate(() => window.__rm.picker.set_slot(0));
});

await step("the interface can be switched to Chinese and back", async () => {
    assert.equal(await page.textContent("#save_button"), "Save");
    assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
    await page.click("#settings_button");
    assert.deepEqual(await page.$$eval("#ui_language option", o => o.map(x => x.value)), ["auto", "en", "zh-CN"]);
    await page.selectOption("#ui_language", "zh-CN");
    assert.equal(await page.textContent("#save_button"), "保存");
    assert.equal(await page.textContent("#pack_button"), "资源包");
    assert.equal(await page.getAttribute("#block_search", "placeholder"), "搜索方块");
    assert.equal(await page.getAttribute("#erase_button", "title"), "橡皮擦：左键删除方块（E）");
    assert.equal(await page.textContent("#settings_dialog h2"), "设置");
    assert.equal(await page.textContent("#state_toggle"), "状态 ▲");
    assert.equal(await page.evaluate(() => document.documentElement.lang), "zh-CN");
    assert.equal(await page.textContent("#pack_summary"), "Test stack", "the name of the pack is not translated");
    assert.equal(await page.locator("#ui_language option[value=auto]").textContent(), "自动");
    assert.equal(await page.locator("#search_language option[value='']").textContent(), "仅英文");
    // Parts drawn by code change too
    await page.click("#settings_close");
    await page.evaluate(() => window.__rm.picker.select("minecraft:observer", { facing: "east", powered: "true" }));
    assert.equal(await page.locator("#block_states .state_row span").first().textContent(), "朝向");
    assert.equal(await page.inputValue("#block_states select[data-property=powered]"), "true");
    assert.equal(await page.locator("#block_states select[data-property=powered] option[value=true]").textContent(), "是");
    await page.click("#state_toggle");
    await page.waitForFunction(() => document.querySelectorAll(".state_tile").length === 12);
    assert.equal(await page.textContent("#state_toggle"), "状态 ▼");
    assert.equal(await page.locator(".state_tile.selected").getAttribute("title"), "朝向=东, 通电=是 (facing=east, powered=true)");
    assert.match(await page.textContent("#state_note"), /^12 种组合中的 12 种/);
    await page.click("#state_toggle");
    // Remembered after a reload
    await page.reload();
    await page.waitForFunction(() => window.__rm?.resources, null, { timeout: 15000 });
    assert.equal(await page.textContent("#save_button"), "保存");
    assert.match(await page.textContent("#build_id"), /^(构建 |$)/);
    // The confirmation of Clear is translated as well
    await page.click("#clear_button");
    assert.equal(await page.textContent("#clear_button"), "确定吗？再点一次");
    await page.waitForFunction(() => document.getElementById("clear_button").textContent === "清空", null, { timeout: 5000 });
    // Back to the language of the browser
    await page.click("#settings_button");
    await page.selectOption("#ui_language", "auto");
    assert.equal(await page.textContent("#save_button"), "Save");
    assert.equal(await page.textContent("#settings_dialog h2"), "Settings");
    await page.click("#settings_close");
});

await step("the interface starts in Chinese in a Chinese browser", async () => {
    const chinese = await browser.newContext({ locale: "zh-CN" });
    const other = await chinese.newPage();
    await other.goto(url);
    await other.waitForFunction(() => window.__rm);
    assert.equal(await other.textContent("#pack_button"), "资源包");
    assert.equal(await other.textContent("#onboarding h2"), "导入资源包以开始");
    assert.equal(await other.textContent("#pack_summary"), "未加载");
    assert.equal(await other.evaluate(() => document.documentElement.lang), "zh-CN");
    await other.click("#pack_button");
    assert.equal(await other.textContent("#pack_dialog h2"), "资源包");
    assert.equal(await other.textContent("#source_list li"), "还没有添加资源包。可以把 .zip 文件拖到这里。");
    await chinese.close();
});

await step("entity blocks get the bundled fallback model", async () => {
    const quads = await page.evaluate(() => window.__rm.resources.pack.geometry("minecraft:chest", { facing: "north", type: "single" }).quads.length);
    assert.ok(quads > 6, `chest quads: ${quads}`);
});

await step("clicking the floor places the selected block", async () => {
    await page.evaluate(() => window.__rm.picker.select("minecraft:stone"));
    const pos = await page.evaluate(() => window.__rm.scene.screen_position(10, -0.5, 10));
    await page.mouse.click(pos.x, pos.y);
    assert.equal(await page.evaluate(() => window.__rm.world.count), 1);
    await page.mouse.click(pos.x, pos.y, { button: "right" });
    assert.equal(await page.evaluate(() => window.__rm.world.count), 0);
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

await step("eraser tool and clear all", async () => {
    const world_size = () => page.evaluate(() => window.__rm.world.count);
    assert.equal(await world_size(), 5);
    await frame(); // the viewport may just have been resized by the state bar closing
    const pos = await page.evaluate(() => window.__rm.scene.screen_position(10, 0, 10));
    await page.click("#erase_button");
    assert.equal(await page.evaluate(() => window.__rm.scene.erase), true);
    await page.mouse.click(pos.x, pos.y);
    assert.equal(await world_size(), 4, "left click erases while the eraser is on");
    await page.keyboard.press("e");
    assert.equal(await page.evaluate(() => window.__rm.scene.erase), false);
    // Clear needs a second click
    await page.click("#clear_button");
    assert.equal(await world_size(), 4);
    assert.equal(await page.textContent("#clear_button"), "Sure? Click again");
    await page.click("#clear_button");
    assert.equal(await world_size(), 0);
    assert.equal(await page.textContent("#clear_button"), "Clear");
    // Put the blocks back for the next steps
    await page.evaluate(() => {
        for (const [x, y, z] of [[10, 0, 10], [11, 0, 10], [12, 0, 10], [12, 1, 10], [13, 1, 10]]) {
            window.__rm.world.set(x, y, z, { name: "minecraft:stone", props: {} });
        }
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
    await page.waitForFunction(() => window.__rm.world.count === 5);
});

await step("compiled pack is cached in the browser and restored after reload", async () => {
    await page.reload();
    await page.waitForFunction(() => window.__rm?.resources, null, { timeout: 15000 });
    assert.equal(await page.textContent("#pack_summary"), "Test stack");
    assert.equal(await page.evaluate(() => window.__rm.world.count), 5, "model autosaved");
    assert.ok(await page.locator(".block_item").count() > 5);
});

await step("export .rmpack, delete it, import it again", async () => {
    await page.click("#pack_button");
    await page.waitForSelector("#library_list li button");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#library_list li button:text('Export')")]);
    const path = await download.path();
    const bytes = await readFile(path);
    rmpack_bytes = bytes;
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    await page.click("#library_list li button:text('Delete')");
    await page.waitForSelector("#library_list li.note");
    await page.setInputFiles("#pack_file", [{ name: "Test stack.rmpack", mimeType: "application/zip", buffer: bytes }]);
    await page.waitForSelector("#library_list li .pack_label");
    assert.equal(await page.locator("#library_list li").count(), 1);
    assert.equal(await page.textContent("#pack_summary"), "Test stack");
    await page.click("#pack_close");
});

await step("settings: a new size moves the bounds, the centre and the default planes", async () => {
    await page.click("#settings_button");
    await page.fill("#size_x", "8");
    await page.fill("#size_y", "6");
    await page.fill("#size_z", "10");
    await page.click("#size_apply");
    assert.match(await page.textContent("#size_note"), /5 blocks .* will be removed/);
    assert.deepEqual(await page.evaluate(() => window.__rm.world.size), { x: 20, y: 20, z: 20 }, "first click only warns");
    await page.click("#size_apply");
    assert.deepEqual(await page.evaluate(() => window.__rm.world.size), { x: 8, y: 6, z: 10 });
    assert.equal(await page.evaluate(() => window.__rm.world.count), 0);
    const geometry = await page.evaluate(() => {
        const { scene } = window.__rm;
        scene.bounds.geometry.computeBoundingBox();
        return {
            max: scene.bounds.geometry.boundingBox.max.toArray(),
            centre: scene.center.toArray(),
            target: scene.controls.target.toArray(),
            floor: scene.floor_plane.geometry.boundingBox ?? null,
        };
    });
    assert.deepEqual(geometry.max, [8, 6, 10]);
    assert.deepEqual(geometry.centre, [4, 3, 5]);
    assert.deepEqual(geometry.target, [4, 3, 5]);
    await page.click("#settings_close");
    await click_gizmo("+y");
    assert.equal(await page.evaluate(() => window.__rm.scene.plane), 3);
    await click_gizmo("+z");
    assert.equal(await page.evaluate(() => window.__rm.scene.plane), 5);
    await click_gizmo("iso");
});

await step("settings: background and plane colours", async () => {
    await page.click("#settings_button");
    await page.fill("#bg_color", "#ff0000");
    await page.fill("#plane_color", "#00ff00");
    await page.$eval("#plane_opacity", (input) => {
        input.value = "0.5";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.textContent("#plane_opacity_value"), "50%");
    await page.click("#settings_close");
    await frame();
    assert.equal(await page.evaluate(() => window.__rm.scene.scene.background.getHexString()), "ff0000");
    assert.ok(await count_pixels("r > 200 && g < 40 && b < 40") > 100000, "background is red");
    await click_gizmo("+y");
    const marker = await page.evaluate(() => {
        const material = window.__rm.scene.plane_group.children[0].material;
        return { color: material.color.getHexString(), opacity: material.opacity };
    });
    assert.deepEqual(marker, { color: "00ff00", opacity: 0.5 });
    // Changing the colour while a 2D view is open updates it right away
    await page.evaluate(() => window.__rm.scene.set_plane_style("#0000ff", 0.25));
    assert.deepEqual(await page.evaluate(() => {
        const material = window.__rm.scene.plane_group.children[0].material;
        return { color: material.color.getHexString(), opacity: material.opacity };
    }), { color: "0000ff", opacity: 0.25 });
    await page.evaluate(() => window.__rm.scene.set_plane_style("#00ff00", 0.5));
    await click_gizmo("iso");
});

await step("settings are remembered, and Reset brings the defaults back", async () => {
    await page.reload();
    await page.waitForFunction(() => window.__rm?.resources, null, { timeout: 15000 });
    assert.deepEqual(await page.evaluate(() => window.__rm.world.size), { x: 8, y: 6, z: 10 });
    assert.equal(await page.evaluate(() => window.__rm.scene.scene.background.getHexString()), "ff0000");
    await page.click("#settings_button");
    assert.equal(await page.inputValue("#size_y"), "6");
    assert.equal(await page.inputValue("#plane_color"), "#00ff00");
    await page.click("#settings_reset");
    assert.deepEqual(await page.evaluate(() => window.__rm.world.size), { x: 20, y: 20, z: 20 });
    assert.equal(await page.evaluate(() => window.__rm.scene.scene.background.getHexString()), "404040");
    assert.equal(await page.inputValue("#size_x"), "20");
    await page.click("#settings_close");
});

await step("loading a save from a bigger space resizes the space", async () => {
    await page.click("#settings_button");
    await page.fill("#size_x", "12");
    await page.fill("#size_y", "12");
    await page.fill("#size_z", "12");
    await page.click("#size_apply");
    await page.click("#settings_close");
    await page.evaluate(() => window.__rm.world.set(11, 11, 11, { name: "minecraft:stone", props: {} }));
    await page.click("#save_button");
    await page.waitForFunction(() => document.querySelector("#save_button").textContent === "Code copied");
    const code = await page.evaluate(() => navigator.clipboard.readText());
    await page.click("#settings_button");
    await page.fill("#size_x", "5");
    await page.fill("#size_y", "5");
    await page.fill("#size_z", "5");
    await page.click("#size_apply");
    await page.click("#size_apply");
    await page.click("#settings_close");
    assert.equal(await page.evaluate(() => window.__rm.world.count), 0);
    await page.fill("#load_input", code);
    await page.click("#load_button");
    await page.waitForFunction(() => window.__rm.world.count === 1);
    assert.deepEqual(await page.evaluate(() => window.__rm.world.size), { x: 12, y: 12, z: 12 });
    await page.click("#settings_button");
    assert.equal(await page.inputValue("#size_z"), "12");
    await page.click("#settings_reset");
    await page.click("#settings_close");
});

await step("mod assets: a picked assets folder and a deep zip are both found", async () => {
    const mod_files = {
        "assets/mymod/blockstates/gizmo.json": { variants: { "": { model: "mymod:block/gizmo" } } },
        "assets/mymod/models/block/gizmo.json": {
            textures: { all: "mymod:block/gizmo" },
            elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(["down", "up", "north", "south", "west", "east"].map(d => [d, { texture: "#all" }])) }],
        },
        "assets/mymod/textures/block/gizmo.png": png(16, 16, [10, 200, 120]),
        "assets/mymod/lang/en_us.json": { "language.name": "English", "block.mymod.gizmo": "Gizmo" },
        "assets/mymod/lang/zh_cn.json": { "language.name": "简体中文", "block.mymod.gizmo": "小装置" },
        "assets/othermod/lang/en_us.json": { "block.othermod.gizmo": "Other Gizmo" },
        "assets/othermod/lang/zh_cn.json": { "block.othermod.gizmo": "另一个装置" },
        // A second namespace next to the first, like assets/create next to assets/minecraft
        "assets/othermod/blockstates/gizmo.json": { variants: { "": { model: "othermod:block/gizmo" } } },
        "assets/othermod/models/block/gizmo.json": {
            textures: { all: "othermod:block/gizmo" },
            elements: [{ from: [0, 0, 0], to: [16, 8, 16], faces: Object.fromEntries(["down", "up", "north", "south", "west", "east"].map(d => [d, { texture: "#all" }])) }],
        },
        "assets/othermod/textures/block/gizmo.png": png(16, 16, [200, 60, 60]),
    };
    // 1. Pick the `assets` folder itself, like a folder copied from a mod repository
    const folder = await mkdtemp(join(tmpdir(), "rsm-mod-"));
    for (const [path, value] of Object.entries(mod_files)) {
        await mkdir(join(folder, path, ".."), { recursive: true });
        await writeFile(join(folder, path), value instanceof Uint8Array ? value : JSON.stringify(value));
    }
    await page.click("#pack_button");
    await page.evaluate(() => {
        window.__rm.pack_panel.sources.length = 0;
        window.__rm.pack_panel._render_sources();
    });
    await page.setInputFiles("#pack_folder", join(folder, "assets"));
    await page.waitForFunction(() => document.querySelectorAll("#source_list li:not(.note)").length === 1);
    await page.fill("#pack_name", "Mod folder");
    await page.click("#compile_button");
    await page.waitForFunction(() => document.querySelector("#compile_status").textContent.startsWith("Done"), null, { timeout: 30000 });
    assert.ok(await page.evaluate(() => window.__rm.resources.pack.names.includes("mymod:gizmo")), "assets folder picked directly");
    assert.ok(await page.evaluate(() => window.__rm.resources.pack.names.includes("othermod:gizmo")), "second namespace too");
    // Same short name in two namespaces gives two list entries, and the namespace filter separates them
    await page.click("#pack_close");
    assert.deepEqual(await page.$$eval("#block_namespace option", o => o.map(x => x.value)), ["", "mymod", "othermod"]);
    // Names of the two namespaces, in Chinese and English
    assert.equal(await page.locator(".block_item[data-name=\"mymod:gizmo\"] .block_name").textContent(), "小装置");
    assert.equal(await page.locator(".block_item[data-name=\"othermod:gizmo\"] .block_name").textContent(), "另一个装置");
    await page.fill("#block_search", "装置");
    assert.equal(await page.locator(".block_item:visible").count(), 2);
    await page.fill("#block_search", "other gizmo");
    assert.equal(await page.locator(".block_item:visible").count(), 1);
    await page.fill("#block_search", "");
    assert.equal(await page.locator(".block_item:visible").count(), 2);
    await page.selectOption("#block_namespace", "othermod");
    assert.equal(await page.locator(".block_item:visible").count(), 1);
    assert.equal(await page.locator(".block_item:visible").getAttribute("data-name"), "othermod:gizmo");
    await page.selectOption("#block_namespace", "");
    await page.click("#pack_button");

    // 2. A zip of a whole repository, assets a few levels down
    await page.evaluate(() => {
        window.__rm.pack_panel.sources.length = 0;
        window.__rm.pack_panel._render_sources();
    });
    const deep = Object.fromEntries(Object.entries(mod_files).map(([k, v]) => [`mymod-main/src/main/resources/${k}`, v]));
    await page.setInputFiles("#pack_file", [{ name: "mymod-main.zip", mimeType: "application/zip", buffer: Buffer.from(zip_of(deep)) }]);
    await page.waitForFunction(() => document.querySelectorAll("#source_list li:not(.note)").length === 1);
    await page.fill("#pack_name", "Mod zip");
    await page.click("#compile_button");
    await page.waitForFunction(() => document.querySelector("#compile_status").textContent.startsWith("Done: Mod zip"), null, { timeout: 30000 });
    assert.ok(await page.evaluate(() => window.__rm.resources.pack.names.includes("mymod:gizmo")), "deep assets folder in a zip");
    const quads = await page.evaluate(() => window.__rm.resources.pack.geometry("mymod:gizmo", {}).quads.length);
    assert.equal(quads, 6);
    await page.click("#pack_close");
});

/** A mod jar, or the game's: classes and other things next to the assets */
function jar_bytes(files) {
    return Buffer.from(zipSync({
        "META-INF/MANIFEST.MF": strToU8("Manifest-Version: 1.0"),
        "com/example/Mod.class": Uint8Array.from([0xCA, 0xFE, 0xBA, 0xBE]),
        "data/example/recipes/x.json": strToU8("{}"),
        ...Object.fromEntries(Object.entries(files).map(([path, value]) => [path, value instanceof Uint8Array ? [value, { level: 0 }] : strToU8(JSON.stringify(value))])),
    }));
}

await step("a compiled pack is recognised by its content, even when it was renamed", async () => {
    for (const name of ["Test stack.rmpack.zip", "renamed.bin", "Test stack (1).rmpack"]) {
        const { fresh, other } = await fresh_page();
        await other.click("#pack_button");
        await other.setInputFiles("#pack_file", [{ name, mimeType: "application/zip", buffer: Buffer.from(rmpack_bytes) }]);
        await other.waitForFunction(() => window.__rm.resources, null, { timeout: 15000 });
        await other.waitForSelector("#library_list li .pack_label");
        assert.equal(await other.locator("#source_list li:not(.note)").count(), 0, `${name} is not a source pack`);
        assert.equal(await other.locator("#library_list li .pack_label").count(), 1);
        if (!/\.rmpack$/.test(name)) {
            assert.match(await other.textContent("#compile_status"), /compiled pack/);
        }
        // Use works from the library as well, after a reload
        await other.reload();
        await other.waitForFunction(() => window.__rm?.resources, null, { timeout: 15000 });
        await fresh.close();
    }
});

await step("files without blocks are refused, and nothing is saved", async () => {
    const { fresh, other } = await fresh_page();
    await other.click("#pack_button");
    await other.setInputFiles("#pack_file", [{ name: "notes.zip", mimeType: "application/zip", buffer: Buffer.from(zip_of({ "readme.json": { hello: 1 } })) }]);
    await other.waitForFunction(() => document.querySelectorAll("#source_list li:not(.note)").length === 1);
    await other.click("#compile_button");
    await other.waitForFunction(() => document.getElementById("compile_status").classList.contains("error"), null, { timeout: 15000 });
    assert.match(await other.textContent("#compile_status"), /No blocks were found in notes/);
    assert.equal(await other.locator("#library_list li .pack_label").count(), 0);
    assert.equal(await other.evaluate(() => window.__rm.resources), null);
    await fresh.close();
});

await step("a mod jar is read for its assets and compiles", async () => {
    const { fresh, other } = await fresh_page();
    await other.click("#pack_button");
    await other.setInputFiles("#pack_file", [{ name: "mymod-1.0.jar", mimeType: "application/java-archive", buffer: jar_bytes(base_files()) }]);
    await other.waitForFunction(() => document.querySelectorAll("#source_list li:not(.note)").length === 1);
    assert.match(await other.textContent("#source_list li .pack_label"), /^mymod-1\.0 ·/);
    await other.click("#compile_button");
    await other.waitForFunction(() => document.querySelector("#compile_status").textContent.startsWith("Done"), null, { timeout: 30000 });
    assert.ok((await other.$$eval(".block_item", items => items.map(i => i.dataset.name))).includes("minecraft:stone"));
    await fresh.close();
});

/** Stands in for Mojang: the version list, a version, its client jar and the names of a language */
async function install_mojang(context, { blocked = false } = {}) {
    const jar = jar_bytes(base_files());
    const { createHash } = await import("node:crypto");
    const sha1 = bytes => createHash("sha1").update(bytes).digest("hex");
    const zh = Buffer.from(JSON.stringify({ "block.minecraft.stone": "石头" }));
    const headers = { "access-control-allow-origin": "*" };
    const seen = [];
    await context.route(/^https:\/\/(piston-meta|piston-data)\.mojang\.com\/|^https:\/\/resources\.download\.minecraft\.net\//, async (route) => {
        const { href } = new URL(route.request().url());
        seen.push(href);
        if (blocked) {
            return route.abort("failed");
        }
        const json = body => route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify(body) });
        if (href.endsWith("version_manifest_v2.json")) {
            return json({ latest: { release: "1.21.9" }, versions: [{ id: "1.21.9", type: "release", url: "https://piston-meta.mojang.com/v1/packages/r.json" }] });
        }
        if (href.endsWith("/r.json")) {
            return json({ downloads: { client: { url: "https://piston-data.mojang.com/v1/objects/a/client.jar", sha1: sha1(jar), size: jar.length } }, assetIndex: { url: "https://piston-meta.mojang.com/v1/packages/i/26.json" } });
        }
        if (href.endsWith("client.jar")) {
            return route.fulfill({ status: 200, headers, body: jar });
        }
        if (href.endsWith("26.json")) {
            return json({ objects: { "minecraft/lang/zh_cn.json": { hash: sha1(zh), size: zh.length } } });
        }
        return route.fulfill({ status: 200, headers, body: zh });
    });
    return seen;
}

await step("the game is fetched from Mojang, stacked at the bottom and compiled", async () => {
    const { fresh, other } = await fresh_page();
    const seen = await install_mojang(fresh);
    await other.click("#pack_button");
    await other.setInputFiles("#pack_file", [{ name: "overlay.zip", mimeType: "application/zip", buffer: Buffer.from(zip_of(overlay_files())) }]);
    await other.waitForFunction(() => document.querySelectorAll("#source_list li:not(.note)").length === 1);
    await other.click("#vanilla_button");
    await other.waitForFunction(() => /was added/.test(document.getElementById("compile_status").textContent), null, { timeout: 30000 });
    const labels = await other.$$eval("#source_list li .pack_label", items => items.map(i => i.textContent));
    assert.equal(labels.length, 2);
    assert.match(labels[0], /^overlay/);
    assert.match(labels[1], /^Minecraft 1\.21\.9/, "the game is the bottom layer");
    assert.ok(seen.some(url => url.endsWith("client.jar")) && seen.some(url => url.includes("resources.download.minecraft.net")));
    await other.click("#compile_button");
    await other.waitForFunction(() => document.querySelector("#compile_status").textContent.startsWith("Done"), null, { timeout: 30000 });
    assert.equal(await other.evaluate(() => window.__rm.resources.pack.display_name("minecraft:stone", "zh_cn")), "石头");
    await fresh.close();
});

await step("when Mojang cannot be reached the way out is explained", async () => {
    const before = problems.length;
    const { fresh, other } = await fresh_page();
    await install_mojang(fresh, { blocked: true });
    await other.click("#pack_button");
    await other.click("#vanilla_button");
    await other.waitForFunction(() => document.getElementById("compile_status").classList.contains("error"), null, { timeout: 30000 });
    assert.match(await other.textContent("#compile_status"), /Could not get Minecraft from Mojang.*client jar.*Add pack/);
    assert.equal(await other.locator("#source_list li:not(.note)").count(), 0);
    assert.equal(await other.locator("#vanilla_button").isDisabled(), false);
    await fresh.close();
    problems.length = before;
});

await step("large worlds: chunks are built in pieces, only the chunks that changed are built again", async () => {
    const { fresh, other } = await fresh_page();
    await other.click("#pack_button");
    await other.setInputFiles("#pack_file", [{ name: "Test stack.rmpack", mimeType: "application/zip", buffer: Buffer.from(rmpack_bytes) }]);
    await other.waitForFunction(() => window.__rm.resources, null, { timeout: 15000 });
    await other.click("#pack_close");
    // A space far bigger than the old limit of 64, filled solid in one corner
    const filled = await other.evaluate(async () => {
        const { world, scene } = window.__rm;
        scene.set_size({ x: 300, y: 40, z: 300 });
        const stone = { name: "minecraft:stone", props: {} };
        const glass = { name: "minecraft:glass", props: {} };
        const started = performance.now();
        for (let x = 0; x < 96; x++) {
            for (let z = 0; z < 96; z++) {
                for (let y = 0; y < 20; y++) {
                    world.set(x, y, z, (x + z) % 17 === 0 && y === 19 ? glass : stone);
                }
            }
        }
        world.set(299, 39, 299, stone);
        const set_ms = performance.now() - started;
        // Frames pass while the chunks are built; count how many calls it takes
        const mesh = scene.world_mesh;
        let frames = 0;
        const build_started = performance.now();
        while (!mesh.idle) {
            await new Promise(r => requestAnimationFrame(r));
            frames++;
            if (frames > 2000) {
                break;
            }
        }
        return { blocks: world.count, chunks: world.chunks.size, set_ms, frames, build_ms: performance.now() - build_started, meshes: mesh.meshes.length };
    });
    console.log(`  large world: ${filled.blocks} blocks in ${filled.chunks} chunks, set in ${Math.round(filled.set_ms)} ms, built over ${filled.frames} frames in ${Math.round(filled.build_ms)} ms`);
    assert.equal(filled.blocks, 96 * 96 * 20 + 1);
    assert.ok(filled.frames > 1, "a big build is spread over several frames");
    assert.ok(filled.meshes > 0);

    // An edit builds only the chunks it touches: the meshes of all the others are the very same objects
    const edit = await other.evaluate(async () => {
        const { world, scene } = window.__rm;
        const mesh = scene.world_mesh;
        const before = new Map(mesh.chunk_meshes);
        world.set(40, 25, 40, { name: "minecraft:stone", props: {} });
        mesh.update(Infinity);
        let same = 0;
        let changed = 0;
        for (const [key, meshes] of mesh.chunk_meshes) {
            if (before.get(key) && before.get(key)[0] === meshes[0]) {
                same++;
            }
            else {
                changed++;
            }
        }
        // On a chunk border the neighbour is built again too
        const border_before = new Map(mesh.chunk_meshes);
        world.set(47, 3, 47, { name: "minecraft:glass", props: {} });
        mesh.update(Infinity);
        let border_changed = 0;
        for (const [key, meshes] of mesh.chunk_meshes) {
            if (border_before.get(key)?.[0] !== meshes[0]) {
                border_changed++;
            }
        }
        return { same, changed, total: mesh.chunk_meshes.size, border_changed };
    });
    assert.ok(edit.changed >= 1 && edit.changed <= 2, `${edit.changed} chunks changed`);
    assert.ok(edit.same > 30, `${edit.same} chunks left alone`);
    assert.ok(edit.border_changed >= 1 && edit.border_changed <= 4, `${edit.border_changed} changed at a border`);

    // Picking works through the chunk meshes, and the model is kept (it is too big for localStorage)
    await other.evaluate(() => {
        const { scene } = window.__rm;
        scene.camera.zoom = 2;
        scene.camera.position.set(120, 90, 120);
        scene.controls.target.set(48, 10, 48);
        scene.camera.updateProjectionMatrix();
        scene.controls.update();
    });
    await other.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const picked = await other.evaluate(() => {
        const { scene } = window.__rm;
        const p = scene.screen_position(48, 19, 48);
        return scene.pick(p.x, p.y);
    });
    assert.ok(picked.hit, "a block of a far chunk is hit");
    assert.deepEqual(picked.hit, [48, 19, 48]);
    assert.deepEqual(picked.place, [48, 20, 48]);

    // A 2D view across several chunks still shows the whole cut
    await other.evaluate(() => window.__rm.scene.view_to("+y"));
    await other.waitForFunction(() => window.__rm.scene.view !== null && !window.__rm.scene.animation, null, { timeout: 5000 });
    await other.evaluate(() => window.__rm.scene.set_plane(10));
    await other.waitForFunction(() => window.__rm.scene.world_mesh.idle, null, { timeout: 30000 });
    const cut = await other.evaluate(() => window.__rm.scene.world_mesh.meshes.reduce((sum, mesh) => sum + mesh.userData.cells.length, 0));
    assert.ok(cut > 96 * 96, `${cut} faces in the cut`);
    // Moving the plane inside one chunk layer builds only what the plane passed through
    await other.evaluate(() => window.__rm.scene.view_to("+x"));
    await other.waitForFunction(() => window.__rm.scene.view?.axis === 0 && !window.__rm.scene.animation, null, { timeout: 5000 });
    await other.evaluate(() => window.__rm.scene.set_plane(40));
    await other.waitForFunction(() => window.__rm.scene.world_mesh.idle, null, { timeout: 30000 });
    const moved = await other.evaluate(async () => {
        const { scene } = window.__rm;
        const mesh = scene.world_mesh;
        const before = new Map(mesh.chunk_meshes);
        scene.set_plane(41);
        mesh.update(Infinity);
        let changed = 0;
        for (const [key, meshes] of mesh.chunk_meshes) {
            if (before.get(key)?.[0] !== meshes[0]) {
                changed++;
            }
        }
        return { changed, total: mesh.chunk_meshes.size };
    });
    assert.ok(moved.changed > 0 && moved.changed < moved.total / 2, `${moved.changed} of ${moved.total} chunks built again for one step of the plane`);

    await other.waitForFunction(() => window.__rm.world.count > 100000);
    await other.waitForTimeout(2200);
    await other.reload();
    await other.waitForFunction(() => window.__rm?.resources && window.__rm.world.count > 100000, null, { timeout: 30000 });
    assert.deepEqual(await other.evaluate(() => window.__rm.world.size), { x: 300, y: 40, z: 300 });
    await fresh.close();
});

await step("a damaged saved pack is reported on the page and the interface still works", async () => {
    await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open("redstone-modeler");
        request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(["meta", "blobs"], "readwrite");
            const active = tx.objectStore("meta").get("active");
            active.onsuccess = () => tx.objectStore("blobs").put(new Uint8Array([1, 2, 3]), active.result);
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        };
    }));
    await page.reload();
    await page.waitForFunction(() => window.__rm);
    await page.waitForFunction(() => !document.querySelector("#onboarding_note").hidden);
    assert.match(await page.textContent("#onboarding_note"), /could not be loaded/);
    assert.equal(await page.locator("#onboarding").isVisible(), true);
    // The buttons work, and importing the pack again recovers
    await page.click("#pack_button");
    await page.setInputFiles("#pack_file", [{ name: "Test stack.rmpack", mimeType: "application/zip", buffer: rmpack_bytes }]);
    await page.waitForFunction(() => window.__rm.resources, null, { timeout: 15000 });
    await page.click("#pack_close");
    assert.equal(await page.locator("#onboarding").isVisible(), false);
});

await step("problems are shown on the page: no WebGL 2, a broken module, a missing file", async () => {
    const banner_of = async (setup) => {
        const other = await browser.newPage();
        await setup(other);
        await other.goto(url);
        await other.waitForSelector("#error_banner", { timeout: 15000 });
        const result = { text: await other.textContent("#error_banner"), started: await other.evaluate(() => Boolean(window.__rm)) };
        await other.close();
        return result;
    };
    const no_webgl2 = await banner_of(other => other.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
            return type === "webgl2" || type === "webgl" ? null : original.call(this, type, ...rest);
        };
    }));
    assert.match(no_webgl2.text, /does not support WebGL 2/);
    assert.match(no_webgl2.text, /WebGL2: false/);
    assert.equal(no_webgl2.started, false);

    const broken = await banner_of(other => other.route("**/js/pack/Atlas.mjs*", route => route.fulfill({ contentType: "text/javascript", body: "export const broken = ;" })));
    assert.match(broken.text, /could not start/);
    assert.equal(broken.started, false);

    const missing = await banner_of(other => other.route("**/lib/three.module.min.js*", route => route.fulfill({ status: 404, body: "" })));
    assert.match(missing.text, /could not start/);
    assert.match(missing.text, /build /);
});

// --- sharing a model together with the resources it uses ---

/** Same camera everywhere, so that two pages can be compared pixel by pixel */
async function fixed_view(target) {
    await target.evaluate(() => {
        const { scene } = window.__rm;
        const d = [0.4, 0.6, 0.7];
        const n = Math.hypot(...d);
        scene.camera.zoom = 1;
        scene.camera.position.set(10 + d[0] / n * 60, 10 + d[1] / n * 60, 10 + d[2] / n * 60);
        scene.controls.target.set(10, 10, 10);
        scene.camera.updateProjectionMatrix();
        scene.controls.update();
    });
    await target.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** A number for everything the WebGL canvas shows, and how much of it is red */
function picture_of(target) {
    return target.evaluate(() => {
        const src = document.getElementById("canvas3d");
        const copy = document.createElement("canvas");
        copy.width = src.width;
        copy.height = src.height;
        const ctx = copy.getContext("2d");
        ctx.drawImage(src, 0, 0);
        const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
        let hash = 2166136261;
        let red = 0;
        for (let i = 0; i < data.length; i += 4) {
            hash = Math.imul(hash ^ data[i] ^ (data[i + 1] << 8) ^ (data[i + 2] << 16), 16777619);
            if (data[i] > 150 && data[i + 1] < 80 && data[i + 2] < 80) {
                red++;
            }
        }
        return { hash, red };
    });
}

/**
 * Stands in for the network clipboards. `store` is shared between pages, so that what one page
 * uploads another can fetch. Options: `blocked`, `mangle(bytes)`, `status`.
 */
async function install_mock(context, { store, blocked = false, mangle = x => x, status = 200, log = [] }) {
    const headers = { "access-control-allow-origin": "*" };
    await context.route(/^https:\/\/api\.(mclo\.gs|pastes\.dev)\//, async (route) => {
        const request = route.request();
        const { hostname, pathname } = new URL(request.url());
        log.push(`${request.method()} ${hostname}${pathname}`);
        if (blocked) {
            // What the page sees when the browser refuses a request across origins
            return route.abort("failed");
        }
        if (status !== 200) {
            return route.fulfill({ status, headers, body: "no" });
        }
        const mclogs = hostname === "api.mclo.gs";
        if (request.method() === "POST") {
            const id = `id${store.size + 1}x`;
            const bytes = mclogs
                ? new TextEncoder().encode(new URLSearchParams(request.postData()).get("content"))
                : request.postDataBuffer();
            store.set(`${mclogs ? "mclogs" : "pastes"}/${id}`, mangle(new Uint8Array(bytes)));
            return route.fulfill({ status: 200, headers, contentType: "application/json", body: JSON.stringify(mclogs ? { success: true, id } : { key: id }) });
        }
        const id = pathname.split("/").pop();
        const bytes = store.get(`${mclogs ? "mclogs" : "pastes"}/${id}`);
        return bytes ? route.fulfill({ status: 200, headers, body: Buffer.from(bytes) }) : route.fulfill({ status: 404, headers, body: "none" });
    });
}

const SHARED_BLOCKS = [
    [10, 0, 10, "minecraft:observer", { facing: "south", powered: "true" }],
    [11, 0, 10, "minecraft:observer", { facing: "north", powered: "false" }],
    [12, 0, 10, "minecraft:stone", {}],
    [13, 0, 10, "minecraft:glass", {}],
    [14, 0, 10, "minecraft:grass_block", {}],
    [10, 0, 12, "minecraft:oak_fence", { north: "true" }],
];

async function fresh_page(hash = "", mock = null) {
    const fresh = await browser.newContext({ locale: "en-US", viewport: { width: 1100, height: 760 }, permissions: ["clipboard-read", "clipboard-write"] });
    if (mock) {
        await install_mock(fresh, mock);
    }
    const other = await fresh.newPage();
    other.on("pageerror", e => problems.push(e.message));
    await other.goto(url + hash);
    await other.waitForFunction(() => window.__rm);
    return { fresh, other };
}

let sender_picture;
let shared_code;
let shared_file;

await step("share: the size of what is shared depends on what is included", async () => {
    await page.evaluate((blocks) => {
        const { world } = window.__rm;
        world.clear();
        for (const [x, y, z, name, props] of blocks) {
            world.set(x, y, z, { name, props });
        }
    }, SHARED_BLOCKS);
    await fixed_view(page);
    sender_picture = await picture_of(page);
    assert.ok(sender_picture.red > 100, "the powered observer is red");

    await page.click("#share_button");
    const stats = {};
    for (const scope of ["used", "all", "pack"]) {
        await page.selectOption("#share_scope", scope);
        await page.waitForFunction(s => window.__rm.share_panel.result?.stats && window.__rm.share_panel.scope.value === s && /characters/.test(document.getElementById("share_stats").textContent), scope);
        stats[scope] = await page.evaluate(() => window.__rm.share_panel.result.stats);
        assert.ok(stats[scope].code_length > stats[scope].bytes, `${scope}: base64 is longer than the bytes`);
    }
    assert.equal(stats.used.blocks, 5, "observer, stone, glass, grass block, fence");
    assert.ok(stats.used.textures < stats.pack.textures, "fewer textures than the whole pack");
    assert.ok(stats.used.bytes < stats.all.bytes || stats.used.bytes <= stats.pack.bytes);
    assert.ok(stats.used.bytes < stats.pack.bytes, `${stats.used.bytes} bytes against ${stats.pack.bytes}`);
    assert.ok(stats.used.models <= stats.all.models && stats.all.models <= stats.pack.models);
    // Block names of every language only with the checkbox
    const trimmed = await page.evaluate(() => window.__rm.share_panel.result.stats.parts.names);
    await page.check("#share_all_languages");
    await page.waitForFunction(() => /characters/.test(document.getElementById("share_stats").textContent));
    assert.ok(await page.evaluate(() => window.__rm.share_panel.result.stats.parts.names) >= trimmed);
    await page.uncheck("#share_all_languages");
    // The warning says when a chat message is too short for the code
    await page.selectOption("#share_scope", "used");
    await page.waitForFunction(() => window.__rm.share_panel.scope.value === "used" && window.__rm.share_panel.result?.stats.blocks === 5);
    const long = stats.used.code_length > 2000;
    assert.equal((await page.textContent("#share_warning")).length > 0, long);
    assert.match(await page.textContent("#share_parts"), /models and states .*pictures .*block names .*the model/);
});

await step("share: copy the code and download the file", async () => {
    await page.click("#share_copy");
    await page.waitForFunction(() => document.getElementById("share_status").textContent === "Code copied");
    shared_code = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(shared_code.startsWith("RMS2."), "the compact encoding is the default");
    assert.equal(shared_code, await page.evaluate(() => window.__rm.share_panel.result.code));
    assert.equal(await page.inputValue("#share_code"), shared_code, "short codes are shown");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#share_download")]);
    assert.equal(download.suggestedFilename(), "model.rmmodel");
    shared_file = await readFile(await download.path());
    assert.equal(shared_file.subarray(0, 2).toString(), "PK");
    await page.click("#share_close");
});

await step("share: a browser without any resource pack shows the same picture from the code", async () => {
    const { fresh, other } = await fresh_page();
    assert.equal(await other.locator("#onboarding").isVisible(), true);
    await other.fill("#load_input", shared_code);
    await other.click("#load_button");
    await other.waitForFunction(() => window.__rm.resources && window.__rm.world.count === 6, null, { timeout: 15000 });
    assert.equal(await other.locator("#onboarding").isVisible(), false);
    assert.match(await other.textContent("#pack_summary"), /\(shared\)$/);
    // Only the blocks that were used
    assert.deepEqual(
        (await other.$$eval(".block_item", items => items.map(i => i.dataset.name))).sort(),
        ["minecraft:glass", "minecraft:grass_block", "minecraft:observer", "minecraft:oak_fence", "minecraft:stone"].sort(),
    );
    await fixed_view(other);
    assert.deepEqual(await picture_of(other), sender_picture, "pixel for pixel the same");
    // The names came along
    assert.equal(await other.locator(".block_item[data-name=\"minecraft:stone\"] .block_name").textContent(), "石头");
    // The pack is kept in the library and the receiver's own choice stays possible
    await other.click("#pack_button");
    await other.waitForSelector("#library_list li .pack_label");
    assert.match(await other.textContent("#library_list li .pack_label"), /\(shared\)/);
    await fresh.close();
});

await step("share: a state that was not placed is missing with 'only used states', and works with 'every state'", async () => {
    const check = async (code, expect_missing) => {
        const { fresh, other } = await fresh_page();
        await other.fill("#load_input", code);
        await other.click("#load_button");
        await other.waitForFunction(() => window.__rm.resources && window.__rm.world.count === 6, null, { timeout: 15000 });
        const textures = await other.evaluate(() => window.__rm.resources.pack.geometry("minecraft:observer", { facing: "east", powered: "false" }).quads.map(q => q.tex));
        assert.equal(textures.every(tex => tex === "minecraft:missing"), expect_missing, textures.join());
        await fresh.close();
    };
    await check(shared_code, true);
    await page.click("#share_button");
    await page.selectOption("#share_scope", "all");
    await page.waitForFunction(() => window.__rm.share_panel.scope.value === "all" && window.__rm.share_panel.result?.stats && /characters/.test(document.getElementById("share_stats").textContent));
    await page.click("#share_copy");
    const all_code = await page.evaluate(() => navigator.clipboard.readText());
    await check(all_code, false);
    await page.click("#share_close");
});

await step("share: the file and the whole pack work as well", async () => {
    // The file, opened from the dialog
    const { fresh, other } = await fresh_page();
    await other.click("#share_button");
    await other.setInputFiles("#share_file", [{ name: "model.rmmodel", mimeType: "application/zip", buffer: shared_file }]);
    await other.waitForFunction(() => document.getElementById("share_open_status").textContent.startsWith("Opened"), null, { timeout: 15000 });
    await other.click("#share_close");
    await fixed_view(other);
    assert.deepEqual(await picture_of(other), sender_picture);
    await fresh.close();

    // The whole compiled pack: every block of the pack is there
    await page.click("#share_button");
    await page.selectOption("#share_scope", "pack");
    await page.waitForFunction(() => window.__rm.share_panel.scope.value === "pack" && window.__rm.share_panel.result?.stats && /characters/.test(document.getElementById("share_stats").textContent));
    await page.click("#share_copy");
    const pack_code = await page.evaluate(() => navigator.clipboard.readText());
    const all_blocks = await page.evaluate(() => window.__rm.resources.pack.names.length);
    await page.click("#share_close");
    const second = await fresh_page();
    await second.other.fill("#load_input", pack_code);
    await second.other.click("#load_button");
    await second.other.waitForFunction(() => window.__rm.resources && window.__rm.world.count === 6, null, { timeout: 15000 });
    assert.equal(await second.other.locator(".block_item").count(), all_blocks);
    await fixed_view(second.other);
    assert.deepEqual(await picture_of(second.other), sender_picture);
    // Only English and the chosen language are kept
    await second.other.click("#settings_button");
    assert.deepEqual(await second.other.$$eval("#search_language option", o => o.map(x => x.value)), ["", "zh_cn"]);
    await second.fresh.close();
});

await step("share: the standard encoding still works, and the compact one is shorter", async () => {
    await page.click("#share_button");
    await page.selectOption("#share_scope", "used");
    await page.waitForFunction(() => window.__rm.share_panel.result?.stats.compact === true);
    const compact = await page.evaluate(() => window.__rm.share_panel.result.stats);
    assert.ok(compact.code_length < compact.standard_code_length, `${compact.code_length} against ${compact.standard_code_length}`);
    assert.match(await page.textContent("#share_stats"), /the standard code would be/);
    await page.uncheck("#share_compact");
    await page.waitForFunction(() => window.__rm.share_panel.result?.stats.compact === false);
    await page.click("#share_copy");
    const standard = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(standard.startsWith("RMS1."));
    await page.check("#share_compact");
    await page.click("#share_close");
    const { fresh, other } = await fresh_page();
    await other.fill("#load_input", standard);
    await other.click("#load_button");
    await other.waitForFunction(() => window.__rm.resources && window.__rm.world.count === 6, null, { timeout: 15000 });
    await fixed_view(other);
    assert.deepEqual(await picture_of(other), sender_picture);
    await fresh.close();
});

await step("share: minimal has no readable ids, and the blocks are found by their names", async () => {
    await page.click("#share_button");
    await page.check("#share_minimal");
    await page.waitForFunction(() => window.__rm.share_panel.result?.stats.compact && document.getElementById("share_compact").disabled);
    await page.click("#share_copy");
    const minimal = await page.evaluate(() => navigator.clipboard.readText());
    const raw = await page.evaluate(() => Array.from(window.__rm.share_panel.result.raw, b => String.fromCharCode(b)).join(""));
    const { inflateSync } = await import("../lib/fflate.module.js");
    // The placeholder texture keeps its id
    const text = new TextDecoder().decode(inflateSync(Buffer.from(raw.slice(4), "latin1"))).replaceAll("minecraft:missing", "");
    for (const word of ["minecraft", "observer", "powered", "facing", "block/stone"]) {
        assert.ok(!text.includes(word), `"${word}" is in a minimal share`);
    }
    await page.uncheck("#share_minimal");
    await page.click("#share_close");

    const { fresh, other } = await fresh_page();
    await other.fill("#load_input", minimal);
    await other.click("#load_button");
    await other.waitForFunction(() => window.__rm.resources && window.__rm.world.count === 6, null, { timeout: 15000 });
    await fixed_view(other);
    assert.deepEqual(await picture_of(other), sender_picture, "this model has few colours, so nothing is lost");
    const names = await other.$$eval(".block_item", items => items.map(i => i.dataset.name));
    assert.equal(names.length, 5);
    assert.ok(names.every(name => /^b:/.test(name)));
    assert.ok((await other.$$eval(".block_item", items => items.map(i => i.title))).every(title => !title.includes(":")));
    const search = async (query) => {
        await other.fill("#block_search", query);
        return other.$$eval(".block_item", items => items.filter(i => !i.hidden && i.style.display !== "none").map(i => i.querySelector(".block_name").textContent));
    };
    assert.deepEqual(await search("stone"), ["石头"], "the English name finds it, the chosen language is shown");
    assert.deepEqual(await search("石头"), ["石头"]);
    assert.deepEqual(await search("minecraft:stone"), []);
    assert.deepEqual(await search("b:"), []);
    await fresh.close();
});

await step("share: a share link goes through a network clipboard and opens in another browser", async () => {
    for (const service of ["mclogs", "pastes"]) {
        const store = new Map();
        const log = [];
        const mock = { store, log };
        await install_mock(context, mock);
        const messages = [];
        const on_dialog = (dialog) => {
            messages.push(dialog.message());
            dialog.accept();
        };
        page.on("dialog", on_dialog);
        await page.click("#share_button");
        await page.selectOption("#share_service", service);
        await page.waitForFunction(() => window.__rm.share_panel.result?.stats.compact);
        await page.click("#share_link_button");
        await page.waitForFunction(() => /Link copied|Could not/.test(document.getElementById("share_status").textContent), null, { timeout: 15000 });
        assert.equal(await page.textContent("#share_status"), "Link copied");
        const link = await page.evaluate(() => navigator.clipboard.readText());
        assert.equal(link, await page.inputValue("#share_link"));
        assert.match(link, new RegExp(`#share=${service}\\.id1x$`));
        assert.ok(log.some(entry => entry.startsWith("POST")) && log.some(entry => entry.startsWith("GET")), "it was read back");
        // The agreement is asked for once
        await page.click("#share_link_button");
        await page.waitForFunction(() => document.getElementById("share_link_button").disabled === false);
        assert.equal(messages.length, service === "mclogs" ? 1 : 0, "asked the first time only");
        page.off("dialog", on_dialog);
        await page.click("#share_close");
        await page.unroute(/^https:\/\/api\./);

        const { fresh, other } = await fresh_page(link.slice(link.indexOf("#")), { store, log: [] });
        await other.waitForFunction(() => window.__rm.resources && window.__rm.world.count === 6, null, { timeout: 15000 });
        assert.equal(await other.evaluate(() => location.hash), "", "the link is removed from the address");
        assert.match(await other.textContent("#pack_summary"), /\(shared\)$/);
        await fixed_view(other);
        assert.deepEqual(await picture_of(other), sender_picture, service);
        await fresh.close();

        // Also from the Load box, as a link or as the address of the paste
        const second = await fresh_page("", { store, log: [] });
        await second.other.fill("#load_input", link);
        await second.other.click("#load_button");
        await second.other.waitForFunction(() => window.__rm.world.count === 6, null, { timeout: 15000 });
        await second.fresh.close();
    }
});

await step("share: a service that fails, changes the content, or does not allow the page is reported", async () => {
    const before = problems.length;
    const cases = [
        ["changed", { store: new Map(), mangle: bytes => bytes.slice(0, bytes.length - 10) }, /changed what was uploaded/],
        ["http", { store: new Map(), status: 503 }, /answered 503/],
        ["blocked", { store: new Map(), blocked: true }, /could not be reached/],
    ];
    for (const [name, mock, expected] of cases) {
        await install_mock(context, mock);
        await page.click("#share_button");
        await page.selectOption("#share_service", "mclogs");
        await page.waitForFunction(() => window.__rm.share_panel.result?.stats.compact);
        await page.click("#share_link_button");
        await page.waitForFunction(() => document.getElementById("share_status").classList.contains("error"), null, { timeout: 20000 })
            .catch(async (error) => {
                throw new Error(`${name}: ${await page.textContent("#share_status")} / ${error.message}`);
            });
        assert.match(await page.textContent("#share_status"), expected, name);
        assert.match(await page.textContent("#share_status"), /code and the file still work/);
        assert.equal(await page.locator("#share_link").isVisible(), false, "no link is given out");
        assert.equal(await page.locator("#share_copy").isDisabled(), false, "the code still works");
        await page.click("#share_close");
        await page.unroute(/^https:\/\/api\./);
    }
    // A link to something that is not there
    const { fresh, other } = await fresh_page("#share=mclogs.nothing", { store: new Map() });
    await other.waitForFunction(() => document.getElementById("link_banner").classList.contains("error"), null, { timeout: 15000 });
    assert.match(await other.textContent("#link_banner"), /Could not open the shared model/);
    assert.equal(await other.evaluate(() => window.__rm.world.count), 0);
    await other.click("#pack_button");
    assert.equal(await other.locator("#pack_dialog").isVisible(), true, "the page still works");
    await fresh.close();
    // Failing is what this step does; the errors the page logged about it are expected
    problems.length = before;
});

await step("share: a damaged or foreign code is refused and nothing breaks", async () => {
    const { fresh, other } = await fresh_page();
    for (const code of ["RMS1.AAAA", "RMS1.!!!", "RMS1.", `${shared_code.slice(0, 200)}`]) {
        await other.fill("#load_input", code);
        await other.click("#load_button");
        await other.waitForFunction(() => document.getElementById("load_button").textContent === "Invalid code");
        await other.waitForFunction(() => document.getElementById("load_button").textContent === "Load", null, { timeout: 5000 });
    }
    assert.equal(await other.locator("#onboarding").isVisible(), true);
    await other.click("#share_button");
    await other.fill("#share_paste", "RMS1.not-a-model");
    await other.click("#share_open_button");
    await other.waitForFunction(() => document.getElementById("share_open_status").textContent.startsWith("Could not open it"));
    assert.equal(await other.evaluate(() => window.__rm.world.count), 0);
    await other.click("#share_close");
    await other.click("#pack_button");
    assert.equal(await other.locator("#pack_dialog").isVisible(), true);
    await fresh.close();
});

/** The blocks of the share tests as a schematic of the given format; the box starts at 0,0,0 like the ones the editor writes */
function schematic_bytes(format, blocks = SHARED_BLOCKS) {
    const low = [0, 1, 2].map(axis => blocks.reduce((best, block) => Math.min(best, block[axis]), Infinity));
    const high = [0, 1, 2].map(axis => blocks.reduce((best, block) => Math.max(best, block[axis]), -Infinity));
    const builder = new BlueprintBuilder({ x: high[0] - low[0] + 1, y: high[1] - low[1] + 1, z: high[2] - low[2] + 1 });
    for (const [x, y, z, name, props] of blocks) {
        builder.add(x - low[0], y - low[1], z - low[2], builder.entry({ name, props }));
    }
    return { bytes: Buffer.from(write_blueprint(builder.finish(), format, {})), low };
}

await step("schematics: every format opens with the size of the file, and what is saved opens again with the same picture", async () => {
    for (const [format, extension] of [["litematic", "litematic"], ["schem", "schem"], ["nbt", "nbt"]]) {
        const { bytes, low } = schematic_bytes(format);
        const { fresh, other } = await fresh_page();
        await other.click("#pack_button");
        await other.setInputFiles("#pack_file", [{ name: "Test stack.rmpack", mimeType: "application/zip", buffer: Buffer.from(rmpack_bytes) }]);
        await other.waitForFunction(() => window.__rm.resources, null, { timeout: 15000 });
        await other.click("#pack_close");
        // The same blocks placed by hand, moved to the corner as the file has them
        await other.evaluate(([blocks, corner]) => {
            const { world, scene } = window.__rm;
            scene.set_size({ x: 5, y: 1, z: 3 });
            world.clear();
            for (const [x, y, z, name, props] of blocks) {
                world.set(x - corner[0], y - corner[1], z - corner[2], { name, props });
            }
        }, [SHARED_BLOCKS, low]);
        const wanted_size = await other.evaluate(() => window.__rm.world.size);
        assert.deepEqual(wanted_size, { x: 5, y: 1, z: 3 });
        const by_hand = await other.evaluate(() => [...window.__rm.world.entries()].length);
        await other.evaluate(() => {
            // A different size, so that opening the file has to set the size
            window.__rm.scene.set_size({ x: 30, y: 30, z: 30 });
            window.__rm.world.clear();
        });
        await other.click("#schematic_button");
        await other.setInputFiles("#schematic_file", [{ name: `model.${extension}`, mimeType: "application/octet-stream", buffer: bytes }]);
        await other.waitForFunction(() => /^Opened/.test(document.getElementById("schematic_import_status").textContent), null, { timeout: 15000 });
        assert.match(await other.textContent("#schematic_import_status"), /5 × 1 × 3, 6 blocks, 6 kinds/);
        assert.deepEqual(await other.evaluate(() => window.__rm.world.size), { x: 5, y: 1, z: 3 });
        assert.equal(await other.evaluate(() => window.__rm.world.count), by_hand);
        assert.deepEqual(await other.evaluate(() => [document.getElementById("size_x").value, document.getElementById("size_y").value, document.getElementById("size_z").value]), ["5", "1", "3"], "the settings show the new size");
        // The observer is in the model with its state
        assert.deepEqual(await other.evaluate(() => window.__rm.world.get(0, 0, 0)), { name: "minecraft:observer", props: { facing: "south", powered: "true" } });

        // Save it again in the same format and open that in another browser
        await other.selectOption("#schematic_format", format);
        const [download] = await Promise.all([other.waitForEvent("download"), other.click("#schematic_save")]);
        assert.equal(download.suggestedFilename(), `model.${extension}`);
        const saved = await readFile(await download.path());
        assert.match(await other.textContent("#schematic_export_status"), /Saved 6 blocks, 5 × 1 × 3/);
        await other.click("#schematic_close");
        await fixed_view(other);
        const first = await picture_of(other);
        assert.ok(first.red > 0, "the powered observer shows");

        const second = await fresh_page();
        await second.other.click("#pack_button");
        await second.other.setInputFiles("#pack_file", [{ name: "Test stack.rmpack", mimeType: "application/zip", buffer: Buffer.from(rmpack_bytes) }]);
        await second.other.waitForFunction(() => window.__rm.resources, null, { timeout: 15000 });
        await second.other.click("#pack_close");
        await second.other.click("#schematic_button");
        await second.other.setInputFiles("#schematic_file", [{ name: `again.${extension}`, mimeType: "application/octet-stream", buffer: saved }]);
        await second.other.waitForFunction(() => /^Opened/.test(document.getElementById("schematic_import_status").textContent), null, { timeout: 15000 });
        await second.other.click("#schematic_close");
        await fixed_view(second.other);
        assert.deepEqual(await picture_of(second.other), first, `${format}: the saved file shows the same picture`);
        await second.fresh.close();
        await fresh.close();
    }
});

await step("schematics: a file dropped on the page opens, a file that cannot be read says why, a big model is built", async () => {
    const { fresh, other } = await fresh_page();
    await other.click("#pack_button");
    await other.setInputFiles("#pack_file", [{ name: "Test stack.rmpack", mimeType: "application/zip", buffer: Buffer.from(rmpack_bytes) }]);
    await other.waitForFunction(() => window.__rm.resources, null, { timeout: 15000 });
    await other.click("#pack_close");
    const { bytes } = schematic_bytes("schem");
    await other.evaluate(async (base64) => {
        const file = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], "dropped.schem");
        const data = new DataTransfer();
        data.items.add(file);
        document.getElementById("canvas3d").dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    }, bytes.toString("base64"));
    await other.waitForFunction(() => /^Opened/.test(document.getElementById("schematic_import_status").textContent), null, { timeout: 15000 });
    assert.equal(await other.evaluate(() => window.__rm.world.count), 6);
    await other.click("#schematic_close");

    // Files that are not schematics, and the ones that are not supported
    const old_schematic = Buffer.from(write_nbt({ Width: short(1), Height: short(1), Length: short(1), Materials: "Alpha", Blocks: Int8Array.of(1), Data: Int8Array.of(0) }, "Schematic"));
    const cases = [
        ["old.schematic", old_schematic, /old \.schematic/],
        ["notes.litematic", Buffer.from("this is not nbt"), /not a schematic/],
        ["other.nbt", Buffer.from(write_nbt({ hello: 1 }, "")), /not a litematic/],
        ["bedrock.mcstructure", Buffer.from([10, 0, 0, 3, 7, 0, 102, 111, 114, 109, 97, 116, 95, 118, 1, 0, 0, 0, 0]), /Bedrock/],
    ];
    const kept = await other.evaluate(() => window.__rm.world.count);
    for (const [name, buffer, expected] of cases) {
        await other.click("#schematic_button");
        await other.setInputFiles("#schematic_file", [{ name, mimeType: "application/octet-stream", buffer }]);
        await other.waitForFunction(() => document.getElementById("schematic_import_status").classList.contains("error"), null, { timeout: 15000 });
        assert.match(await other.textContent("#schematic_import_status"), expected, name);
        assert.equal(await other.evaluate(() => window.__rm.world.count), kept, "a file that fails changes nothing");
        await other.click("#schematic_close");
    }

    // A model of 200 x 30 x 200 with more than 100000 blocks goes in and gets built in pieces
    const big = [];
    for (let x = 0; x < 200; x++) {
        for (let z = 0; z < 200; z++) {
            for (let y = 0; y < 3 + ((x + z) % 3); y++) {
                big.push([x, y, z, (x + y + z) % 5 === 0 ? "minecraft:glass" : "minecraft:stone", {}]);
            }
        }
    }
    const large = schematic_bytes("litematic", big);
    await other.click("#schematic_button");
    await other.setInputFiles("#schematic_file", [{ name: "big.litematic", mimeType: "application/octet-stream", buffer: large.bytes }]);
    await other.waitForFunction(() => /^Opened/.test(document.getElementById("schematic_import_status").textContent), null, { timeout: 60000 });
    assert.match(await other.textContent("#schematic_import_status"), /200 × 5 × 200, 160,000 blocks|200 × 5 × 200, 160000 blocks/);
    assert.match(await other.textContent("#schematic_import_status"), /big model/);
    await other.waitForFunction(() => window.__rm.scene.world_mesh.idle, null, { timeout: 60000 });
    assert.ok(await other.evaluate(() => window.__rm.scene.world_mesh.meshes.length) > 0);
    await other.click("#schematic_close");
    // A size above the limit of the space is refused
    const huge = Buffer.from(write_nbt({ DataVersion: 3955, size: { type: 3, items: [5000, 1, 1] }, palette: { type: 10, items: [{ Name: "minecraft:stone" }] }, blocks: { type: 10, items: [] } }, ""));
    await other.click("#schematic_button");
    await other.setInputFiles("#schematic_file", [{ name: "huge.nbt", mimeType: "application/octet-stream", buffer: huge }]);
    await other.waitForFunction(() => document.getElementById("schematic_import_status").classList.contains("error"), null, { timeout: 15000 });
    assert.match(await other.textContent("#schematic_import_status"), /4096 blocks at most/);
    await fresh.close();
});

await step("phone: quick repeated taps place blocks and never zoom the page", async () => {
    const phone = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mobile = await phone.newPage();
    mobile.on("pageerror", e => problems.push(e.message));
    await mobile.goto(url);
    await mobile.waitForFunction(() => window.__rm);
    await mobile.click("#pack_button");
    await mobile.setInputFiles("#pack_file", [{ name: "Test stack.rmpack", mimeType: "application/zip", buffer: rmpack_bytes }]);
    await mobile.waitForFunction(() => window.__rm.resources, null, { timeout: 15000 });
    await mobile.click("#pack_close");
    await mobile.evaluate(() => window.__rm.picker.select("minecraft:stone"));

    const styles = await mobile.evaluate(() => {
        const touch_action = selector => getComputedStyle(document.querySelector(selector)).touchAction;
        const prevented = (target, type) => {
            const event = new Event(type, { cancelable: true, bubbles: true });
            target.dispatchEvent(event);
            return event.defaultPrevented;
        };
        return {
            body: touch_action("body"),
            button: touch_action("#layer_up"),
            hotbar: touch_action("#hotbar button"),
            canvas: touch_action("#canvas3d"),
            gesturestart: prevented(document, "gesturestart"),
            canvas_touchend: prevented(document.getElementById("canvas3d"), "touchend"),
            meta: document.querySelector("meta[name=viewport]").content,
        };
    });
    assert.equal(styles.body, "manipulation");
    assert.equal(styles.button, "manipulation");
    assert.equal(styles.hotbar, "manipulation");
    assert.equal(styles.canvas, "none");
    assert.equal(styles.gesturestart, true);
    assert.equal(styles.canvas_touchend, true);
    assert.match(styles.meta, /maximum-scale=1/);

    const cells = [[8, 8], [9, 8], [10, 8], [9, 9], [8, 9], [10, 9]];
    for (const [x, z] of cells) {
        const pos = await mobile.evaluate(([a, b]) => window.__rm.scene.screen_position(a, -0.5, b), [x, z]);
        await mobile.touchscreen.tap(pos.x, pos.y);
    }
    assert.equal(await mobile.evaluate(() => window.__rm.world.count), cells.length);
    assert.equal(await mobile.evaluate(() => window.visualViewport.scale), 1);
    await phone.close();
});

await browser.close();
server.close();
assert.deepEqual(problems, [], `browser errors:\n${problems.join("\n")}`);
console.log("all browser checks passed");
