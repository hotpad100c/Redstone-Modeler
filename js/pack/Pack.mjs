import { strFromU8, unzipSync } from "../../lib/fflate.module.js";

const WANTED = /\.(json|png|mcmeta)$/i;

/**
 * Lenient JSON parser. Minecraft reads JSON leniently, so packs in the wild
 * contain comments, trailing commas and byte order marks.
 * @param {string} text
 */
export function parse_json(text) {
    text = text.replace(/^\u{FEFF}/u, "");
    try {
        return JSON.parse(text);
    }
    catch {
        let out = "";
        let in_string = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (in_string) {
                out += c;
                if (c === "\\") {
                    out += text[++i] ?? "";
                }
                else if (c === "\"") {
                    in_string = false;
                }
            }
            else if (c === "\"") {
                in_string = true;
                out += c;
            }
            else if (c === "/" && text[i + 1] === "/") {
                while (i < text.length && text[i] !== "\n") {
                    i++;
                }
            }
            else if (c === "/" && text[i + 1] === "*") {
                i = text.indexOf("*/", i + 2);
                i = i < 0 ? text.length : i + 1;
            }
            else {
                out += c;
            }
        }
        return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
    }
}

/**
 * Finds the folder prefix in front of `assets/` (zips often wrap everything in one folder).
 * @param {string[]} paths
 */
function find_root(paths) {
    for (const path of paths) {
        const match = /^(?:[^/]+\/)?assets\//.exec(path);
        if (match) {
            return match[0].slice(0, -"assets/".length);
        }
    }
    return "";
}

/**
 * A single resource pack held in memory. Paths look like `assets/minecraft/models/block/stone.json`.
 */
export class Pack {
    /**
     * @param {string} name
     * @param {Map<string, Uint8Array>} files
     */
    constructor(name, files) {
        this.name = name;
        this.files = files;
        this.json_cache = new Map();
    }

    /**
     * @param {string} name
     * @param {Uint8Array} bytes
     */
    static from_zip(name, bytes) {
        const raw = unzipSync(bytes, {
            filter: file => WANTED.test(file.name) && !file.name.endsWith("/"),
        });
        const root = find_root(Object.keys(raw));
        const files = new Map();
        for (const [path, data] of Object.entries(raw)) {
            if (path.startsWith(root)) {
                files.set(path.slice(root.length), data);
            }
        }
        return new Pack(name, files);
    }

    /**
     * Reads a folder picked with `<input webkitdirectory>`.
     * @param {string} name
     * @param {File[]} file_list
     */
    static async from_files(name, file_list) {
        const entries = file_list
            .map(file => ({ file, path: (file.webkitRelativePath || file.name).split("/").slice(1).join("/") }))
            .filter(({ path }) => WANTED.test(path));
        const root = find_root(entries.map(e => e.path));
        const files = new Map();
        for (const { file, path } of entries) {
            if (path.startsWith(root)) {
                files.set(path.slice(root.length), new Uint8Array(await file.arrayBuffer()));
            }
        }
        return new Pack(name, files);
    }

    has(path) {
        return this.files.has(path);
    }

    get(path) {
        return this.files.get(path);
    }

    paths() {
        return this.files.keys();
    }

    json(path) {
        if (!this.json_cache.has(path)) {
            const data = this.files.get(path);
            let value;
            if (data) {
                try {
                    value = parse_json(strFromU8(data));
                }
                catch {
                    console.warn(`Invalid JSON in ${this.name}: ${path}`);
                }
            }
            this.json_cache.set(path, value);
        }
        return this.json_cache.get(path);
    }
}
