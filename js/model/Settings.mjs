export const SIZE_LIMITS = { min: 1, max: 64 };

export const DEFAULTS = Object.freeze({
    size: Object.freeze({ x: 20, y: 20, z: 20 }),
    background: "#404040",
    plane_color: "#4488ff",
    plane_opacity: 0.12,
});

const STORAGE_KEY = "redstone-modeler.settings";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * True for a size every axis of which is a whole number within the limits.
 * @param {unknown} size
 */
export function valid_size(size) {
    return size !== null && typeof size === "object"
        && ["x", "y", "z"].every(axis => Number.isInteger(size[axis])
        && size[axis] >= SIZE_LIMITS.min && size[axis] <= SIZE_LIMITS.max);
}

/**
 * Turns whatever was stored into valid settings; anything wrong falls back to the default.
 * @param {unknown} raw
 */
export function normalize(raw) {
    const input = raw !== null && typeof raw === "object" ? raw : {};
    const size = {};
    for (const axis of ["x", "y", "z"]) {
        const value = Number(input.size?.[axis]);
        size[axis] = Number.isFinite(value)
            ? Math.min(SIZE_LIMITS.max, Math.max(SIZE_LIMITS.min, Math.round(value)))
            : DEFAULTS.size[axis];
    }
    const opacity = Number(input.plane_opacity);
    return {
        size,
        background: HEX_COLOR.test(input.background) ? input.background.toLowerCase() : DEFAULTS.background,
        plane_color: HEX_COLOR.test(input.plane_color) ? input.plane_color.toLowerCase() : DEFAULTS.plane_color,
        plane_opacity: Number.isFinite(opacity) && input.plane_opacity !== null && input.plane_opacity !== ""
            ? Math.min(1, Math.max(0, opacity))
            : DEFAULTS.plane_opacity,
    };
}

export function load() {
    try {
        return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    }
    catch {
        return normalize(null);
    }
}

export function save(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    catch {
        // Storage blocked or full; settings just will not persist
    }
}
