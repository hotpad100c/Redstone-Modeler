import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, normalize } from "../js/model/Settings.mjs";
import { action_for, hover_target } from "../js/model/Input.mjs";

test("Minecraft buttons: left breaks, right places, middle and Alt pick", () => {
    assert.equal(action_for({ button: 0 }), "break");
    assert.equal(action_for({ button: 2 }), "place");
    assert.equal(action_for({ button: 1 }), "pick");
    assert.equal(action_for({ button: 0, alt: true }), "pick");
    assert.equal(action_for({ button: 0, erase: true }), "break");
    assert.equal(action_for({ button: 2, erase: true }), "place", "the eraser changes the left button only");
    assert.equal(action_for({ button: 3 }), null);
});

test("classic buttons: left places, right breaks", () => {
    const classic = { mapping: "classic" };
    assert.equal(action_for({ ...classic, button: 0 }), "place");
    assert.equal(action_for({ ...classic, button: 2 }), "break");
    assert.equal(action_for({ ...classic, button: 1 }), "pick");
    assert.equal(action_for({ ...classic, button: 0, alt: true }), "pick");
    assert.equal(action_for({ ...classic, button: 0, erase: true }), "break");
});

test("a finger taps to place and holds to break, with either mapping", () => {
    for (const mapping of ["minecraft", "classic"]) {
        for (const type of ["touch", "pen"]) {
            assert.equal(action_for({ type, mapping }), "place");
            assert.equal(action_for({ type, mapping, long: true }), "break");
            assert.equal(action_for({ type, mapping, erase: true }), "break", "the eraser makes a tap break");
        }
    }
});

test("the outline shows the block that would be hit, in the classic mapping the cell next to it", () => {
    assert.equal(hover_target({ mapping: "minecraft", erase: false }), "hit");
    assert.equal(hover_target({ mapping: "classic", erase: false }), "place");
    assert.equal(hover_target({ mapping: "classic", erase: true }), "hit");
});

test("the settings for controls are checked", () => {
    assert.equal(DEFAULTS.mouse_mapping, "minecraft");
    assert.equal(normalize({}).mouse_mapping, "minecraft");
    assert.equal(normalize({ mouse_mapping: "classic" }).mouse_mapping, "classic");
    assert.equal(normalize({ mouse_mapping: "nonsense" }).mouse_mapping, "minecraft");
    assert.equal(normalize({ fly_speed: 100 }).fly_speed, 30);
    assert.equal(normalize({ fly_speed: 0 }).fly_speed, 2);
    assert.equal(normalize({ fly_speed: "abc" }).fly_speed, 8);
    assert.equal(normalize({ fly_speed: null }).fly_speed, 8);
    assert.equal(normalize({ look_sensitivity: 9 }).look_sensitivity, 3);
    assert.equal(normalize({ look_sensitivity: "0.5" }).look_sensitivity, 0.5);
});
