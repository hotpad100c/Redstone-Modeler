import assert from "node:assert/strict";
import { test } from "node:test";
import { DOUBLE_TAP_MS, DRAG_PX, FlyCamera, KeyAxes, PITCH_LIMIT, TAP_MS, TouchGestures, direction_of, stick_axes } from "../js/render/FirstPerson.mjs";
import { LONG_PRESS_MS, REPEAT_MS } from "../js/model/Input.mjs";

const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message ?? ""} ${a} is not ${b}`);
const still = { forward: 0, right: 0, up: 0 };

test("yaw 0 looks along -z, turning left (a drag to the left turns it to the left) goes towards -x", () => {
    const [x, y, z] = direction_of(0, 0);
    near(x, 0);
    near(y, 0);
    near(z, -1);
    const camera = new FlyCamera();
    camera.look(-100, 0, 0.01); // the mouse moves left: yaw grows, the view turns left
    const [dx, , dz] = camera.direction();
    assert.ok(dx < 0 && dz < 0, `${dx} ${dz}`);
    camera.look(200, 0, 0.01);
    assert.ok(camera.direction()[0] > 0);
});

test("looking up and down stops short of straight up and straight down", () => {
    const camera = new FlyCamera();
    camera.look(0, -100000, 0.01);
    assert.equal(camera.pitch, PITCH_LIMIT);
    camera.look(0, 100000, 0.01);
    assert.equal(camera.pitch, -PITCH_LIMIT);
    assert.ok(camera.direction()[1] > -1);
});

test("the yaw stays within one turn however long one turns", () => {
    const camera = new FlyCamera();
    for (let i = 0; i < 1000; i++) {
        camera.look(37, 0, 0.01);
    }
    assert.ok(Math.abs(camera.yaw) <= Math.PI + 1e-9);
});

test("W flies the way the view is turned, level, even when looking up or down", () => {
    const camera = new FlyCamera({ position: [10, 5, 10] });
    camera.update(1, { forward: 1, right: 0, up: 0 }, 8);
    near(camera.position[0], 10);
    near(camera.position[2], 2, "8 blocks towards -z");
    camera.pitch = 1;
    camera.update(1, { forward: 1, right: 0, up: 0 }, 8);
    near(camera.position[1], 5, "looking up does not lift it");
    near(camera.position[2], -6);
    camera.yaw = Math.PI / 2; // turned a quarter to the left: forward is -x
    camera.update(0.5, { forward: 1, right: 0, up: 0 }, 8);
    near(camera.position[0], 6);
    camera.update(0.5, { forward: 0, right: 1, up: 0 }, 8); // right of that is -z
    near(camera.position[2], -10);
});

test("space and shift go straight up and down, a diagonal is not faster, nothing in the way stops it", () => {
    const camera = new FlyCamera();
    camera.update(1, { forward: 0, right: 0, up: 1 }, 4);
    near(camera.position[1], 4);
    camera.update(2, { forward: 0, right: 0, up: -1 }, 4);
    near(camera.position[1], -4, "flies below the floor, there is no collision");
    const diagonal = new FlyCamera();
    diagonal.update(1, { forward: 1, right: 1, up: 0 }, 8);
    near(Math.hypot(...diagonal.position), 8);
    diagonal.update(1, still, 8);
    near(Math.hypot(...diagonal.position), 8, "standing still stays still");
});

test("aim looks from one point at another", () => {
    const camera = new FlyCamera();
    camera.aim([0, 0, 10], [0, 0, 0]);
    near(camera.direction()[2], -1);
    camera.aim([10, 10, 10], [0, 0, 0]);
    const [x, y, z] = camera.direction();
    assert.ok(x < 0 && y < 0 && z < 0);
    near(Math.hypot(x, y, z), 1);
});

test("keys: WASD, space and shift, and a double tap on W sprints until W is let go", () => {
    const keys = new KeyAxes();
    keys.press("KeyW", 0);
    keys.press("KeyD", 0);
    assert.deepEqual(keys.axes(), { forward: 1, right: 1, up: 0 });
    keys.press("Space", 0);
    keys.press("ShiftLeft", 0);
    assert.equal(keys.axes().up, 0, "both cancel");
    keys.release("ShiftLeft");
    assert.equal(keys.axes().up, 1);
    keys.press("KeyS", 0);
    assert.equal(keys.axes().forward, 0);
    assert.equal(keys.sprinting, false);
    keys.release("KeyW");
    keys.press("KeyW", DOUBLE_TAP_MS - 1);
    assert.equal(keys.sprinting, true);
    keys.press("KeyW", DOUBLE_TAP_MS + 50); // a key that repeats is not another press
    assert.equal(keys.sprinting, true);
    keys.release("KeyW");
    assert.equal(keys.sprinting, false);
    keys.press("KeyW", 2000);
    assert.equal(keys.sprinting, false, "too long after the last press");
    keys.clear();
    assert.deepEqual(keys.axes(), still);
});

test("the stick: a dead middle, all the way at the radius, forward is up on the screen", () => {
    assert.deepEqual(stick_axes(1, 1, 50), { forward: 0, right: 0 });
    const up = stick_axes(0, -50, 50);
    near(up.forward, 1);
    near(up.right, 0);
    const half = stick_axes(25, 0, 50);
    near(half.right, 0.5);
    const far = stick_axes(500, 0, 50);
    near(far.right, 1, "beyond the radius it is all the way over, not faster");
    const back = stick_axes(0, 50, 50);
    near(back.forward, -1);
});

test("a finger that stays and lifts is a tap, a late one is not", () => {
    const touch = new TouchGestures();
    touch.down(1, 100, 100, 0);
    assert.deepEqual(touch.up(1, TAP_MS - 1), { tap: [100, 100] });
    touch.down(1, 100, 100, 0);
    assert.equal(touch.up(1, TAP_MS + 1), null);
    touch.down(1, 100, 100, 0);
    touch.move(1, 100 + DRAG_PX - 1, 100);
    assert.deepEqual(touch.up(1, 100), { tap: [100 + DRAG_PX - 1, 100] }, "a shake of the hand is still a tap");
});

test("a finger that stays breaks after the long press, and keeps breaking, and lifting it then does nothing", () => {
    const touch = new TouchGestures();
    touch.down(1, 50, 60, 1000);
    assert.equal(touch.tick(1000 + LONG_PRESS_MS - 1), null);
    assert.deepEqual(touch.tick(1000 + LONG_PRESS_MS), { hold: [50, 60], first: true });
    assert.equal(touch.tick(1000 + LONG_PRESS_MS + 10), null, "not again at once");
    const again = touch.tick(1000 + LONG_PRESS_MS + REPEAT_MS + 60);
    assert.deepEqual(again?.hold, [50, 60]);
    assert.equal(again.first, false);
    assert.equal(touch.up(1, 1000 + LONG_PRESS_MS + 500), null, "no tap after a hold");
});

test("a finger that moves turns the view, and neither taps nor breaks", () => {
    const touch = new TouchGestures();
    touch.down(1, 100, 100, 0);
    assert.equal(touch.move(1, 103, 100), null, "still within the shake of a hand");
    assert.deepEqual(touch.move(1, 100 + DRAG_PX, 100), { look: [DRAG_PX - 3, 0] });
    assert.deepEqual(touch.move(1, 120, 110), { look: [12, 10] });
    assert.equal(touch.tick(LONG_PRESS_MS * 3), null, "no hold after turning");
    assert.equal(touch.up(1, 100), null);
});

test("a second finger spoils the first: nothing is built, the view is not turned by a pinch", () => {
    const touch = new TouchGestures();
    touch.down(1, 100, 100, 0);
    touch.down(2, 200, 200, 10);
    assert.equal(touch.tick(LONG_PRESS_MS * 2), null);
    assert.equal(touch.move(1, 160, 100), null);
    assert.equal(touch.move(2, 260, 200), null);
    assert.equal(touch.up(2, 50), null);
    assert.equal(touch.up(1, 60), null);
    // After both are up, a new finger is a fresh start
    touch.down(3, 5, 5, 1000);
    assert.deepEqual(touch.up(3, 1100), { tap: [5, 5] });
});

test("unknown fingers and clearing", () => {
    const touch = new TouchGestures();
    assert.equal(touch.move(9, 1, 1), null);
    assert.equal(touch.up(9, 1), null);
    touch.down(1, 0, 0, 0);
    touch.clear();
    assert.equal(touch.tick(LONG_PRESS_MS * 2), null);
    touch.down(2, 0, 0, 0);
    touch.cancel(2);
    assert.equal(touch.up(2, 10), null);
});
