import * as THREE from "three";
import { DIRS } from "./BlockMesher.mjs";
import { MeshData } from "./MeshData.mjs";

const DIR_OFFSET = {
    down: [0, -1, 0],
    up: [0, 1, 0],
    north: [0, 0, -1],
    south: [0, 0, 1],
    west: [-1, 0, 0],
    east: [1, 0, 0],
};

/**
 * Merged geometry of all blocks at or below the current layer.
 * Faces covered by an opaque full block are skipped.
 * The whole world is rebuilt when it changes, which is fast enough for the model sizes in use.
 */
export class WorldMesh {
    /**
     * @param {import("../model/World.mjs").World} world
     */
    constructor(world) {
        this.world = world;
        /** @type {{axis: number, index: number, side: number}|null} */
        this.slice = null;
        /** @type {import("./Resources.mjs").Resources|null} */
        this.resources = null;
        this.group = new THREE.Group();
        /** @type {THREE.Mesh[]} */
        this.meshes = [];
        this.built_version = -1;
        this.built_slice = undefined;
        this.built_resources = null;
    }

    set_resources(resources) {
        this.resources = resources;
    }

    /**
     * Shows a 2D slice: blocks nearer to the camera than the plane are hidden, blocks behind it are dimmed.
     * @param {{axis: number, index: number, side: number}|null} slice
     *   axis 0/1/2 is x/y/z, side is +1 or -1, the side of the world the camera is on
     */
    set_slice(slice) {
        this.slice = slice;
    }

    /** @returns {-1|0|1} 1 hidden, 0 on the plane, -1 behind the plane */
    _depth(x, y, z) {
        if (!this.slice) {
            return 0;
        }
        const { axis, index, side } = this.slice;
        const delta = ([x, y, z][axis] - index) * side;
        return Math.sign(delta);
    }

    update() {
        if (this.built_version === this.world.version
            && this.built_slice === this.slice
            && this.built_resources === this.resources) {
            return;
        }
        this.built_version = this.world.version;
        this.built_slice = this.slice;
        this.built_resources = this.resources;
        for (const mesh of this.meshes) {
            this.group.remove(mesh);
            mesh.geometry.dispose();
        }
        this.meshes = [];
        const { resources } = this;
        if (!resources) {
            return;
        }

        const { pack } = resources;
        const solid = new MeshData(resources.atlas);
        const translucent = new MeshData(resources.atlas);
        const geometry_of = block => pack.geometry(block.name, block.props);

        for (const [x, y, z, block] of this.world.entries()) {
            const depth = this._depth(x, y, z);
            if (depth > 0) {
                continue;
            }
            const brightness = depth < 0 ? 0.45 : 1;
            const { quads } = geometry_of(block);
            let tint = null;
            for (const quad of quads) {
                if (quad.cull >= 0) {
                    const [dx, dy, dz] = DIR_OFFSET[DIRS[quad.cull]];
                    const neighbour = this._depth(x + dx, y + dy, z + dz) > 0 ? null : this.world.get(x + dx, y + dy, z + dz);
                    if (neighbour && geometry_of(neighbour).occludes) {
                        continue;
                    }
                }
                if (quad.tint >= 0) {
                    tint ??= resources.tint(block.name, { ...pack.default_state(block.name), ...block.props });
                }
                const rect = pack.texture(quad.tex);
                (rect.translucent ? translucent : solid).add(quad, rect, [x, y, z], tint ?? [1, 1, 1], [x, y, z], brightness);
            }
        }

        for (const [data, material, order] of [[solid, resources.cutout, 0], [translucent, resources.translucent, 1]]) {
            if (!data.empty) {
                const mesh = new THREE.Mesh(data.to_geometry(), material);
                mesh.renderOrder = order;
                mesh.userData.cells = data.cells;
                this.group.add(mesh);
                this.meshes.push(mesh);
            }
        }
    }
}
