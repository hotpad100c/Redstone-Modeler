#!/usr/bin/env node
/**
 * Writes data/fallback.json: models for the blocks that the game draws with code and not with a model
 * file (chests, shulker boxes). They are used only when the packs give such a block no geometry.
 *
 * The game builds these from boxes with a texture layout that is the same for every box: a box of
 * w x h x d pixels whose corner of the texture is (u, v) takes
 *
 *     top   (u + d,         v)        w x d     bottom (u + d + w,         v)        w x d
 *     left  (u,             v + d)    d x h     front  (u + d,             v + d)    w x h
 *     right (u + d + w,     v + d)    d x h     back   (u + 2 * d + w,     v + d)    w x h
 *
 * and the entity models are drawn upside down, so the top region is on the bottom of the block and the
 * sides turn by 180 degrees. Which region lands on which side of a block follows from the texture
 * that the game ships (64 x 64 for a chest), so it is written down below, per box.
 *
 * Usage: node scripts/make_fallback.mjs
 */
import { writeFileSync } from "node:fs";

const TEXTURE = 64;
const DIRECTIONS = ["north", "east", "south", "west", "up", "down"];

/** The regions of a box, in pixels of the texture: [x1, y1, x2, y2] */
function regions(u, v, [w, h, d]) {
    return {
        top: [u + d, v, u + d + w, v + d],
        bottom: [u + d + w, v, u + d + 2 * w, v + d],
        left: [u, v + d, u + d, v + d + h],
        front: [u + d, v + d, u + d + w, v + d + h],
        right: [u + d + w, v + d, u + 2 * d + w, v + d + h],
        back: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
    };
}

/**
 * A model element: a box from `from` to `to` (in blocks of 16) whose faces take the regions named in `use`
 * (a face that is not named is not there: it is hidden inside another box or against the other half of a double chest).
 * @param {object} box
 * @param {number[]} box.from
 * @param {number[]} box.to
 * @param {number[]} box.offset Corner of the box in the texture, pixels
 * @param {Record<string, string>} box.use Direction to region
 * @param {Record<string, number>} [box.turn] Direction to turn of the picture, degrees
 */
function element({ from, to, offset, use, turn = {} }) {
    const size = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const found = regions(offset[0], offset[1], size);
    const scale = 16 / TEXTURE;
    const faces = {};
    for (const direction of DIRECTIONS) {
        if (use[direction]) {
            const face = { uv: found[use[direction]].map(value => Math.round(value * scale * 4) / 4), texture: "#all" };
            if (turn[direction]) {
                face.rotation = turn[direction];
            }
            faces[direction] = face;
        }
    }
    return { from, to, faces };
}

const SIDES_FLIPPED = { north: 180, east: 180, south: 180, west: 180 };
/** What a box of a chest does: the entity is drawn upside down */
const STANDING = { north: "front", east: "left", south: "back", west: "right", up: "bottom", down: "top" };

/**
 * One chest, or one half of a double chest. The two halves are seen from the front of the chest, which
 * faces south: the left half is the west one and has its open end to the east, the right half the other way round.
 * @param {"single"|"left"|"right"} kind
 */
function chest(kind, texture) {
    const [x1, x2] = kind === "single" ? [1, 15] : kind === "left" ? [1, 16] : [0, 15];
    const use = { ...STANDING };
    // The end that is joined to the other half has no wall
    if (kind === "left") {
        delete use.east;
    }
    if (kind === "right") {
        delete use.west;
    }
    const lock_x = kind === "single" ? [7, 9] : kind === "left" ? [15, 16] : [0, 1];
    const lock_use = { south: "front", north: "back", east: "left", west: "right", up: "top", down: "bottom" };
    if (kind === "left") {
        delete lock_use.east;
    }
    if (kind === "right") {
        delete lock_use.west;
    }
    return {
        textures: { all: texture },
        elements: [
            element({ from: [x1, 0, 1], to: [x2, 10, 15], offset: [0, 19], use, turn: SIDES_FLIPPED }),
            element({ from: [x1, 9, 1], to: [x2, 14, 15], offset: [0, 0], use, turn: SIDES_FLIPPED }),
            element({ from: [lock_x[0], 7, 15], to: [lock_x[1], 11, 16], offset: [0, 0], use: lock_use, turn: { ...SIDES_FLIPPED, up: 180, down: 180 } }),
        ],
    };
}

/** The four directions as the turn of a model around y, which the blockstate files use */
const TURN = { south: 0, west: 90, north: 180, east: 270 };

const chest_variants = {};
for (const [facing, y] of Object.entries(TURN)) {
    for (const [type, model] of [["single", "chest"], ["left", "chest_left"], ["right", "chest_right"]]) {
        chest_variants[`facing=${facing},type=${type}`] = y === 0 ? { model: `custom:entity/${model}` } : { model: `custom:entity/${model}`, y };
    }
}

const SHULKER = "minecraft:entity/shulker/shulker";
const shulker_sides = { north: "front", east: "left", south: "back", west: "right" };
const shulker = {
    textures: { all: SHULKER },
    elements: [
        element({ from: [0, 0, 0], to: [16, 8, 16], offset: [0, 28], use: { ...shulker_sides, up: "top", down: "bottom" } }),
        element({ from: [0, 4, 0], to: [16, 16, 16], offset: [0, 0], use: { ...shulker_sides, up: "top", down: "bottom" } }),
    ],
};
const shulker_variants = {
    "facing=up": { model: "custom:entity/shulker_box" },
    "facing=down": { model: "custom:entity/shulker_box", x: 180 },
    "facing=north": { model: "custom:entity/shulker_box", x: 90 },
    "facing=east": { model: "custom:entity/shulker_box", x: 90, y: 90 },
    "facing=south": { model: "custom:entity/shulker_box", x: 90, y: 180 },
    "facing=west": { model: "custom:entity/shulker_box", x: 90, y: 270 },
};

const fallback = {
    _comment: "Models for blocks that Minecraft draws with code and not with a model file. Used only when the resource packs give such a block no geometry. Made by scripts/make_fallback.mjs.",
    blockstates: {
        chest: { variants: chest_variants },
        shulker_box: { variants: shulker_variants },
    },
    models: {
        "custom:entity/chest": chest("single", "minecraft:entity/chest/normal"),
        "custom:entity/chest_left": chest("left", "minecraft:entity/chest/normal_left"),
        "custom:entity/chest_right": chest("right", "minecraft:entity/chest/normal_right"),
        "custom:entity/shulker_box": shulker,
    },
};

writeFileSync(new URL("../data/fallback.json", import.meta.url), `${JSON.stringify(fallback)}\n`);
console.log("data/fallback.json written");
