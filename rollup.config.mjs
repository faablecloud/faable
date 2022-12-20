import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";

export default {
  input: "src/index.ts",
  output: {
    file: "pkg/dist/faable.js",
    format: "cjs",
    exports: "named",
    preserveModules: false,
    preserveModulesRoot: "src",
  },
  plugins: [json(), typescript(), commonjs(), nodeResolve()],
};
