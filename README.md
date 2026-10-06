# [Redstone-Modeler](https://undecentions.github.io/Redstone-Modeler)

![gif](logo_repeat.gif)

Modeler for redstone. Replacement for the old RS Editor. AKA "RSM."

## This fork: real 3D and your own resource packs

The main page (`index.html`) is now a real-time three.js editor. The old pre-rendered isometric editor is kept as `classic.html`; its saves are not compatible.

- **Bring your own resource packs.** Nothing from Minecraft is bundled. Open *Resource packs*, add one or more `.zip` packs (or a folder), put them in order and press *Compile and use*.
- **Stacking.** Packs higher in the list override packs below them, file by file, like in Minecraft. Block states are the union of what all packs describe, so a redstone visualisation pack that models `powered` for blocks the vanilla pack never textures makes that property show up.
- **Block states** are read from the blockstate files (variants and multipart) and shown as dropdowns. A small table in `data/block_properties.json` adds vanilla properties that no pack file mentions.
- **Cached locally.** The compiled result (texture atlas, flattened models, state index) is stored in the browser's IndexedDB and loaded automatically next time. *Export* gives a `.rmpack` file you can import again instead of re-compiling the original zips.
- Left click places, right click removes, Alt+click picks the block under the cursor, `1`-`9` select the hotbar slot.
- **Eraser and clear.** Right click removes a block; the *Eraser* button (or `E`) makes left click remove too, which helps on touch screens. *Clear* wipes the whole model after a second click to confirm.
- **Settings.** The size of the model space (1 to 64 per side), the background colour and the colour and opacity of the 2D plane. They are remembered in the browser; save codes carry the size of the model space, so loading one resizes the space.
- **Mods and odd folder layouts.** The `assets` folder is looked for level by level (`assets/`, `Pack/assets/`, `repo/src/main/resources/assets/`, ...), so a zip or folder copied from a mod repository works, and so does picking the `assets` folder itself. Without an `assets` folder, folders that hold `blockstates`, `models` or `textures` are used. Several namespaces next to each other (`assets/minecraft`, `assets/create`, ...) stay separate, models and textures can refer to each other (`create:block/cog` with a `minecraft:block/cube_all` parent), and the block list gets a namespace filter.
- **Browsers.** Needs a browser with ES modules, top-level `await` and WebGL 2: Safari 15 or newer, current Chrome, Firefox and Edge. If the editor cannot start, the page shows a red banner with the reason, the browser and the build id, instead of staying dead. iOS cannot pick folders, so use a zip there.
- **Phones.** Double-tap zoom and page pinch zoom are off, so quick repeated taps place blocks; pinching inside the model view still zooms the camera.
- **Axis ball** (top right, like Blender): click an axis to look along it, click the centre for the default view. Numpad `7`/`1`/`3` give top/front/right views, with Ctrl the opposite side, `5` the default view.
- **2D views.** Looking along an axis turns the editor into a 2D editor: a plane through the middle of the cube is where you place blocks, `-` / `+` (or `[` / `]`) move it. Blocks in front of the plane are hidden and blocks behind it are dimmed. Rotating the camera leaves the 2D view.
- **State bar.** The *States* button above the hotbar shows a picture of every state combination of the held block. Click one to use it, filter by property, or hide combinations that look the same.

Deployment: `scripts/build-site.sh <folder> <build id>` assembles the site and adds the build id to the address of every file of the editor, so a visitor never gets new pages with old cached modules. GitHub Pages runs it on every push to `main`; `SITE_ROOT=<folder> npm run test:e2e` tests an assembled site.

Development: `npm test` (unit tests), `npm run lint`, `npm run test:e2e` (needs Playwright and Chromium; `BROWSER=webkit npm run test:e2e` runs it in WebKit if installed). Tests use tiny synthetic packs generated in `tests/fixtures.mjs`.

## Why not RS Editor?
[RS Editor](https://github.com/11-90-an/rseditor) has been *the* tool for sending redstone diagrams in chat, usually Discord. However, it has been lacking a large number of features, which RSM attempts to fix.

## Wow, RSM&hellip;
RSM seems to be such a common abbreviation, but no matter if it's the mod, the person, math, or whatever, we have another one.

## Features
- 3D. Yes. It's here. No, not perspective 3D. just 3D.
- Isometric textures. Gives a semi-3D feel, useful for flat textures such as redstone dust and 3D-ness
- One click copy. No more screenshotting, just press the button.
- UI. Smaller selection, individual scrolling. Nice for mobile, where RS Editor's selection would span more than the screen width, and scrolling back and forth is required.
- Hotbar. No endless scrolling through the selection. Slot number may change.
- Block states. Click on an existing block with itself to get to the next state. Instead of each texture individually appearing in the selection, there are block states. No need for 192 redstone dust in the selection to do all the states (note: not all dust textures have been added).
- 2D block states. Select the state with a temporary panel, then put it down, instead of clicking 5 times each on some pistons. The second dimension is used for blocks like redstone dust, where clicking hundreds of times is impractical. Instead, there are 2 selection bars for each signal strength and shape, 30 * 16.
- Preview on hover. Detail, but useful when working in 3D models. Note that the hover does not update on scroll, although not important.
- Drag. No more spam clicking while moving the mouse around. On mobile, scroll with 2 fingers. Note that because of the number of events sent, if you drag too fast, some blocks might be missed. Likely, the best solution is to draw lines between points, but that is not a priority.
- Saving. Uses LZMA ([LZMA-JS](https://github.com/LZMA-JS/LZMA-JS)) so that the code is not hundreds of thousands of characters long. This feature was present in RS Editor, but it was on URL, and in my opinion this is better, and since this is 3D there must be compression. Saving was recently reworked to use a schema, which should be very future-proof.

## How am I supposed to use this???
With all those features, RSM may get confusing fairly quickly.

First, you have the selection. Press something in the selection (bottom), and then the hotbar (second bar from bottom), and it'll set that slot.

Have that hotbar slot selected (selector slot also works&mdash;more frequent stuff go in the hotbar though), and you can click on the model to place the block. Click again (for some blocks), and it'll go to the next texture.

Through the 2D selection panel, select a block state (hide the panel by pressing on the hotbar item again). Press the layer buttons to toggle through them.

Finally, press the copy or save button when you're finished. 

## To do
- Change the texture rendering slant angle to make it look clearer.
- Keybinds.
- Logo duration tweak, likely to shorten it.
- Model automatically resizes when you reach an edge.
- Settings and other panels: edit model size, keybinds, and other stuff.
- Tweaking top bar to make it shorter (more mobile friendly), perhaps with icons.

## Any bugs or suggestions?
Either go on the [project Discord](https://discord.gg/2Qndd5v6JF) (for minor problems) or open an issue on this GitHub page. Code readability and structure suggestions are welcome, but don't do minor style stuff such as double vs single quotes.

## RS Editor
Thanks to RS Editor for the inspiration of this project. Code was consulted, but I decided that it was not very usable since this one had completely different logic, and p5.js is unneccesary. The old project can be found at the [RS Editor github page](https://github.com/11-90-an/rseditor).
