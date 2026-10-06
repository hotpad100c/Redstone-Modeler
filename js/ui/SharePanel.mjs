import { t } from "../i18n/i18n.mjs";
import { CHAT_LIMIT, decode_code, export_model } from "../share/Share.mjs";

/** Codes longer than this are not put into the text box, which gets slow with millions of characters. */
const SHOW_LIMIT = 100_000;

function format_size(bytes) {
    return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Dialog that packs the model with the resources it uses, as a code to copy or a file, and opens what others sent.
 */
export class SharePanel {
    /**
     * @param {object} options
     * @param {HTMLDialogElement} options.dialog
     * @param {import("../model/World.mjs").World} options.world
     * @param {() => import("../render/Resources.mjs").Resources|null} options.get_resources
     * @param {() => string} options.get_language Language code of the block names that are in use, "" for English only
     * @param {(bytes: Uint8Array) => Promise<string>} options.on_open Opens a shared model, gives the name of its pack
     */
    constructor({ dialog, world, get_resources, get_language, on_open }) {
        this.dialog = dialog;
        this.world = world;
        this.get_resources = get_resources;
        this.get_language = get_language;
        this.on_open = on_open;
        /** @type {import("../share/Share.mjs").Exported|null} */
        this.result = null;
        this.run = 0;
        const $ = id => dialog.querySelector(`#${id}`);
        this.scope = $("share_scope");
        this.languages_row = $("share_languages_row");
        this.all_languages = $("share_all_languages");
        this.stats = $("share_stats");
        this.parts = $("share_parts");
        this.warning = $("share_warning");
        this.code = $("share_code");
        this.copy_button = $("share_copy");
        this.download_button = $("share_download");
        this.status = $("share_status");
        this.paste = $("share_paste");
        this.open_status = $("share_open_status");

        this.scope.addEventListener("change", () => this.refresh());
        this.all_languages.addEventListener("change", () => this.refresh());
        this.copy_button.addEventListener("click", () => this.copy());
        this.download_button.addEventListener("click", () => this.download());
        $("share_close").addEventListener("click", () => dialog.close());
        $("share_open_button").addEventListener("click", () => this.open_code());
        $("share_file").addEventListener("change", (event) => {
            const [file] = event.target.files;
            event.target.value = "";
            if (file) {
                this.open_file(file);
            }
        });
    }

    async open() {
        this.dialog.showModal();
        this.status.textContent = "";
        this.open_status.textContent = "";
        await this.refresh();
    }

    _reset(message = "") {
        this.result = null;
        this.stats.textContent = message;
        this.parts.textContent = "";
        this.warning.textContent = "";
        this.code.value = "";
        this.copy_button.disabled = true;
        this.download_button.disabled = true;
    }

    /** Packs the model again; the result is kept so that Copy can run in the click, which some browsers need. */
    async refresh() {
        const run = ++this.run;
        this.languages_row.hidden = this.scope.value !== "pack";
        const resources = this.get_resources();
        if (!resources) {
            this._reset(t("share.need_pack"));
            return;
        }
        if (this.world.blocks.size === 0) {
            this._reset(t("share.empty"));
            return;
        }
        this._reset(t("share.working"));
        let result;
        try {
            result = await export_model(resources, this.world, {
                scope: this.scope.value,
                language: this.get_language(),
                all_languages: this.all_languages.checked,
            });
        }
        catch (error) {
            console.error(error);
            this.stats.textContent = error.message;
            return;
        }
        if (run !== this.run) {
            return;
        }
        this.result = result;
        const { stats } = result;
        this.stats.textContent = t("share.stats", {
            blocks: stats.blocks,
            models: stats.models,
            textures: stats.textures,
            size: format_size(stats.bytes),
            chars: stats.code_length.toLocaleString(),
        });
        this.parts.textContent = t("share.parts", {
            models: format_size(stats.parts.models),
            pictures: format_size(stats.parts.pictures),
            names: format_size(stats.parts.names),
            model: format_size(stats.parts.model),
        });
        this.warning.textContent = stats.code_length > CHAT_LIMIT ? t("share.too_long", { limit: CHAT_LIMIT }) : "";
        if (stats.code_length <= SHOW_LIMIT) {
            this.code.value = result.code;
        }
        else {
            this.code.value = t("share.code_hidden");
        }
        this.copy_button.disabled = false;
        this.download_button.disabled = false;
    }

    async copy() {
        if (!this.result) {
            return;
        }
        try {
            await navigator.clipboard.writeText(this.result.code);
            this.status.textContent = t("share.copied");
        }
        catch {
            this.status.textContent = t("share.copy_failed");
            this.code.select();
        }
    }

    download() {
        if (!this.result) {
            return;
        }
        const url = URL.createObjectURL(new Blob([this.result.bytes], { type: "application/zip" }));
        Object.assign(document.createElement("a"), { href: url, download: "model.rmmodel" }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async _open(read) {
        this.open_status.classList.remove("error");
        try {
            const name = await this.on_open(await read());
            this.open_status.textContent = t("share.opened", { name });
        }
        catch (error) {
            console.error(error);
            this.open_status.classList.add("error");
            this.open_status.textContent = t("share.open_failed", { reason: error.message });
        }
        await this.refresh();
    }

    open_code() {
        return this._open(() => decode_code(this.paste.value));
    }

    /** @param {File} file */
    open_file(file) {
        return this._open(async () => new Uint8Array(await file.arrayBuffer()));
    }
}
