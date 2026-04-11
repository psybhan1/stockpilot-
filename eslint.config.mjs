import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".test-build/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
    "n8n/.n8n/**",
    "n8n/runtime/**",
    "n8n/node_modules/**",
    "n8n/tools/**",
    "n8n/*.log",
  ]),
]);

export default eslintConfig;
