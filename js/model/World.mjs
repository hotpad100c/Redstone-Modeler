/**
 * Sparse 3D block storage. Coordinates follow Minecraft: x/z horizontal, y up.
 * A block is `{ name, props }`, for example `{ name: "minecraft:observer", props: { facing: "north" } }`.
 */
export class World {
    /**
     * @param {{x: number, y: number, z: number}} size
     */
    constructor(size) {
        this.size = size;
        this.blocks = new Map();
        this.version = 0;
    }

    static key(x, y, z) {
        return `${x},${y},${z}`;
    }

    in_bounds(x, y, z) {
        return x >= 0 && y >= 0 && z >= 0
            && x < this.size.x && y < this.size.y && z < this.size.z;
    }

    get(x, y, z) {
        return this.blocks.get(World.key(x, y, z)) ?? null;
    }

    set(x, y, z, block) {
        if (!this.in_bounds(x, y, z)) {
            return false;
        }
        this.blocks.set(World.key(x, y, z), block);
        this.version++;
        return true;
    }

    remove(x, y, z) {
        const removed = this.blocks.delete(World.key(x, y, z));
        if (removed) {
            this.version++;
        }
        return removed;
    }

    clear() {
        this.blocks.clear();
        this.version++;
    }

    /**
     * @returns {Iterable<[number, number, number, {name: string, props: Record<string, string>}]>}
     */
    * entries() {
        for (const [key, block] of this.blocks) {
            const [x, y, z] = key.split(",").map(Number);
            yield [x, y, z, block];
        }
    }
}
