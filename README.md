# [Redstone-Modeler](https://undecentions.github.io/Redstone-Modeler)

![gif](logo_repeat.gif)

Modeler for redstone. Replacement for the old RS Editor. AKA "RSM."

## This fork: real 3D and your own resource packs

The main page (`index.html`) is now a real-time three.js editor. The old pre-rendered isometric editor is kept as `classic.html`; its saves are not compatible.

- **Bring your own resource packs.** Nothing from Minecraft is bundled. Open *Resource packs*, add one or more `.zip` packs (or a folder), put them in order and press *Compile and use*. Mod `.jar` files work too: only their `assets` are read (and those of mods inside them), never the classes. *Add Minecraft (official)* downloads the client jar of a release from Mojang into your browser when you click (it needs Mojang to allow the request from the page; if the browser refuses, add the `client.jar` from `.minecraft/versions/` yourself) and puts it at the bottom of the stack. A compiled `.rmpack` is recognised by what is in it, not by its name, and is opened on its own; it cannot be stacked with others.
- **Stacking.** Packs higher in the list override packs below them, file by file, like in Minecraft. Block states are the union of what all packs describe, so a redstone visualisation pack that models `powered` for blocks the vanilla pack never textures makes that property show up.
- **Block states** are read from the blockstate files (variants and multipart) and shown as dropdowns. A small table in `data/block_properties.json` adds vanilla properties that no pack file mentions.
- **Cached locally.** The compiled result (texture atlas, flattened models, state index) is stored in the browser's IndexedDB and loaded automatically next time. *Export* gives a `.rmpack` file you can import again instead of re-compiling the original zips.
- Left click places, right click removes, Alt+click picks the block under the cursor, `1`-`9` select the hotbar slot.
- **Eraser and clear.** Right click removes a block; the *Eraser* button (or `E`) makes left click remove too, which helps on touch screens. *Clear* wipes the whole model after a second click to confirm.
- **Settings.** The size of the model space (1 to 4096 per side; the world is kept in chunks of 16×16×16 and only the chunks that changed are built again, a big build is spread over several frames), the background colour and the colour and opacity of the 2D plane. They are remembered in the browser; save codes carry the size of the model space, so loading one resizes the space.
- **Mods and odd folder layouts.** The `assets` folder is looked for level by level (`assets/`, `Pack/assets/`, `repo/src/main/resources/assets/`, ...), so a zip or folder copied from a mod repository works, and so does picking the `assets` folder itself. Without an `assets` folder, folders that hold `blockstates`, `models` or `textures` are used. Several namespaces next to each other (`assets/minecraft`, `assets/create`, ...) stay separate, models and textures can refer to each other (`create:block/cog` with a `minecraft:block/cube_all` parent), and the block list gets a namespace filter.
- **Sharing.** *Share* packs the model together with the resources it uses: only the blocks that are placed, with their models and textures cut out of the loaded pack, and the block names of English and the chosen language. The result is a share code (`RMS1.` and base64) to copy, or a `.rmmodel` file for when the code is too long for a message (chats allow about 2000 characters). The other side opens it in *Load*, in the *Share* dialog or as a resource pack, needs none of your packs, and sees the same picture; it is kept in their browser as a pack called `… (shared)`. *Only the states used* is the smallest and lets the receiver edit within the states you placed, *every state of the blocks* lets them change states freely, *the whole compiled pack* sends the entire pack (the dialog shows where its size goes). The code contains textures from your resource packs, so only share what you may share. A `.rmmodel` is a `.rmpack` with a `world.json` in it.
  - **Compact encoding** (default): codes and uploads use a tighter format (`RMS2.`): one stream with a string table instead of repeated names, textures stored as palette indices or colour planes (whichever compresses best) without the border of the atlas, all deflated together. The receiver turns it back into the normal pack, so what is stored in the browser is the same. The dialog shows the size of both encodings; I could not measure real packs here, so look at those numbers.
  - **Minimal (lossy, off by default)**: on top of that, at most 256 colours, and block ids, states, models and textures become short codes that are never shown; the blocks are found only by their names from the language files.
  - **Copy share link**: uploads the share to a network clipboard (mclo.gs, or pastes.dev), reads it back to check that nothing was changed, and copies `…/#share=<service>.<id>`. Opening that link, or pasting it into *Load*, fetches and opens the model. The first upload asks for agreement, because anyone with the link can read the content. Whether these services allow requests from the page (CORS), keep content as is, and for how long is outside this project: the tests use stand-ins, so try it once on the deployed site. If it fails, the code and the file still work.
- **Languages.** The interface is available in English and 简体中文; *Settings* → *Language* picks one, *Automatic* follows the browser. Block names are read from the language files of the resource packs (`assets/<namespace>/lang/<language>.json`, newer than Minecraft 1.13), stacked like everything else, so a vanilla pack gives names in every language of the game. *Block names* in the settings picks the language that is shown and searched in addition to English (Chinese by default): searching `石头`, `stone` or `Stone` all find the block, and the id is searched as well. Picking a block shows its name above the hotbar for a moment. Pack states are translated into Chinese with our own wording (the game has none); the real keys stay in the tooltips. An older compiled pack has no names until it is compiled again.
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
