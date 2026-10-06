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
            world.set(x, y, z, selected);
        }
    }
};

function change_layer(delta) {
    scene.set_layer(scene.layer + delta);
    $("layer_number").textContent = `y = ${scene.layer}`;
}
$("layer_up").addEventListener("click", () => change_layer(1));
$("layer_down").addEventListener("click", () => change_layer(-1));
$("layer_number").textContent = `y = ${scene.layer}`;

window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea") || e.ctrlKey || e.metaKey) {
        return;
    }
    if (/^[1-9]$/.test(e.key)) {
        picker.set_slot(Number(e.key) - 1);
    }
    else if (e.key === "]") {
        change_layer(1);
    }
    else if (e.key === "[") {
        change_layer(-1);
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
window.__rm = { world, scene, picker, pack_panel, get resources() {
    return resources;
} };
