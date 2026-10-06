import { DEFAULTS, SIZE_LIMITS, normalize, save } from "../model/Settings.mjs";

/**
 * Dialog for the size of the model space, the background colour and the colour of the 2D plane.
 * Colours apply immediately; a size that would delete blocks needs a second click.
 */
export class SettingsPanel {
    /**
     * @param {object} options
     * @param {HTMLDialogElement} options.dialog
     * @param {ReturnType<typeof normalize>} options.settings Loaded settings, updated in place and stored
     * @param {import("../model/World.mjs").World} options.world
     * @param {import("../render/Scene.mjs").Scene} options.scene
     */
    constructor({ dialog, settings, world, scene }) {
        this.dialog = dialog;
        this.settings = settings;
        this.world = world;
        this.scene = scene;
        this.pending = null;
        const $ = id => dialog.querySelector(`#${id}`);
        this.size_inputs = { x: $("size_x"), y: $("size_y"), z: $("size_z") };
        this.note = $("size_note");
        this.apply_button = $("size_apply");
        this.background = $("bg_color");
        this.plane_color = $("plane_color");
        this.plane_opacity = $("plane_opacity");
        this.opacity_label = $("plane_opacity_value");

        for (const input of Object.values(this.size_inputs)) {
            input.min = SIZE_LIMITS.min;
            input.max = SIZE_LIMITS.max;
            input.addEventListener("input", () => {
                this.pending = null;
                this.note.textContent = "";
            });
        }
        this.apply_button.addEventListener("click", () => this.apply_size());
        this.background.addEventListener("input", () => this._set_colors());
        this.plane_color.addEventListener("input", () => this._set_colors());
        this.plane_opacity.addEventListener("input", () => this._set_colors());
        $("settings_reset").addEventListener("click", () => this.reset());
        $("settings_close").addEventListener("click", () => dialog.close());
        this.show();
        this._apply_colors();
    }

    open() {
        this.show();
        this.dialog.showModal();
    }

    /** Fills the form from the stored settings. */
    show() {
        for (const [axis, input] of Object.entries(this.size_inputs)) {
            input.value = this.settings.size[axis];
        }
        this.background.value = this.settings.background;
        this.plane_color.value = this.settings.plane_color;
        this.plane_opacity.value = this.settings.plane_opacity;
        this.opacity_label.textContent = `${Math.round(this.settings.plane_opacity * 100)}%`;
        this.pending = null;
    }

    /** Call after the world was resized by something else, such as loading a save. */
    sync_size() {
        this.settings.size = { ...this.world.size };
        save(this.settings);
        this.show();
    }

    apply_size() {
        const wanted = normalize({ size: Object.fromEntries(Object.entries(this.size_inputs).map(([a, i]) => [a, i.value])) }).size;
        for (const [axis, input] of Object.entries(this.size_inputs)) {
            input.value = wanted[axis];
        }
        const outside = this.world.count_outside(wanted);
        const key = JSON.stringify(wanted);
        if (outside > 0 && this.pending !== key) {
            this.pending = key;
            this.note.textContent = `${outside} block${outside === 1 ? "" : "s"} outside the new size will be removed. Click Apply again to confirm.`;
            return;
        }
        this.pending = null;
        this.scene.set_size(wanted);
        this.settings.size = wanted;
        save(this.settings);
        const cells = wanted.x * wanted.y * wanted.z;
        this.note.textContent = cells > 100000 ? "Applied. Very large spaces can be slow." : "Applied.";
    }

    reset() {
        const size = { ...DEFAULTS.size };
        const outside = this.world.count_outside(size);
        Object.assign(this.settings, normalize({ ...DEFAULTS, size }));
        this.show();
        this._apply_colors();
        if (outside === 0) {
            this.scene.set_size(size);
            this.note.textContent = "Defaults restored.";
        }
        else {
            // Keep the model: only the colours are reset, the size needs an explicit Apply
            this.settings.size = { ...this.world.size };
            this.show();
            this.note.textContent = `Colours reset. The default size would remove ${outside} block${outside === 1 ? "" : "s"}; set it and press Apply to confirm.`;
        }
        save(this.settings);
    }

    _set_colors() {
        this.settings.background = this.background.value;
        this.settings.plane_color = this.plane_color.value;
        this.settings.plane_opacity = Number(this.plane_opacity.value);
        this.opacity_label.textContent = `${Math.round(this.settings.plane_opacity * 100)}%`;
        this._apply_colors();
        save(this.settings);
    }

    _apply_colors() {
        this.scene.set_background(this.settings.background);
        this.scene.set_plane_style(this.settings.plane_color, this.settings.plane_opacity);
    }
}
