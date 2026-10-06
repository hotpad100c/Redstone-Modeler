import globals from "globals";
import pluginJs from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";

export default [
    { languageOptions: { globals: globals.browser } },
    { files: ["tests/**"], languageOptions: { globals: globals.node } },
    { ignores: ["lib/**"] },
    pluginJs.configs.recommended,
    { rules: { eqeqeq: ["error", "always"] } },
    stylistic.configs.customize({
        indent: 4,
        quotes: "double",
        semi: true,
        jsx: false,
    }),
];
