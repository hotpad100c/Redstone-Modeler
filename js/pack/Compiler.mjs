import { block_properties } from "./BlockStates.mjs";
import { ModelResolver } from "./Models.mjs";
import { asset_path, normalize_id } from "./PackStack.mjs";

/**
 * Model ids used by blockstate files.
 * @param {object} def
 */
function model_ids(def) {
    const ids = [];
    const take = (entry) => {
        for (const variant of Array.isArray(entry) ? entry : [entry]) {
            if (variant?.model) {
                ids.push(variant.model);
            }
        }
    };
    Object.values(def.variants ?? {}).forEach(take);
    (def.multipart ?? []).forEach(part => take(part.apply));
    return ids;
}

/**
 * True when none of the models the blockstate files use has any geometry.
 * @param {object[]} defs
 * @param {ModelResolver} resolver
 */
function is_entity_only(defs, resolver) {
    const ids = defs.flatMap(model_ids);
    return ids.length > 0 && ids.every((id) => {
        const model = resolver.resolve(id);
        return model && model.elements.length === 0;
    });
}

/**
 * Reads every blockstate in the stack and everything it references.
 * Pure data work, no images, so it runs anywhere.
 * @param {import("./PackStack.mjs").PackStack} stack
 * @param {Record<string, Record<string, string[]>>} [extra_properties] Short block name to property table
 * @param {{blockstates: Record<string, object>, models: Record<string, object>}} [fallback]
 *   Models for blocks the game draws with entity code. They only apply to blocks whose
 *   models in the packs have no elements.
 */
export function collect(stack, extra_properties = {}, fallback = { blockstates: {}, models: {} }) {
    const resolver = new ModelResolver(id => stack.json(asset_path("models", id, "json")) ?? fallback.models[id]);
    const blockstates = {};
    const index = {};
    const models = {};
    const textures = new Set();

    for (const name of stack.list_ids("blockstates", "json").sort()) {
        let defs = stack.json_all(asset_path("blockstates", name, "json"))
            .filter(def => def && typeof def === "object" && (def.variants || def.multipart));
        if (defs.length === 0) {
            continue;
        }
        const short = name.startsWith("minecraft:") ? name.slice("minecraft:".length) : name;
        const substitute = name.startsWith("minecraft:") ? fallback.blockstates[short] : undefined;
        if (substitute && is_entity_only(defs, resolver)) {
            defs = [substitute];
        }
        blockstates[name] = defs;
        index[name] = block_properties(defs, extra_properties[short]);
        for (const def of defs) {
            for (const id of model_ids(def)) {
                const key = normalize_id(id);
                if (!(key in models)) {
                    const model = resolver.resolve(key);
                    models[key] = model;
                    for (const element of model?.elements ?? []) {
                        for (const face of Object.values(element.faces)) {
                            if (face.texture) {
                                textures.add(face.texture);
                            }
                        }
                    }
                    if (model?.particle) {
                        textures.add(model.particle);
                    }
                }
            }
        }
    }
    for (const key of Object.keys(models)) {
        if (models[key] === null) {
            delete models[key];
        }
    }
    return { blockstates, index, models, textures: [...textures].sort() };
}
