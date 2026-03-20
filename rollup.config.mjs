import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import copy from "rollup-plugin-copy";
import autoExternal from "rollup-plugin-auto-external";

export default {
  input: "src/index.ts",
  output: {
    dir: "dist",
    format: "esm",
    exports: "named",
    preserveModules: true,
    preserveModulesRoot: "src",
  },
  plugins: [
    autoExternal(),
    json(),
    typescript(),
    // commonjs(),
    // nodeResolve(),
    copy({
      targets: [
        {
          src: "src/commands/deploy/node-pipeline/templates/**/*",
          dest: "dist/commands/deploy/node-pipeline/templates",
        },
      ],
    })
  ],
};
