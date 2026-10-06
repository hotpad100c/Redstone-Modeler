/**
 * Tiny synthetic resource packs for tests. They contain no Minecraft assets.
 */
import { deflateSync } from "node:zlib";
import { strToU8, zipSync } from "../lib/fflate.module.js";
import { collect } from "../js/pack/Compiler.mjs";
import { CompiledPack } from "../js/pack/CompiledPack.mjs";
import { Pack } from "../js/pack/Pack.mjs";
import { PackStack } from "../js/pack/PackStack.mjs";

function crc32(buf) {
    let c;
    let crc = 0xFFFFFFFF;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xFF;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

/**
 * Solid colour PNG.
 * @param {number} w
 * @param {number} h
 * @param {number[]} rgba
 */
export function png(w, h, [r, g, b, a = 255]) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4);
        }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header.set([8, 6, 0, 0, 0], 8);
    return new Uint8Array(Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]));
}

const CUBE = {
    elements: [{
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
            down: { texture: "#down", cullface: "down" },
            up: { texture: "#up", cullface: "up" },
            north: { texture: "#north", cullface: "north" },
            south: { texture: "#south", cullface: "south" },
            west: { texture: "#west", cullface: "west" },
            east: { texture: "#east", cullface: "east" },
        },
    }],
};

const ALL = ["down", "up", "north", "south", "west", "east"];

function observer_variants(model, powered) {
    const rot = { north: {}, east: { y: 90 }, south: { y: 180 }, west: { y: 270 }, up: { x: 270 }, down: { x: 90 } };
    return Object.fromEntries(Object.entries(rot).map(([facing, r]) => [
        powered === undefined ? `facing=${facing}` : `facing=${facing},powered=${powered}`,
        { model, ...r },
    ]));
}

/** @param {Record<string, unknown>} tree path to JSON value or bytes */
export function make_pack(name, tree) {
    const files = new Map();
    for (const [path, value] of Object.entries(tree)) {
        files.set(path, value instanceof Uint8Array ? value : strToU8(JSON.stringify(value)));
    }
    return new Pack(name, files);
}

export function base_files() {
    const ns = "assets/minecraft";
    return {
        [`${ns}/blockstates/stone.json`]: { variants: { "": { model: "minecraft:block/stone" } } },
        [`${ns}/blockstates/observer.json`]: { variants: observer_variants("minecraft:block/observer") },
        [`${ns}/blockstates/redstone_lamp.json`]: {
            variants: {
                "lit=false": { model: "minecraft:block/lamp" },
                "lit=true": { model: "minecraft:block/lamp_on" },
            },
        },
        [`${ns}/blockstates/oak_slab.json`]: {
            variants: {
                "type=bottom": { model: "minecraft:block/slab" },
                "type=top": { model: "minecraft:block/slab", x: 180 },
                "type=double": { model: "minecraft:block/stone" },
            },
        },
        [`${ns}/blockstates/oak_fence.json`]: {
            multipart: [
                { apply: { model: "minecraft:block/post" } },
                { when: { north: "true" }, apply: { model: "minecraft:block/side", uvlock: true } },
                { when: { OR: [{ east: "true" }, { west: "true" }] }, apply: { model: "minecraft:block/side", y: 90 } },
            ],
        },
        [`${ns}/blockstates/lever.json`]: {
            variants: {
                "powered=false": { model: "minecraft:block/stone" },
                "powered=true": { model: "minecraft:block/stone" },
            },
        },
        [`${ns}/blockstates/grass_block.json`]: { variants: { "": { model: "minecraft:block/grass" } } },
        [`${ns}/blockstates/glass.json`]: { variants: { "": { model: "minecraft:block/glass" } } },
        [`${ns}/blockstates/chest.json`]: { variants: { "": { model: "minecraft:block/chest" } } },
        [`${ns}/models/block/cube.json`]: CUBE,
        [`${ns}/models/block/cube_all.json`]: {
            parent: "block/cube",
            textures: Object.fromEntries([...ALL.map(d => [d, "#all"]), ["particle", "#all"]]),
        },
        [`${ns}/models/block/stone.json`]: { parent: "minecraft:block/cube_all", textures: { all: "block/stone" } },
        [`${ns}/models/block/glass.json`]: { parent: "block/cube_all", textures: { all: "block/glass" } },
        [`${ns}/models/block/grass.json`]: {
            parent: "block/cube",
            textures: { down: "block/stone", up: "block/grass_top", north: "block/stone", south: "block/stone", west: "block/stone", east: "block/stone" },
            elements: [{
                from: [0, 0, 0],
                to: [16, 16, 16],
                faces: { up: { texture: "#up", cullface: "up", tintindex: 0 }, north: { texture: "#north", cullface: "north" } },
            }],
        },
        [`${ns}/models/block/observer.json`]: {
            parent: "block/cube",
            textures: { down: "block/observer_side", up: "block/observer_top", north: "block/observer_front", south: "block/observer_back", west: "block/observer_side", east: "block/observer_side" },
        },
        [`${ns}/models/block/lamp.json`]: { parent: "block/cube_all", textures: { all: "block/lamp" } },
        [`${ns}/models/block/lamp_on.json`]: { parent: "block/cube_all", textures: { all: "block/lamp_on" } },
        [`${ns}/models/block/slab.json`]: {
            parent: "block/cube",
            textures: { down: "block/stone", up: "block/stone", north: "block/stone", south: "block/stone", west: "block/stone", east: "block/stone" },
            elements: [{
                from: [0, 0, 0],
                to: [16, 8, 16],
                faces: Object.fromEntries(ALL.map(d => [d, { texture: `#${d}`, cullface: d === "up" ? undefined : d }])),
            }],
        },
        [`${ns}/models/block/post.json`]: {
            textures: { all: "block/stone" },
            elements: [{ from: [6, 0, 6], to: [10, 16, 10], faces: Object.fromEntries(ALL.map(d => [d, { texture: "#all" }])) }],
        },
        [`${ns}/models/block/side.json`]: {
            textures: { all: "block/stone" },
            elements: [{ from: [7, 6, 0], to: [9, 9, 6], faces: Object.fromEntries(ALL.map(d => [d, { texture: "#all" }])) }],
        },
        [`${ns}/models/block/chest.json`]: { parent: "builtin/entity", textures: { particle: "block/stone" } },
        [`${ns}/lang/en_us.json`]: {
            "language.name": "English",
            "language.region": "United States",
            "block.minecraft.stone": "Stone",
            "block.minecraft.observer": "Observer",
            "block.minecraft.oak_slab": "Oak Slab",
            "block.minecraft.oak_fence": "Oak Fence",
            "block.minecraft.redstone_lamp": "Redstone Lamp",
            "block.minecraft.glass": "Glass",
            "block.minecraft.lever": "Lever",
            "block.minecraft.grass_block": "Grass Block",
            "block.minecraft.chest": "Chest",
            "gui.done": "Done",
        },
        [`${ns}/lang/zh_cn.json`]: {
            "language.name": "简体中文",
            "language.region": "中国",
            "block.minecraft.stone": "石头",
            "block.minecraft.observer": "侦测器",
            "block.minecraft.oak_slab": "橡木台阶",
            "block.minecraft.redstone_lamp": "红石灯",
            "block.minecraft.glass": "玻璃",
        },
        [`${ns}/lang/de_de.json`]: { "language.name": "Deutsch", "language.region": "Deutschland", "block.minecraft.stone": "Stein" },
        [`${ns}/textures/block/stone.png`]: png(16, 16, [128, 128, 128]),
        [`${ns}/textures/block/glass.png`]: png(16, 16, [200, 220, 255, 100]),
        [`${ns}/textures/block/grass_top.png`]: png(16, 16, [255, 255, 255]),
        [`${ns}/textures/block/observer_front.png`]: png(16, 16, [90, 60, 60]),
        [`${ns}/textures/block/observer_back.png`]: png(16, 16, [60, 90, 60]),
        [`${ns}/textures/block/observer_side.png`]: png(16, 16, [70, 70, 70]),
        [`${ns}/textures/block/observer_top.png`]: png(16, 16, [50, 50, 50]),
        [`${ns}/textures/block/lamp.png`]: png(16, 16, [60, 30, 10]),
        [`${ns}/textures/block/lamp_on.png`]: png(16, 16, [255, 200, 80]),
    };
}

