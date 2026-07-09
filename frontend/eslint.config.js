import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/api/types.gen.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      import: importPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "import/no-default-export": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // React components are the one allowed default-export case (CLAUDE.md style rule).
    files: ["src/**/*.tsx"],
    rules: {
      "import/no-default-export": "off",
    },
  },
  {
    // Vite's own config loader requires a default export here.
    files: ["vite.config.ts"],
    rules: {
      "import/no-default-export": "off",
    },
  }
);
