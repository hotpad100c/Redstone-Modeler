const SLOT_COUNT = 9;

/**
 * Block list with search, property editor and hotbar.
 * The held block is the active hotbar slot; picking a block from the list fills that slot.
 */
export class BlockPicker {
    /**
     * @param {object} elements
     * @param {HTMLElement} elements.list
     * @param {HTMLInputElement} elements.search
     * @param {HTMLElement} elements.states
     * @param {HTMLElement} elements.hotbar
     * @param {import("../render/Icons.mjs").IconRenderer} icons
     */
    constructor({ list, search, states, hotbar }, icons) {
        this.list = list;
        this.search = search;
        this.states = states;
        this.hotbar = hotbar;
        this.icons = icons;
        /** @type {import("../pack/CompiledPack.mjs").CompiledPack|null} */
        this.pack = null;
        /** @type {({name: string, props: Record<string, string>}|null)[]} */
        this.slots = Array.from({ length: SLOT_COUNT }, () => null);
        this.slot = 0;
        this.items = new Map();
        this.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    this._load_icon(entry.target);
                    this.observer.unobserve(entry.target);
                }
            }
        }, { root: list });
        search.addEventListener("input", () => this._filter());
        this._render_hotbar();
    }

    /** The block that would be placed, or null */
    get selected() {
        const block = this.slots[this.slot];
        return block ? { name: block.name, props: { ...block.props } } : null;
    }

    static short_name(name) {
        return name.replace(/^minecraft:/, "");
    }

    /** @param {import("../pack/CompiledPack.mjs").CompiledPack|null} pack */
    set_pack(pack) {
        this.pack = pack;
        this.observer.disconnect();
        this.list.replaceChildren();
        this.items.clear();
        this.slots = this.slots.map(slot => slot && pack?.names.includes(slot.name) ? slot : null);
        if (pack) {
            for (const name of pack.names) {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "block_item";
                item.dataset.name = name;
                item.title = name;
                const img = document.createElement("img");
                img.alt = "";
                img.width = 32;
                img.height = 32;
                const label = document.createElement("span");
                label.textContent = BlockPicker.short_name(name);
                item.append(img, label);
                item.addEventListener("click", () => this.select(name));
                this.list.appendChild(item);
                this.items.set(name, item);
                this.observer.observe(item);
            }
            if (!this.slots[this.slot]) {
                const first = pack.names.includes("minecraft:stone") ? "minecraft:stone" : pack.names[0];
                if (first) {
                    this.select(first);
                }
            }
        }
        this._filter();
        this._render_states();
        this._render_hotbar();
    }

    /**
     * Puts a block into the active slot.
     * @param {string} name
     * @param {Record<string, string>} [props] Missing properties get their default
     */
    select(name, props = {}) {
        if (!this.pack?.names.includes(name)) {
            return;
        }
        this.slots[this.slot] = { name, props: { ...this.pack.default_state(name), ...props } };
        this._render_states();
        this._render_hotbar();
    }

    /** @param {number} index */
    set_slot(index) {
        this.slot = Math.max(0, Math.min(SLOT_COUNT - 1, index));
        this._render_states();
        this._render_hotbar();
    }

    _filter() {
        const query = this.search.value.trim().toLowerCase().replace(/\s+/g, "_");
        for (const [name, item] of this.items) {
            item.hidden = query !== "" && !name.includes(query);
        }
    }

    _load_icon(item) {
        const img = item.querySelector("img");
        if (!img.src && this.pack) {
            img.src = this.icons.icon(item.dataset.name, {});
        }
    }

    _render_states() {
        this.states.replaceChildren();
        for (const [name, item] of this.items) {
            item.classList.toggle("selected", name === this.slots[this.slot]?.name);
        }
        const block = this.slots[this.slot];
        if (!block || !this.pack) {
            return;
        }
        const title = document.createElement("div");
        title.className = "states_title";
        title.textContent = BlockPicker.short_name(block.name);
        this.states.appendChild(title);
        const properties = Object.entries(this.pack.properties(block.name));
        if (properties.length === 0) {
            const none = document.createElement("div");
            none.className = "note";
            none.textContent = "No block states";
            this.states.appendChild(none);
        }
        for (const [prop, values] of properties) {
            const row = document.createElement("label");
            row.className = "state_row";
            const text = document.createElement("span");
            text.textContent = prop;
            const select = document.createElement("select");
            select.dataset.property = prop;
            for (const value of values) {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = value;
                select.appendChild(option);
            }
            select.value = block.props[prop] ?? values[0];
            select.addEventListener("change", () => {
                block.props[prop] = select.value;
                this._render_hotbar();
            });
            row.append(text, select);
            this.states.appendChild(row);
        }
    }

    _render_hotbar() {
        this.hotbar.replaceChildren();
        this.slots.forEach((block, index) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "slot";
            button.classList.toggle("selected", index === this.slot);
            button.title = block ? BlockPicker.short_name(block.name) : "Empty";
            const number = document.createElement("span");
            number.textContent = String(index + 1);
            button.appendChild(number);
            if (block && this.pack) {
                const img = document.createElement("img");
                img.alt = block.name;
                img.src = this.icons.icon(block.name, block.props);
                button.appendChild(img);
            }
            button.addEventListener("click", () => this.set_slot(index));
            this.hotbar.appendChild(button);
        });
    }
}
