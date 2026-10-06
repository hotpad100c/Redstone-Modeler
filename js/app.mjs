import { MODEL_SIZE } from "./config.mjs";
import { World } from "./model/World.mjs";
import { decode, deserialize, encode, serialize } from "./model/Save.mjs";
import { load_compiled } from "./pack/Loader.mjs";
import { get_active, get_pack_bytes } from "./cache/PackCache.mjs";
import { IconRenderer } from "./render/Icons.mjs";
import { Resources } from "./render/Resources.mjs";
import { Scene } from "./render/Scene.mjs";
import { BlockPicker } from "./ui/BlockPicker.mjs";
import { PackPanel } from "./ui/PackPanel.mjs";
import { StateBar } from "./ui/StateBar.mjs";

const AUTOSAVE_KEY = "redstone-modeler.autosave";
const $ = id => document.getElementById(id);

const world = new World(MODEL_SIZE);
const scene = new Scene($("canvas3d"), world);
const icons = new IconRenderer(64);
const picker = new BlockPicker({
    list: $("block_list"),
    search: $("block_search"),
    states: $("block_states"),
    hotbar: $("hotbar"),
}, icons);

/** @type {Resources|null} */
let resources = null;

const state_bar = new StateBar({
    bar: $("state_bar"),
    toggle: $("state_toggle"),
    filters: $("state_filters"),
    grid: $("state_grid"),
    note: $("state_note"),
    dedupe: $("state_dedupe"),
}, picker, icons, () => resources);
picker.on_change = () => state_bar.refresh();

async function use_pack(bytes) {
    const { pack, atlas_image } = await load_compiled(bytes);
    const previous = resources;
    resources = new Resources(pack, atlas_image);
    scene.set_resources(resources);
    icons.set_resources(resources);
    picker.set_pack(pack);
    previous?.dispose();
    $("pack_summary").textContent = pack.name;
    $("onboarding").hidden = true;
}

const extra_properties = await fetch("data/block_properties.json").then(r => r.json()).catch(() => ({}));
const fallback = await fetch("data/fallback.json").then(r => r.json()).catch(() => undefined);
const pack_panel = new PackPanel({ dialog: $("pack_dialog"), on_use: use_pack, extra_properties, fallback });

// Flashes a message on a button for a second
const flashes = new Map();
function flash(button, message, error = false) {
    const old = flashes.get(button) ?? { text: button.textContent };
    clearTimeout(old.timeout);
    button.textContent = message;
    button.classList.toggle("error", error);
    flashes.set(button, {
        text: old.text,
        timeout: setTimeout(() => {
            button.textContent = old.text;
            button.classList.remove("error");
            flashes.delete(button);
        }, 1200),
    });
}

scene.on_click = (x, y, z, button, event) => {
    if (button === 2) {
        world.remove(x, y, z);
    }
    else if (event.altKey) {
        const block = world.get(x, y, z);
        if (block) {
            picker.select(block.name, block.props);
        }
    }
    else if (button === 0) {
        const selected = picker.selected;
        if (selected) {
            // In the 2D view clicking an occupied cell replaces the block
            world.set(x, y, z, selected);
        }
    }
};

// The plane controls only exist in the axis aligned 2D views
function update_plane_controls() {
    const { view, plane } = scene;
    $("plane_controls").hidden = view === null;
    if (view) {
        $("layer_number").textContent = `${"xyz"[view.axis]} = ${plane}`;
    }
}
scene.on_view_change = update_plane_controls;
$("layer_up").addEventListener("click", () => scene.move_plane(1));
$("layer_down").addEventListener("click", () => scene.move_plane(-1));

const NUMPAD_VIEWS = { Numpad7: "y", Numpad1: "z", Numpad3: "x" };
window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea") || e.metaKey) {
        return;
    }
    if (NUMPAD_VIEWS[e.code]) {
        scene.view_to(`${e.ctrlKey ? "-" : "+"}${NUMPAD_VIEWS[e.code]}`);
    }
    else if (e.code === "Numpad5") {
        scene.view_to("iso");
    }
    else if (e.ctrlKey) {
        return;
    }
    else if (/^Digit[1-9]$/.test(e.code)) {
        picker.set_slot(Number(e.code.slice(5)) - 1);
    }
    else if (e.key === "]") {
        scene.move_plane(1);
    }
    else if (e.key === "[") {
        scene.move_plane(-1);
    }
});

$("pack_button").addEventListener("click", () => pack_panel.open());
$("onboarding_button").addEventListener("click", () => pack_panel.open());

$("save_button").addEventListener("click", async () => {
    try {
        // eslint-disable-next-line no-undef
        const code = await encode(serialize(world, resources ? [resources.pack.name] : []), LZMA);
        await navigator.clipboard.writeText(code);
        flash($("save_button"), "Code copied");
    }
    catch (e) {
        flash($("save_button"), "Error", true);
        console.error(e);
    }
});

$("load_button").addEventListener("click", async () => {
    try {
        // eslint-disable-next-line no-undef
        const dropped = deserialize(await decode($("load_input").value, LZMA), world);
        flash($("load_button"), dropped ? `Loaded, ${dropped} outside` : "Loaded");
    }
    catch (e) {
        flash($("load_button"), "Invalid code", true);
        console.error(e);
    }
});

$("image_button").addEventListener("click", async () => {
    try {
        const blob = await scene.to_blob();
        try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            flash($("image_button"), "Copied");
        }
        catch {
            const url = URL.createObjectURL(blob);
            Object.assign(document.createElement("a"), { href: url, download: "model.png" }).click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            flash($("image_button"), "Downloaded");
        }
    }
    catch (e) {
        flash($("image_button"), "Error", true);
        console.error(e);
    }
});

// Keep the model between visits
function restore() {
    try {
        const saved = localStorage.getItem(AUTOSAVE_KEY);
        if (saved) {
            deserialize(JSON.parse(saved), world);
        }
    }
    catch (e) {
        console.warn("Could not restore the last model", e);
    }
}
restore();
let saved_version = world.version;
function autosave() {
    if (world.version !== saved_version) {
        saved_version = world.version;
        try {
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize(world, resources ? [resources.pack.name] : [])));
        }
        catch {
            // Storage full or blocked; the model just will not persist
        }
    }
}
setInterval(autosave, 1500);
window.addEventListener("pagehide", autosave);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        autosave();
    }
});

// Load the pack used last time
try {
    const id = await get_active();
    const bytes = id ? await get_pack_bytes(id) : null;
    if (bytes) {
        await use_pack(bytes);
    }
}
catch (e) {
    console.warn("Could not load the saved resource pack", e);
}

// Exposed for tests and debugging
window.__rm = { world, scene, picker, pack_panel, state_bar, get resources() {
    return resources;
} };
