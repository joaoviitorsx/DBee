import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      // spike do dia 1: script de validação, tem o próprio tsconfig e deps
      "scratch/**",
    ],
  },

  js.configs.recommended,

  // strictTypeChecked é o motivo de ter escolhido typescript-eslint: as regras
  // type-aware (no-floating-promises, no-misused-promises) são as que pegam
  // transação perdida e conexão vazada.
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CLAUDE.md regra 1: nada de `any`, nem implícito nem explícito.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      // Uma promise solta no backend é transação que nunca fecha.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      // Número em template literal é seguro e legível; o resto da regra fica.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },

  {
    files: ["apps/server/**/*.ts"],
    languageOptions: { globals: globals.node },
  },

  {
    files: ["apps/web/**/*.{ts,tsx}"],
    // rules-of-hooks e exhaustive-deps ligados desde o primeiro componente:
    // regra preventiva instalada depois é regra instalada depois de já ter
    // podido errar.
    extends: [reactHooks.configs.flat["recommended-latest"]],
    languageOptions: { globals: globals.browser },
  },

  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
