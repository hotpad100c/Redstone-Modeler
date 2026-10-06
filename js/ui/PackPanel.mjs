import { fingerprint, delete_pack, get_active, get_pack_bytes, list_packs, put_pack, request_persistence, set_active } from "../cache/PackCache.mjs";
import { Pack } from "../pack/Pack.mjs";
import { compile } from "../pack/Loader.mjs";

function download(bytes, file_name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: file_name });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function format_size(bytes) {
    return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Dialog for importing, stacking and compiling resource packs, and managing the saved ones.
 */
export class PackPanel {
    /**
     * @param {object} options
     * @param {HTMLDialogElement} options.dialog
     * @param {(bytes: Uint8Array, id: string) => Promise<void>} options.on_use Called with compiled bytes to activate
     * @param {Record<string, Record<string, string[]>>} options.extra_properties
     * @param {{blockstates: object, models: object}} [options.fallback]
     */
    constructor({ dialog, on_use, extra_properties, fallback }) {
        this.dialog = dialog;
        this.on_use = on_use;
        this.extra_properties = extra_properties;
        this.fallback = fallback;
        /** Resolves when the data files for compiling are loaded */
        this.ready = Promise.resolve();
        /** @type {{name: string, size: number, lastModified: number, pack: Pack}[]} Highest priority first */
        this.sources = [];
        this.active = null;
        const $ = id => dialog.querySelector(`#${id}`);
        this.source_list = $("source_list");
        this.library_list = $("library_list");
        this.name_input = $("pack_name");
        this.status = $("compile_status");
        this.compile_button = $("compile_button");
        this.storage_note = $("storage_note");

        // iOS cannot pick folders; without this the button would do nothing
        const folder_input = $("pack_folder");
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        if (ios || !("webkitdirectory" in folder_input)) {
            folder_input.closest("label").hidden = true;
        }
        $("pack_file").addEventListener("change", (e) => {
            this.add_files([...e.target.files]);
            e.target.value = "";
        });
        $("pack_folder").addEventListener("change", (e) => {
            this.add_folder([...e.target.files]);
            e.target.value = "";
        });
        $("pack_close").addEventListener("click", () => dialog.close());
        this.compile_button.addEventListener("click", () => this.compile());
        dialog.addEventListener("dragover", e => e.preventDefault());
        dialog.addEventListener("drop", (e) => {
            e.preventDefault();
            this.add_files([...e.dataTransfer.files]);
        });
        this._render_sources();
    }

    async open() {
        this.dialog.showModal();
        await this.refresh_library();
    }

    set_status(message, error = false) {
        this.status.textContent = message;
        this.status.classList.toggle("error", error);
    }

    /** @param {File[]} files */
    async add_files(files) {
        for (const file of files) {
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                if (file.name.toLowerCase().endsWith(".rmpack")) {
                    await this._store_and_use(bytes, [{ name: file.name, size: file.size, lastModified: file.lastModified }], file.name.replace(/\.rmpack$/i, ""));
                    continue;
                }
                const name = file.name.replace(/\.zip$/i, "");
                this.sources.push({ name, size: file.size, lastModified: file.lastModified, pack: Pack.from_zip(name, bytes) });
                if (!this.name_input.value) {
                    this.name_input.value = name;
                }
            }
            catch (e) {
                console.error(e);
                this.set_status(`Could not read ${file.name}: ${e.message}`, true);
            }
        }
        this._render_sources();
    }

    /** @param {File[]} files */
    async add_folder(files) {
        if (files.length === 0) {
            return;
        }
        const name = files[0].webkitRelativePath.split("/")[0];
        try {
            const pack = await Pack.from_files(name, files);
            this.sources.push({ name, size: files.reduce((sum, f) => sum + f.size, 0), lastModified: 0, pack });
            if (!this.name_input.value) {
                this.name_input.value = name;
            }
        }
        catch (e) {
            this.set_status(`Could not read folder ${name}: ${e.message}`, true);
        }
        this._render_sources();
    }

    async compile() {
        if (this.sources.length === 0) {
            this.set_status("Add at least one resource pack first.", true);
            return;
        }
        const name = this.name_input.value.trim() || this.sources.map(s => s.name).join(" + ");
        this.compile_button.disabled = true;
        try {
            await this.ready;
            const bytes = await compile(this.sources.map(s => s.pack), {
                name,
                extra_properties: this.extra_properties,
                fallback: this.fallback,
                progress: message => this.set_status(message),
            });
            await this._store_and_use(bytes, this.sources, name);
            this.set_status(`Done: ${name} (${format_size(bytes.length)})`);
        }
        catch (e) {
            console.error(e);
            this.set_status(`Compile failed: ${e.message}`, true);
        }
        finally {
            this.compile_button.disabled = false;
        }
    }

    async _store_and_use(bytes, sources, name) {
        const id = await fingerprint(sources);
        await put_pack({ id, name, created: Date.now(), size: bytes.length, sources: sources.map(s => s.name) }, bytes);
        await set_active(id);
        await this.on_use(bytes, id);
        this.active = id;
        const persisted = await request_persistence();
        this.storage_note.textContent = persisted
            ? "Browser storage is persistent."
            : "The browser may clear stored packs when disk space is low. Export .rmpack files as a backup.";
        await this.refresh_library();
    }

    async refresh_library() {
        this.active = await get_active();
        let packs = [];
        try {
            packs = await list_packs();
        }
        catch (e) {
            this.storage_note.textContent = `Browser storage unavailable: ${e.message}`;
        }
        this.library_list.replaceChildren();
        if (packs.length === 0) {
            const empty = document.createElement("li");
            empty.className = "note";
            empty.textContent = "Nothing saved yet.";
            this.library_list.appendChild(empty);
        }
        for (const info of packs) {
            const item = document.createElement("li");
            item.classList.toggle("active", info.id === this.active);
            const label = document.createElement("span");
            label.className = "pack_label";
            label.textContent = `${info.name} · ${format_size(info.size)} · ${info.sources.join(" + ")}`;
            const use = this._button("Use", async () => {
                const bytes = await get_pack_bytes(info.id);
                await set_active(info.id);
                await this.on_use(bytes, info.id);
                await this.refresh_library();
            });
            const save = this._button("Export", async () => download(await get_pack_bytes(info.id), `${info.name}.rmpack`));
            const remove = this._button("Delete", async () => {
                await delete_pack(info.id);
                await this.refresh_library();
            });
            item.append(label, use, save, remove);
            this.library_list.appendChild(item);
        }
    }

    _button(text, handler) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.addEventListener("click", async () => {
            try {
                await handler();
            }
            catch (e) {
                console.error(e);
                this.set_status(e.message, true);
            }
        });
        return button;
    }

    _render_sources() {
        this.source_list.replaceChildren();
        if (this.sources.length === 0) {
            const empty = document.createElement("li");
            empty.className = "note";
            empty.textContent = "No packs added. Drop .zip files here.";
            this.source_list.appendChild(empty);
        }
        this.sources.forEach((source, index) => {
            const item = document.createElement("li");
            const label = document.createElement("span");
            label.className = "pack_label";
            label.textContent = `${source.name} · ${format_size(source.size)}`;
            const move = (delta) => {
                const [moved] = this.sources.splice(index, 1);
                this.sources.splice(index + delta, 0, moved);
                this._render_sources();
            };
            const up = this._button("↑", () => move(-1));
            up.disabled = index === 0;
            const down = this._button("↓", () => move(1));
            down.disabled = index === this.sources.length - 1;
            const remove = this._button("✕", () => {
                this.sources.splice(index, 1);
                this._render_sources();
            });
            item.append(label, up, down, remove);
            this.source_list.appendChild(item);
        });
    }
}
