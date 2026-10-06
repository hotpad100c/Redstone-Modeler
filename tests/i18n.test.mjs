import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { en } from "../js/i18n/en.mjs";
import { LANGUAGES, language, resolve_language, set_language, t, tn } from "../js/i18n/i18n.mjs";
import { property_label, state_label, value_label } from "../js/i18n/properties.mjs";
import { zh_cn } from "../js/i18n/zh_cn.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
// English has "one" and "other" forms; Chinese only needs "other"
const base_keys = dictionary => Object.keys(dictionary).filter(key => !key.endsWith(".one")).sort();

test("every dictionary has the keys of the English one, with the same placeholders", () => {
    assert.deepEqual(base_keys(zh_cn), base_keys(en));
    for (const key of Object.keys(zh_cn)) {
        assert.ok(key in en, `${key} is not in the English dictionary`);
        assert.deepEqual(placeholders(zh_cn[key]), placeholders(en[key] ?? en[key.replace(/\.other$/, ".one")]), key);
    }
    for (const [key, text] of Object.entries(en)) {
        assert.notEqual(text.trim(), "", key);
    }
});

function* sources(dir) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            yield * sources(path);
        }
        else if (name.endsWith(".mjs") && !path.includes("/i18n/")) {
            yield path;
        }
    }
}

test("every text the code asks for exists", () => {
    const missing = [];
    const check = (key, where) => {
        if (!(key in en)) {
            missing.push(`${where}: ${key}`);
        }
    };
    for (const file of sources(join(root, "js"))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/\bt\("([^"]+)"/g)) {
            check(match[1], file);
        }
        for (const match of text.matchAll(/\btn\("([^"]+)"/g)) {
            check(`${match[1]}.other`, file);
        }
        for (const match of text.matchAll(/\bprogress\("(compile\.[^"]+)"/g)) {
            check(match[1], file);
        }
    }
    const html = readFileSync(join(root, "index.html"), "utf8");
    for (const match of html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) {
        check(match[1], "index.html");
    }
    assert.deepEqual(missing, []);
});

test("the language follows the setting, else the browser", () => {
    assert.equal(resolve_language("zh-CN", ["en-US"]), "zh-CN");
    assert.equal(resolve_language("en", ["zh-CN"]), "en");
    assert.equal(resolve_language("auto", ["zh-TW", "en"]), "zh-CN");
    assert.equal(resolve_language("auto", ["de", "en-GB"]), "en");
    assert.equal(resolve_language("auto", ["fr"]), "en");
    assert.equal(resolve_language("auto", []), "en");
    assert.equal(resolve_language("klingon", ["zh"]), "zh-CN");
    assert.deepEqual(LANGUAGES.map(l => l.code), ["en", "zh-CN"]);
});

test("t fills placeholders and falls back to English and to the key", () => {
    set_language("en");
    assert.equal(language(), "en");
    assert.equal(t("top.save"), "Save");
    assert.equal(t("top.loaded_outside", { count: 3 }), "Loaded, 3 outside");
    assert.equal(t("top.loaded_outside"), "Loaded, {count} outside", "a missing value stays visible");
    assert.equal(t("no.such.key"), "no.such.key");
    set_language("zh-CN");
    assert.equal(t("top.save"), "保存");
    assert.equal(t("top.loaded_outside", { count: 3 }), "已加载，3 个在范围外");
    set_language("nonsense");
    assert.equal(language(), "en");
});

test("counted texts use the singular only where the language has one", () => {
    set_language("en");
    assert.match(tn("settings.size_warn", 1), /^1 block outside/);
    assert.match(tn("settings.size_warn", 5), /^5 blocks outside/);
    set_language("zh-CN");
    assert.match(tn("settings.size_warn", 1), /^新尺寸之外有 1 个方块/);
    assert.match(tn("settings.size_warn", 5), /^新尺寸之外有 5 个方块/);
    set_language("en");
});

test("block state names are translated for Chinese only, and the real keys stay visible", () => {
    assert.equal(property_label("facing", "en"), "facing");
    assert.equal(property_label("facing", "zh-CN"), "朝向");
    assert.equal(property_label("some_mod_property", "zh-CN"), "some_mod_property");
    assert.equal(value_label("north", "zh-CN"), "北");
    assert.equal(value_label("north_south", "zh-CN"), "北·南");
    assert.equal(value_label("ascending_east", "zh-CN"), "上坡·东");
    assert.equal(value_label("harp", "zh-CN"), "harp", "unknown values stay as they are");
    assert.equal(value_label("12", "zh-CN"), "12");
    assert.equal(value_label("north", "en"), "north");
    const state = { facing: "east", powered: "true" };
    assert.equal(state_label(state, "en"), "facing=east, powered=true");
    assert.equal(state_label(state, "zh-CN"), "朝向=东, 通电=是 (facing=east, powered=true)");
    assert.equal(state_label({}, "zh-CN"), "");
});
