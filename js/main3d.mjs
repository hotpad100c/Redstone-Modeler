import { World } from "./model/World.mjs";
import { Scene } from "./render/Scene.mjs";

const PLACEHOLDER_BLOCKS = [
    "minecraft:stone",
    "minecraft:dirt",
    "minecraft:oak_planks",
    "minecraft:redstone_block",
    "minecraft:glass",
    "minecraft:lapis_block",
];

const world = new World({ x: 20, y: 20, z: 20 });
const scene = new Scene(document.getElementById("canvas3d"), world);
let selected = PLACEHOLDER_BLOCKS[0];

const palette = document.getElementById("palette");
for (const name of PLACEHOLDER_BLOCKS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name.replace("minecraft:", "");
    button.addEventListener("click", () => {
        selected = name;
        for (const b of palette.children) {
            b.classList.toggle("selected", b === button);
        }
    });
    palette.appendChild(button);
}
palette.firstChild.classList.add("selected");

const layer_number = document.getElementById("layer_number");
function change_layer(delta) {
    scene.set_layer(scene.layer + delta);
    layer_number.textContent = `y = ${scene.layer}`;
}
document.getElementById("layer_up").addEventListener("click", () => change_layer(1));
document.getElementById("layer_down").addEventListener("click", () => change_layer(-1));
layer_number.textContent = `y = ${scene.layer}`;

scene.on_click = (x, y, z, button) => {
    if (button === 2) {
        world.remove(x, y, z);
    }
    else if (button === 0) {
        world.set(x, y, z, { name: selected, props: {} });
    }
};

// Exposed for tests and debugging.
window.__rm = { world, scene };
