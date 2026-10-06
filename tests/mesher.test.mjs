import assert from "node:assert/strict";
import { test } from "node:test";
import { DIRS, MISSING_MODEL, build_block, build_element, rotate_point } from "../js/render/BlockMesher.mjs";

const cube = {
    from: [0, 0, 0],
    to: [16, 16, 16],
    faces: Object.fromEntries(DIRS.map(d => [d, { texture: "minecraft:block/stone", cullface: d }])),
};
const none = { x: 0, y: 0, uvlock: false };

function normal_of(quad) {
    const [p0, p1, p2] = [0, 1, 2].map(i => quad.pos.slice(i * 3, i * 3 + 3));
    const a = p1.map((v, i) => v - p0[i]);
    const b = p2.map((v, i) => v - p0[i]);
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]].map(v => Math.sign(Math.round(v * 1e6)) + 0);
}

test("cube has six outward facing quads", () => {
    const quads = build_element(cube, none);
    assert.equal(quads.length, 6);
    const expected = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
    quads.forEach((quad, i) => {
        const dir = Object.keys(cube.faces)[i];
        assert.deepEqual(normal_of(quad), expected[dir], dir);
        assert.equal(quad.cull, DIRS.indexOf(dir));
    });
});

test("default uv covers the full texture of a full cube face", () => {
    for (const quad of build_element(cube, none)) {
        const us = quad.uv.filter((_, i) => i % 2 === 0);
        const vs = quad.uv.filter((_, i) => i % 2 === 1);
        assert.deepEqual([Math.min(...us), Math.max(...us)], [0, 16]);
        assert.deepEqual([Math.min(...vs), Math.max(...vs)], [0, 16]);
    }
});

test("side face texture is upright: top corners get v = 0", () => {
    const south = build_element(cube, none)[3];
    // Vertex 0 of the south face is the top-left corner (y = 1)
    assert.equal(south.pos[1], 1);
    assert.equal(south.uv[1], 0);
});

test("blockstate y rotation turns a north face towards east", () => {
    const north_only = { from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "t", cullface: "north" } } };
    const [quad] = build_element(north_only, { x: 0, y: 90, uvlock: false });
    assert.equal(DIRS[quad.cull], "east");
    assert.deepEqual(normal_of(quad), [1, 0, 0]);
});

test("blockstate x rotation of 90 turns a north face downwards", () => {
    const north_only = { from: [0, 0, 0], to: [16, 16, 16], faces: { north: { texture: "t", cullface: "north" } } };
    const [quad] = build_element(north_only, { x: 90, y: 0, uvlock: false });
    assert.equal(DIRS[quad.cull], "down");
});

test("element rotation with rescale stretches a diagonal plane by 1/cos", () => {
    const plane = {
        from: [0.8, 0, 8],
        to: [15.2, 16, 8],
        rotation: { origin: [8, 8, 8], axis: "y", angle: 45, rescale: true },
        faces: { north: { texture: "t" } },
    };
    const [quad] = build_element(plane, none);
    // Vertex 0 and 2 of the north face are opposite corners of the plane, vertex 0 and 3 a vertical edge
    const [a, c] = [0, 1].map(i => quad.pos.slice(i * 3, i * 3 + 3));
    const [bottom_a, bottom_b] = [1, 2].map(i => quad.pos.slice(i * 3, i * 3 + 3));
    assert.ok(Math.abs(Math.hypot(bottom_a[0] - bottom_b[0], bottom_a[2] - bottom_b[2]) - 14.4 * Math.SQRT2 / 16) < 1e-6);
    assert.ok(Math.abs(a[0] - c[0]) < 1e-6 && Math.abs(a[2] - c[2]) < 1e-6);
});

test("uv rotation shifts corners", () => {
    const base = build_element({ ...cube, faces: { up: { texture: "t", uv: [0, 0, 16, 16] } } }, none)[0];
    const turned = build_element({ ...cube, faces: { up: { texture: "t", uv: [0, 0, 16, 16], rotation: 90 } } }, none)[0];
    assert.deepEqual(turned.uv.slice(6, 8), base.uv.slice(0, 2));
});

test("uvlock keeps the texture world aligned", () => {
    const up_only = { from: [0, 0, 0], to: [16, 16, 16], faces: { up: { texture: "t" } } };
    const [quad] = build_element(up_only, { x: 0, y: 90, uvlock: true });
    // After turning about y the up face is still up, uv still follows x and z
    for (let i = 0; i < 4; i++) {
        assert.equal(quad.uv[i * 2], quad.pos[i * 3] * 16);
        assert.equal(quad.uv[i * 2 + 1], quad.pos[i * 3 + 2] * 16);
    }
});

test("full opaque cube occludes, a slab does not, a transparent cube does not", () => {
    const model = { elements: [cube] };
    assert.equal(build_block([{ ...none, model }], () => true).occludes, true);
    assert.equal(build_block([{ ...none, model }], () => false).occludes, false);
    const slab = { elements: [{ ...cube, to: [16, 8, 16] }] };
    assert.equal(build_block([{ ...none, model: slab }], () => true).occludes, false);
});

test("missing model is a cube with the missing texture", () => {
    const { quads } = build_block([{ ...none, model: MISSING_MODEL }], () => true);
    assert.equal(quads.length, 6);
    assert.ok(quads.every(q => q.tex === "minecraft:missing"));
});

test("rotate_point is right handed", () => {
    const p = rotate_point([1, 0, 0], "y", 90).map(v => Math.round(v));
    assert.deepEqual(p, [0, 0, -1]);
});
