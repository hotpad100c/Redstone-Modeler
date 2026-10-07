import globals from "globals";
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";

const style = stylistic.configs.customize({
    indent: 4,
    quotes: "double",
    semi: true,
    jsx: false,
});

export default [
    { ignores: ["lib/**"] },
    { languageOptions: { globals: globals.browser } },
    { files: ["tests/**"], languageOptions: { globals: globals.node } },
    js.configs.recommended,
    style,
    { rules: { eqeqeq: ["error", "always"] } },
];
