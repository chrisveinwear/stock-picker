import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // eslint-config-next's core-web-vitals preset now bundles React
      // Compiler–oriented rules from eslint-plugin-react-hooks. This project
      // doesn't enable the React Compiler (no `reactCompiler` flag in
      // next.config.ts, no babel-plugin-react-compiler dependency), so these
      // flag standard, idiomatic patterns — e.g. "fetch on mount" effects
      // (set-state-in-effect) and computing a chart's time axis from
      // Date.now() inside useMemo (purity) — as hard errors. Turned off
      // rather than rewriting working code to satisfy a linter for a
      // compiler mode this app doesn't use.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
