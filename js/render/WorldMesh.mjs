import * as THREE from "three";

// Face definitions: normal, shade and the four corners (counter-clockwise seen from outside).
const FACES = [
    { dir: [1, 0, 0], shade: 0.8, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
    { dir: [-1, 0, 0], shade: 0.8, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { dir: [0, 1, 0], shade: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { dir: [0, -1, 0], shade: 0.5, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { dir: [0, 0, 1], shade: 0.9, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { dir: [0, 0, -1], shade: 0.6, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/**
 * Placeholder look for blocks until resource packs are loaded.
 * @param {string} name
 */
function color_of(name) {
    let hash = 0;
    for (const c of name) {
        hash = (hash * 31 + c.codePointAt(0)) >>> 0;
    }
    return new THREE.Color().setHSL((hash % 360) / 360, 0.45, 0.55);
}

/**
 * Builds one merged mesh of all visible blocks, culling faces hidden by neighbours.
 */
export class WorldMesh {
    /**
     * @param {import("../model/World.mjs").World} world
     */
    constructor(world) {
        this.world = world;
        this.max_layer = world.size.y - 1;
        this.object = new THREE.Mesh(
            new THREE.BufferGeometry(),
            new THREE.MeshBasicMaterial({ vertexColors: true }),
        );
        this.built_version = -1;
        this.built_layer = -1;
    }

    set_layer(layer) {
        this.max_layer = layer;
    }

    /** Rebuilds the geometry when the world or the layer changed. */
    update() {
        if (this.built_version === this.world.version && this.built_layer === this.max_layer) {
            return;
        }
        this.built_version = this.world.version;
        this.built_layer = this.max_layer;

        const positions = [];
        const colors = [];
        const indices = [];
        const colour_cache = new Map();

        for (const [x, y, z, block] of this.world.entries()) {
            if (y > this.max_layer) {
                continue;
            }
            if (!colour_cache.has(block.name)) {
                colour_cache.set(block.name, color_of(block.name));
            }
            const base = colour_cache.get(block.name);
            for (const face of FACES) {
                const [dx, dy, dz] = face.dir;
                const neighbour_y = y + dy;
                if (neighbour_y <= this.max_layer && this.world.get(x + dx, neighbour_y, z + dz)) {
                    continue;
                }
                const start = positions.length / 3;
                for (const [cx, cy, cz] of face.corners) {
                    positions.push(x + cx, y + cy, z + cz);
                    colors.push(base.r * face.shade, base.g * face.shade, base.b * face.shade);
                }
                indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        this.object.geometry.dispose();
        this.object.geometry = geometry;
    }
}