/** Pack like a redstone visualisation resource pack: adds a `powered` look to the observer. */
export function overlay_files() {
    const ns = "assets/minecraft";
    return {
        [`${ns}/blockstates/observer.json`]: { variants: observer_variants("minecraft:block/observer_on", "true") },
        [`${ns}/models/block/observer_on.json`]: {
            parent: "block/observer",
            textures: { north: "block/observer_front_on", up: "block/observer_top_on" },
        },
        // A pack higher in the stack renames a block; the other names still come from the base pack
        [`${ns}/lang/zh_cn.json`]: { "block.minecraft.observer": "侦测器（红石版）" },
        [`${ns}/textures/block/observer_front_on.png`]: png(16, 16, [255, 0, 0]),
        [`${ns}/textures/block/observer_top_on.png`]: png(16, 16, [255, 80, 0]),
    };
}

export function base_pack() {
    return make_pack("base", base_files());
}

export function overlay_pack() {
    return make_pack("overlay", overlay_files());
}

/** Overlay on top of base, like a user stacking two packs. */
export function stack() {
    return new PackStack([overlay_pack(), base_pack()]);
}

/** Zip bytes for browser tests. */
export function zip_of(files) {
    return zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [
        path,
        value instanceof Uint8Array ? [value, { level: 0 }] : strToU8(JSON.stringify(value)),
    ])));
}

/**
 * A compiled pack without the picture: the atlas has a rectangle for every texture, which is all the code needs.
 * @param {PackStack} pack_stack
 * @param {Record<string, Record<string, string[]>>} [extra] Extra block properties
 */
export function compiled_pack(pack_stack, extra = {}) {
    const data = collect(pack_stack, extra);
    const textures = Object.fromEntries([...data.textures, "minecraft:missing"].map((id, i) => [id, {
        x: i * 18, y: 0, w: 16, h: 16, opaque: !id.endsWith("glass"), translucent: id.endsWith("glass"),
    }]));
    const lang = Object.fromEntries(Object.entries(data.lang).map(([code, names]) => [code, new TextEncoder().encode(JSON.stringify(names))]));
    return new CompiledPack({ ...data, name: "test", atlas: { width: 1024, height: 32, textures } }, { lang });
}
