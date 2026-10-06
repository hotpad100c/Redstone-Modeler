// Starts the editor. The editor itself is loaded with a dynamic import so that any problem while
// loading it (an old browser, a missing feature, a broken file) is shown on the page instead of
// leaving a dead interface.
const boot = window.__rm_boot ?? { note: message => console.error(message) };

function has_webgl2() {
    try {
        return Boolean(document.createElement("canvas").getContext("webgl2"));
    }
    catch {
        return false;
    }
}

if (!has_webgl2()) {
    boot.note("This browser does not support WebGL 2, which the 3D view needs. Safari 15 or newer is required; also check that WebGL is not disabled.");
}
else {
    try {
        await import("./editor.mjs");
    }
    catch (error) {
        boot.note(`The editor could not start: ${error?.message ?? error}`);
        throw error;
    }
}
