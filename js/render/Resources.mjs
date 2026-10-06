import * as THREE from "three";
import { make_tint } from "./Tint.mjs";

/**
 * Everything the renderer needs from a loaded pack: geometry source, atlas texture, materials.
 */
export class Resources {
    /**
     * @param {import("../pack/CompiledPack.mjs").CompiledPack} pack
     * @param {ImageBitmap} atlas_image
     */
    constructor(pack, atlas_image) {
        this.pack = pack;
        this.tint = make_tint(pack.colormaps);
        this.texture = new THREE.Texture(atlas_image);
        this.texture.flipY = false;
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.magFilter = THREE.NearestFilter;
        this.texture.minFilter = THREE.NearestFilter;
        this.texture.generateMipmaps = false;
        this.texture.needsUpdate = true;
        this.cutout = new THREE.MeshBasicMaterial({ map: this.texture, vertexColors: true, alphaTest: 0.1 });
        this.translucent = new THREE.MeshBasicMaterial({
            map: this.texture,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            alphaTest: 0.01,
        });
    }

    get atlas() {
        return this.pack.data.atlas;
    }

    dispose() {
        this.texture.dispose();
        this.cutout.dispose();
        this.translucent.dispose();
    }
}
