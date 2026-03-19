import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended, // Configuración básica de ESLint
  {
    files: ["**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser, // Parser para TypeScript
      sourceType: "module",
      globals: {
        // Define las variables globales del entorno del navegador
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules, // Reglas de TypeScript
      "no-console": ["error", { allow: ["warn", "error"] }], // Prohíbe console.log pero permite otros métodos
      "no-redeclare": "off", // TypeScript handles this and TypeBox patterns trigger it
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off", // This codebase uses 'any' in test helpers and some plugins
      "@typescript-eslint/no-this-alias": "off", // Fastify decorators frequently use 'const req = this'
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {},
  },
  prettierConfig,
];
