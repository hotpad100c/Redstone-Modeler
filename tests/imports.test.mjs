import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["three.module.min.js", "lzma"]);

function* sources(dir) {
    for (const name of readdirSync(dir)) {
        if (SKIP.has(name)) {
            continue;
        }
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            yield * sources(path);
        }
        else if (/\.m?js$/.test(name)) {
            yield path;
        }
    }
}

// The pages are served without an import map, so a bare import such as `from "three"` fails
// in the browser while it works in Node. Every import of the site has to be a path.
test("no module of the site imports a bare package name", () => {
    const bare = [];
    for (const dir of ["js", "lib"]) {
        for (const file of sources(join(root, dir))) {
            const text = readFileSync(file, "utf8");
            for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
                if (!/^(\.|\/|https?:)/.test(match[1])) {
                    bare.push(`${relative(root, file)}: ${match[1]}`);
                }
            }
        }
    }
    assert.deepEqual(bare, []);
});
