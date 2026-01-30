import tseslint from "typescript-eslint";
import eslint from "@eslint/js";
import NoWarningsEslintPlugin from "eslint-plugin-only-warn";
import EslintPrettierPlugin from "eslint-config-prettier";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    EslintPrettierPlugin,
    {
        plugins: { "no-warning": NoWarningsEslintPlugin },
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
        },
        files: ["**/*.ts"],
    },
);
