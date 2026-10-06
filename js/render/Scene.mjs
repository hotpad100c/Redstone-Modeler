import * as THREE from "three";
import { OrbitControls } from "../../lib/OrbitControls.js";
import { WorldMesh } from "./WorldMesh.mjs";

const CLICK_MOVE_LIMIT = 5; // pixels; more than this is a camera drag, not a click

/**
 * three.js view of a World: camera, picking, hover preview.
 */
export class Scene {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import("../model/World.mjs").World} world
     */
    constructor(canvas, world) {
        this.canvas = canvas;
        this.world = world;
        this.layer = world.size.y - 1;
        /** @type {(x: number, y: number, z: number, button: number, event: PointerEvent) => void} */
        this.on_click = () => {};

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x404040);

        const { x: sx, y: sy, z: sz } = world.size;
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
        this.camera.position.set(sx * 1.2, sy * 1.2, sz * 1.8);
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.target.set(sx / 2, 0, sz / 2);
        this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        this.controls.enableDamping = false;
        this.controls.update();

        this.world_mesh = new WorldMesh(world);
        this.scene.add(this.world_mesh.group);

        this.floor_grid = new THREE.GridHelper(Math.max(sx, sz), Math.max(sx, sz), 0xffffff, 0x808080);
        this.floor_grid.position.set(sx / 2, 0, sz / 2);
        this.scene.add(this.floor_grid);

        this.floor_plane = new THREE.Mesh(
            new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(sx / 2, 0, sz / 2),
            new THREE.MeshBasicMaterial({ visible: false }),
        );
        this.scene.add(this.floor_plane);

        this.bounds = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz).translate(sx / 2, sy / 2, sz / 2)),
            new THREE.LineBasicMaterial({ color: 0x606060 }),
        );
        this.scene.add(this.bounds);

        this.layer_marker = new THREE.Mesh(
            new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(sx / 2, 0, sz / 2),
            new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.12, depthWrite: false }),
        );
        this.scene.add(this.layer_marker);

        this.hover = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
            new THREE.LineBasicMaterial({ color: 0xffff00 }),
        );
        this.hover.visible = false;
        this.scene.add(this.hover);

        this.raycaster = new THREE.Raycaster();
        this._bind_pointer();
        this.set_layer(this.layer);
        new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
        this.resize();
        this._frame = this._frame.bind(this);
        requestAnimationFrame(this._frame);
    }

    /** @param {import("./Resources.mjs").Resources|null} resources */
    set_resources(resources) {
        this.world_mesh.set_resources(resources);
    }

    /** Highest layer (y level) that is shown and can be built on. */
    set_layer(layer) {
        this.layer = Math.max(0, Math.min(this.world.size.y - 1, layer));
        this.world_mesh.set_layer(this.layer);
        this.layer_marker.position.y = this.layer + 1;
        this.layer_marker.visible = this.layer < this.world.size.y - 1;
        this.hover.visible = false;
    }

    resize() {
        const parent = this.canvas.parentElement;
        const w = Math.max(1, parent.clientWidth);
        const h = Math.max(1, parent.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(w, h, false);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        const half = Math.max(this.world.size.x, this.world.size.y, this.world.size.z) * 0.9;
        const aspect = w / h;
        this.camera.left = -half * aspect;
        this.camera.right = half * aspect;
        this.camera.top = half;
        this.camera.bottom = -half;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Finds the cell a click would act on.
     * @param {number} client_x
     * @param {number} client_y
     * @returns {{hit: number[]|null, place: number[]|null}}
     *   `hit` is the block under the cursor, `place` the empty cell next to the hit face.
     */
    pick(client_x, client_y) {
        const rect = this.canvas.getBoundingClientRect();
        const ndc = new THREE.Vector2(
            ((client_x - rect.left) / rect.width) * 2 - 1,
            -((client_y - rect.top) / rect.height) * 2 + 1,
        );
        this.raycaster.setFromCamera(ndc, this.camera);
        this.world_mesh.update();
        const hits = this.raycaster.intersectObjects([...this.world_mesh.meshes, this.floor_plane], false);
        if (hits.length === 0) {
            return { hit: null, place: null };
        }
        const { point, face, object, faceIndex } = hits[0];
        if (object === this.floor_plane) {
            const place = [Math.floor(point.x), 0, Math.floor(point.z)];
            return { hit: null, place: this._buildable(place) ? place : null };
        }
        const hit = object.userData.cells[faceIndex >> 1];
        const n = face.normal;
        const axis = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].reduce((best, v, i, all) => v > all[best] ? i : best, 0);
        const step = [0, 0, 0];
        step[axis] = Math.sign([n.x, n.y, n.z][axis]);
        const place = hit.map((v, i) => v + step[i]);
        return { hit, place: this._buildable(place) ? place : null };
    }

    _buildable(cell) {
        return this.world.in_bounds(...cell) && cell[1] <= this.layer && !this.world.get(...cell);
    }

    _bind_pointer() {
        let down = null;
        this.canvas.addEventListener("contextmenu", e => e.preventDefault());
        this.canvas.addEventListener("pointerdown", (e) => {
            down = { x: e.clientX, y: e.clientY, button: e.button };
        });
        this.canvas.addEventListener("pointerup", (e) => {
            if (down && down.button === e.button
                && Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_MOVE_LIMIT) {
                const { hit, place } = this.pick(e.clientX, e.clientY);
                const target = e.button === 2 || e.altKey ? hit : place;
                if (target) {
                    this.on_click(target[0], target[1], target[2], e.button, e);
                }
            }
            down = null;
        });
        this.canvas.addEventListener("pointermove", (e) => {
            if (e.buttons) {
                this.hover.visible = false;
                return;
            }
            const { place } = this.pick(e.clientX, e.clientY);
            this.hover.visible = place !== null;
            if (place) {
                this.hover.position.set(place[0] + 0.5, place[1] + 0.5, place[2] + 0.5);
            }
        });
        this.canvas.addEventListener("pointerleave", () => {
            this.hover.visible = false;
        });
    }

    /** @returns {Promise<Blob>} PNG of the current view */
    to_blob() {
        this.hover.visible = false;
        this.layer_marker.visible = false;
        this.world_mesh.update();
        this.renderer.render(this.scene, this.camera);
        this.layer_marker.visible = true;
        return new Promise(resolve => this.canvas.toBlob(resolve, "image/png"));
    }

    _frame() {
        this.world_mesh.update();
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(this._frame);
    }
}
