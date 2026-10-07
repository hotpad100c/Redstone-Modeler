import * as THREE from "../../lib/three.module.min.js";
import { OrbitControls } from "../../lib/OrbitControls.js";
import { AxisGizmo } from "./AxisGizmo.mjs";
import { WorldMesh } from "./WorldMesh.mjs";

const CLICK_MOVE_LIMIT = 5; // pixels; more than this is a camera drag, not a click
const ISO_DIRECTION = new THREE.Vector3(0.4, 0.6, 0.7).normalize();
const ALIGN_LIMIT = Math.cos(THREE.MathUtils.degToRad(0.5)); // rotating further than this leaves a 2D view
const TRANSITION_MS = 260;
const AXIS_VECTORS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/** Lines of a w by h grid in the local xz plane, centred on the origin. */
function make_grid(w, h) {
    const points = [];
    for (let i = 0; i <= w; i++) {
        points.push(i - w / 2, 0, -h / 2, i - w / 2, 0, h / 2);
    }
    for (let j = 0; j <= h; j++) {
        points.push(-w / 2, 0, j - h / 2, w / 2, 0, j - h / 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    // Nothing in front of the plane is shown, so the grid can ignore depth; lines lying on block faces would otherwise flicker
    const grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false }));
    grid.renderOrder = 3;
    return grid;
}

/**
 * three.js view of a World: camera, picking, hover preview.
 *
 * Two modes: free 3D, where clicks use the face under the cursor, and an axis aligned 2D view
 * (entered through the axis gizmo) where clicks act on a movable plane through the cube.
 */
