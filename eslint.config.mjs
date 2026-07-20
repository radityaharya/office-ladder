import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores([
    "dist/**",
    "build/**",
    "src/routeTree.gen.ts",
    ".agents/**",
    ".claude/**",
    ".cursor/**",
    ".impeccable/**",
  ]),
]);

export default eslintConfig;
