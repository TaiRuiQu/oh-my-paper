import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["src/{components,contracts,lib}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/**", "@/generated/**"],
              message:
                "Keep browser-safe modules independent of server implementations. Use shared contracts for data and API calls for operations.",
            },
          ],
        },
      ],
    },
  },
  // Prettier owns formatting; keep this after the other rule sets.
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "src/generated/**",
    ".tools/**",
    ".local/**",
    ".venv/**",
    ".agents/**",
    ".impeccable/**",
    "storage/**",
    "tmp/**",
    "next-env.d.ts",
  ]),
]);
