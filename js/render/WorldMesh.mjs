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
        this.max_layer = world.size.y - 1;
        /** @type {import("./Resources.mjs").Resources|null} */
        this.resources = null;
        this.group = new THREE.Group();
        /** @type {THREE.Mesh[]} */
        this.meshes = [];
        this.built_version = -1;
        this.built_layer = -1;
        this.built_resources = null;
    }

    set_resources(resources) {
        this.resources = resources;
    }

    set_layer(layer) {
        this.max_layer = layer;
    }

    update() {
        if (this.built_version === this.world.version
            && this.built_layer === this.max_layer
            && this.built_resources === this.resources) {
            return;
        }
        this.built_version = this.world.version;
        this.built_layer = this.max_layer;
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
            if (y > this.max_layer) {
                continue;
            }
            const { quads } = geometry_of(block);
            let tint = null;
            for (const quad of quads) {
                if (quad.cull >= 0) {
                    const [dx, dy, dz] = DIR_OFFSET[DIRS[quad.cull]];
                    const ny = y + dy;
                    const neighbour = ny <= this.max_layer ? this.world.get(x + dx, ny, z + dz) : null;
                    if (neighbour && geometry_of(neighbour).occludes) {
                        continue;
                    }
                }
                if (quad.tint >= 0) {
                    tint ??= resources.tint(block.name, { ...pack.default_state(block.name), ...block.props });
                }
                const rect = pack.texture(quad.tex);
                (rect.translucent ? translucent : solid).add(quad, rect, [x, y, z], tint ?? [1, 1, 1], [x, y, z]);
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
