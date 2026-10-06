import * as i18n from "./i18n/i18n.mjs";
import { World } from "./model/World.mjs";
import * as Settings from "./model/Settings.mjs";
import { decode, deserialize, encode, serialize } from "./model/Save.mjs";
import { load_compiled } from "./pack/Loader.mjs";
import { get_active, get_pack_bytes } from "./cache/PackCache.mjs";
import { IconRenderer } from "./render/Icons.mjs";
import { Resources } from "./render/Resources.mjs";
import { Scene } from "./render/Scene.mjs";
import { BlockPicker } from "./ui/BlockPicker.mjs";
import { PackPanel } from "./ui/PackPanel.mjs";
import { SettingsPanel } from "./ui/SettingsPanel.mjs";
import { StateBar } from "./ui/StateBar.mjs";

const AUTOSAVE_KEY = "redstone-modeler.autosave";
const $ = id => document.getElementById(id);

const { t } = i18n;

const settings = Settings.load();
i18n.set_language(i18n.resolve_language(settings.language));
const world = new World(settings.size);
const scene = new Scene($("canvas3d"), world);
const settings_panel = new SettingsPanel({ dialog: $("settings_dialog"), settings, world, scene });
$("settings_button").addEventListener("click", () => settings_panel.open());

// Phones: stop quick repeated taps and pinches from zooming the page. Pinching inside the
// canvas is still handled by the camera controls.
document.addEventListener("gesturestart", e => e.preventDefault());
$("canvas3d").addEventListener("touchend", (e) => {
    if (e.cancelable) {
        e.preventDefault();
    }
}, { passive: false });
const icons = new IconRenderer(64);
const picker = new BlockPicker({
    list: $("block_list"),
    search: $("block_search"),
    namespace: $("block_namespace"),
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

settings_panel.on_language_change = () => picker.set_name_language(settings_panel.effective_language());
settings_panel.on_ui_language_change = () => {
    picker.refresh_language();
    state_bar.refresh_language();
    pack_panel.rerender();
    settings_panel.refresh_language();
    update_summary();
    show_build();
    show_pack_problem(problem);
};

// What the top bar says about the pack. Elements with data-i18n are translated by the page, so the
// attribute is only there while the text is a translatable one.
function update_summary() {
    const summary = $("pack_summary");
    if (resources) {
        summary.removeAttribute("data-i18n");
        summary.textContent = resources.pack.name;
    }
    else {
        summary.dataset.i18n = "top.no_pack";
        summary.textContent = t("top.no_pack");
    }
}

// The name of the held block above the hotbar, shown for a moment when a block is picked
const held_name = $("held_name");
let held_timer = null;
picker.on_select = (block) => {
    const title = document.createElement("div");
    title.className = "held_title";
    title.textContent = picker.label_of(block.name);
    held_name.replaceChildren(title);
    if (!block.name.startsWith("minecraft:")) {
        const id = document.createElement("div");
        id.className = "held_id";
        id.textContent = block.name;
        held_name.appendChild(id);
    }
    held_name.classList.add("show");
    clearTimeout(held_timer);
    held_timer = setTimeout(() => held_name.classList.remove("show"), 1400);
};

async function use_pack(bytes) {
    const { pack, atlas_image } = await load_compiled(bytes);
    const previous = resources;
    resources = new Resources(pack, atlas_image);
    scene.set_resources(resources);
    icons.set_resources(resources);
    settings_panel.set_pack(pack);
    picker.name_language = settings_panel.effective_language();
    picker.set_pack(pack);
    previous?.dispose();
    update_summary();
    problem = null;
    $("onboarding_note").hidden = true;
    $("onboarding").hidden = true;
}

const pack_panel = new PackPanel({ dialog: $("pack_dialog"), on_use: use_pack, extra_properties: {}, fallback: undefined });
// Data files used when compiling are fetched in the background, so a slow request cannot block the interface
pack_panel.ready = Promise.all([
    fetch("data/block_properties.json").then(r => r.json()).catch(() => ({})),
    fetch("data/fallback.json").then(r => r.json()).catch(() => undefined),
]).then(([extra_properties, fallback]) => {
    pack_panel.extra_properties = extra_properties;
    pack_panel.fallback = fallback;
});

/** Why the saved pack could not be loaded, shown in the introduction */
let problem = null;
function show_pack_problem(reason) {
    problem = reason;
    update_summary();
    const note = $("onboarding_note");
    note.hidden = reason === null;
    note.textContent = reason === null ? "" : t("onboarding.load_failed", { reason });
}
const build = document.querySelector("meta[name=build]")?.content;
function show_build() {
    $("build_id").textContent = build ? t("top.build", { id: build }) : "";
}
show_build();

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

function set_eraser(on) {
    scene.erase = on;
    $("erase_button").classList.toggle("selected", on);
}
$("erase_button").addEventListener("click", () => set_eraser(!scene.erase));
$("block_list").addEventListener("click", () => set_eraser(false));

// Clearing needs a second click so a stray click cannot wipe the model
let clear_timer = null;
$("clear_button").addEventListener("click", () => {
    const button = $("clear_button");
    if (clear_timer === null) {
        button.textContent = t("top.clear_confirm");
        button.classList.add("error");
        clear_timer = setTimeout(reset_clear_button, 3000);
    }
    else {
        world.clear();
        reset_clear_button();
    }
});
function reset_clear_button() {
    clearTimeout(clear_timer);
    clear_timer = null;
    $("clear_button").textContent = t("top.clear");
    $("clear_button").classList.remove("error");
}

scene.on_click = (x, y, z, button, event) => {
    if (button === 2 || (scene.erase && button === 0 && !event.altKey)) {
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
        set_eraser(false);
        picker.set_slot(Number(e.code.slice(5)) - 1);
    }
    else if (e.code === "KeyE") {
        set_eraser(!scene.erase);
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
        flash($("save_button"), t("top.code_copied"));
    }
    catch (e) {
        flash($("save_button"), t("top.error"), true);
        console.error(e);
    }
});

$("load_button").addEventListener("click", async () => {
    try {
        // eslint-disable-next-line no-undef
        const dropped = deserialize(await decode($("load_input").value, LZMA), world);
        scene.apply_world_size();
        settings_panel.sync_size();
        flash($("load_button"), dropped ? t("top.loaded_outside", { count: dropped }) : t("top.loaded"));
    }
    catch (e) {
        flash($("load_button"), t("top.invalid_code"), true);
        console.error(e);
    }
});

$("image_button").addEventListener("click", async () => {
    try {
        const blob = await scene.to_blob();
        try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            flash($("image_button"), t("top.copied"));
        }
        catch {
            const url = URL.createObjectURL(blob);
            Object.assign(document.createElement("a"), { href: url, download: "model.png" }).click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            flash($("image_button"), t("top.downloaded"));
        }
    }
    catch (e) {
        flash($("image_button"), t("top.error"), true);
        console.error(e);
    }
});

// Keep the model between visits
function restore() {
    try {
        const saved = localStorage.getItem(AUTOSAVE_KEY);
        if (saved) {
            deserialize(JSON.parse(saved), world);
            scene.apply_world_size();
            settings_panel.sync_size();
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

// Exposed for tests and debugging. Set before the saved pack loads: the interface is usable from here on.
window.__rm = { world, scene, picker, pack_panel, state_bar, get resources() {
    return resources;
} };

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
    show_pack_problem(String(e?.message ?? e));
}