export class Scene {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import("../model/World.mjs").World} world
     */
    constructor(canvas, world) {
        this.canvas = canvas;
        this.world = world;
        /** @type {{axis: number, side: number}|null} Set while an axis aligned 2D view is active */
        this.view = null;
        /** Index of the plane in 2D mode, along the view axis */
        this.plane = 0;
        /** @type {(x: number, y: number, z: number, button: number, event: PointerEvent) => void} */
        this.on_click = () => {};
        /** @type {() => void} Called when the view mode or the plane changes */
        this.on_view_change = () => {};
        this.animation = null;
        this.plane_style = { color: "#4488ff", opacity: 0.12 };
        /** Eraser tool: left click targets the block under the cursor instead of the empty cell next to it */
        this.erase = false;

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x404040);

        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
        this.center = new THREE.Vector3(world.size.x / 2, world.size.y / 2, world.size.z / 2);
        this.camera.position.copy(this.center).addScaledVector(ISO_DIRECTION, 60);
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.target.copy(this.center);
        this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        this.controls.enableDamping = false;
        this.controls.update();

        this.world_mesh = new WorldMesh(world);
        this.scene.add(this.world_mesh.group);

        this._build_frame();

        // Marker and grid of the 2D plane; rebuilt whenever the view axis changes
        this.plane_group = new THREE.Group();
        this.plane_group.visible = false;
        this.scene.add(this.plane_group);

        this.hover = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
            new THREE.LineBasicMaterial({ color: 0xffff00 }),
        );
        this.hover.visible = false;
        this.scene.add(this.hover);

        this.raycaster = new THREE.Raycaster();
        this._bind_pointer();
        this.gizmo = new AxisGizmo(document.getElementById("gizmo"), this.camera, name => this.view_to(name));
        new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
        this.resize();
        this._frame = this._frame.bind(this);
        requestAnimationFrame(this._frame);
    }

    /** Floor grid, floor picking plane and bounding box for the current world size. */
    _build_frame() {
        const { x: sx, y: sy, z: sz } = this.world.size;
        for (const object of [this.floor_grid, this.floor_plane, this.bounds]) {
            if (object) {
                this.scene.remove(object);
                object.geometry.dispose();
                object.material.dispose();
            }
        }
        this.floor_grid = new THREE.GridHelper(Math.max(sx, sz), Math.max(sx, sz), 0xffffff, 0x808080);
        this.floor_grid.position.set(sx / 2, 0, sz / 2);
        this.floor_grid.visible = !this.view;
        this.floor_plane = new THREE.Mesh(
            new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2).translate(sx / 2, 0, sz / 2),
            new THREE.MeshBasicMaterial({ visible: false }),
        );
        this.bounds = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz).translate(sx / 2, sy / 2, sz / 2)),
            new THREE.LineBasicMaterial({ color: 0x606060 }),
        );
        this.scene.add(this.floor_grid, this.floor_plane, this.bounds);
    }

    /**
     * Changes the size of the model space. Blocks outside are removed.
     * @param {{x: number, y: number, z: number}} size
     * @returns {number} Number of removed blocks
     */
    set_size(size) {
        const removed = this.world.resize(size);
        this.apply_world_size();
        return removed;
    }

    /** Rebuilds everything that depends on the world size; call after the world was resized elsewhere. */
    apply_world_size() {
        const { x, y, z } = this.world.size;
        const centre = new THREE.Vector3(x / 2, y / 2, z / 2);
        // Move the camera with the centre so the viewing direction stays the same
        const shift = centre.clone().sub(this.center);
        this.center.copy(centre);
        this.camera.position.add(shift);
        this.controls.target.add(shift);
        this.controls.update();
        this._build_frame();
        this.resize();
        if (this.view) {
            this.plane = Math.min(this.plane, this.world.size["xyz"[this.view.axis]] - 1);
        }
        this._update_plane();
    }

    /** @param {string} color CSS colour like `#404040` */
    set_background(color) {
        this.scene.background = new THREE.Color(color);
    }

    /**
     * @param {string} color CSS colour
     * @param {number} opacity 0..1
     */
    set_plane_style(color, opacity) {
        this.plane_style = { color, opacity };
        if (this.view) {
            this._update_plane();
        }
    }

    /** @param {import("./Resources.mjs").Resources|null} resources */
    set_resources(resources) {
        this.world_mesh.set_resources(resources);
    }

    /**
     * Where the centre of a cell is on the page, in client pixels. Mostly useful for tests.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    screen_position(x, y, z) {
        const rect = this.canvas.getBoundingClientRect();
        const p = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5).project(this.camera);
        return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height };
    }

    /**
     * Turns the camera to look along an axis, or back to the isometric view.
     * @param {string} name `+x`, `-x`, `+y`, `-y`, `+z`, `-z` or `iso`; the sign is the side of the cube the camera is on
     */
    view_to(name) {
        const direction = new THREE.Vector3();
        let view = null;
        if (name === "iso") {
            direction.copy(ISO_DIRECTION);
        }
        else {
            const axis = "xyz".indexOf(name[1]);
            const side = name[0] === "+" ? 1 : -1;
            direction.copy(AXIS_VECTORS[axis]).multiplyScalar(side);
            if (axis === 1) {
                direction.z = 1e-4; // keeps the screen orientation defined when looking straight along y
            }
            view = { axis, side };
        }
        this._exit_view();
        const offset = this.camera.position.clone().sub(this.controls.target);
        this.animation = {
            from: new THREE.Spherical().setFromVector3(offset),
            to: new THREE.Spherical().setFromVector3(direction.clone().multiplyScalar(offset.length())),
            start: performance.now(),
            view,
        };
    }

    _finish_animation() {
        const { view } = this.animation;
        this.animation = null;
        if (view) {
            const keep = this.view_axis_memory === view.axis;
            this.plane = keep ? Math.min(this.plane, this.world.size["xyz"[view.axis]] - 1) : Math.floor(this.world.size["xyz"[view.axis]] / 2);
            this.view_axis_memory = view.axis;
            this.view = view;
            this._update_plane();
        }
    }

    _step_animation(now) {
        const { from, to } = this.animation;
        const t = Math.min(1, (now - this.animation.start) / TRANSITION_MS);
        const eased = t * t * (3 - 2 * t);
        let delta_theta = to.theta - from.theta;
        delta_theta -= Math.round(delta_theta / (Math.PI * 2)) * Math.PI * 2; // shortest way round
        const spherical = new THREE.Spherical(
            from.radius,
            from.phi + (to.phi - from.phi) * eased,
            from.theta + delta_theta * eased,
        );
        this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
        this.controls.update();
        if (t >= 1) {
            this._finish_animation();
        }
    }

    _exit_view() {
        if (this.view) {
            this.view = null;
            this._update_plane();
        }
    }

    /** Moves the 2D plane by `delta` cells. */
    move_plane(delta) {
        if (this.view) {
            this.set_plane(this.plane + delta);
        }
    }

    set_plane(index) {
        if (this.view) {
            this.plane = Math.max(0, Math.min(this.world.size["xyz"[this.view.axis]] - 1, index));
            this._update_plane();
        }
    }

    _update_plane() {
        for (const child of [...this.plane_group.children]) {
            this.plane_group.remove(child);
            child.geometry.dispose();
            child.material.dispose();
        }
        this.hover.visible = false;
        this.floor_grid.visible = !this.view;
        this.plane_group.visible = this.view !== null;
        if (this.view) {
            const { axis, side } = this.view;
            const size = [this.world.size.x, this.world.size.y, this.world.size.z];
            // Dimensions of the plane in the order of its local x and z axes (see the rotation below)
            const [w, h] = [[size[1], size[2]], [size[0], size[2]], [size[0], size[1]]][axis];
            const marker = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
                new THREE.MeshBasicMaterial({
                    color: this.plane_style.color,
                    transparent: true,
                    opacity: this.plane_style.opacity,
                    depthWrite: false,
                    // It lies exactly on the faces of the blocks of the plane; without the offset it is lost
                    // or kept depending on how the vertices of the chunks were rounded
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1,
                }),
            );
            this.plane_group.add(marker, make_grid(w, h));
            this.plane_group.rotation.set(axis === 2 ? Math.PI / 2 : 0, 0, axis === 0 ? -Math.PI / 2 : 0);
            const near_face = this.plane + (side > 0 ? 1 : 0);
            this.plane_group.position.copy(this.center);
            this.plane_group.position.setComponent(axis, near_face);
        }
        this.world_mesh.set_slice(this.view ? { axis: this.view.axis, index: this.plane, side: this.view.side } : null);
        this.on_view_change();
    }

    resize() {
        const parent = this.canvas.parentElement;
        const w = Math.max(1, parent.clientWidth);
        const h = Math.max(1, parent.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(w, h, false);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        const half = Math.max(this.world.size.x, this.world.size.y, this.world.size.z) * 0.85;
        const aspect = w / h;
        this.camera.left = -half * aspect;
        this.camera.right = half * aspect;
        this.camera.top = half;
        this.camera.bottom = -half;
        // Orthographic: everything between the near and far planes is drawn, so a big world needs deep ones
        this.camera.near = -(half * 2 + 500);
        this.camera.far = half * 2 + 500;
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
        if (this.view) {
            return this._pick_plane();
        }
        this.world_mesh.flush();
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

    /** 2D mode: the cell of the plane under the cursor, for placing and for removing. */
    _pick_plane() {
        const { axis } = this.view;
        const plane = new THREE.Plane(AXIS_VECTORS[axis], -(this.plane + 0.5));
        const point = new THREE.Vector3();
        if (!this.raycaster.ray.intersectPlane(plane, point)) {
            return { hit: null, place: null };
        }
        const cell = [Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)];
        cell[axis] = this.plane;
        return this.world.in_bounds(...cell) ? { hit: cell, place: cell } : { hit: null, place: null };
    }

    _buildable(cell) {
        return this.world.in_bounds(...cell) && !this.world.get(...cell);
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
                const target = e.button === 2 || e.altKey || this.erase ? hit : place;
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
            const { hit, place } = this.pick(e.clientX, e.clientY);
            const cell = this.erase ? hit : place;
            this.hover.material.color.set(this.erase ? 0xff4040 : 0xffff00);
            this.hover.visible = cell !== null;
            if (cell) {
                this.hover.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
            }
        });
        this.canvas.addEventListener("pointerleave", () => {
            this.hover.visible = false;
        });
    }

    /** @returns {Promise<Blob>} PNG of the current view */
    to_blob() {
        const plane_visible = this.plane_group.visible;
        this.hover.visible = false;
        this.plane_group.visible = false;
        this.world_mesh.flush();
        this.renderer.render(this.scene, this.camera);
        this.plane_group.visible = plane_visible;
        return new Promise(resolve => this.canvas.toBlob(resolve, "image/png"));
    }

    _frame(now) {
        if (this.animation) {
            this._step_animation(now);
        }
        else if (this.view) {
            // Leave the 2D view as soon as the camera is rotated away from the axis
            const direction = this.camera.position.clone().sub(this.controls.target).normalize();
            if (direction.dot(AXIS_VECTORS[this.view.axis]) * this.view.side < ALIGN_LIMIT) {
                this._exit_view();
            }
        }
        this.world_mesh.update();
        this.renderer.render(this.scene, this.camera);
        this.gizmo.draw();
        requestAnimationFrame(this._frame);
    }
}
