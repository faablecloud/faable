import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import copy from "rollup-plugin-copy";
import generatePackageJson from "rollup-plugin-generate-package-json";
import autoExternal from "rollup-plugin-auto-external";

export default {
  input: "src/index.ts",
  output: {
    dir: "pkg/dist",
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
        { src: "README.md", dest: "pkg" },
        { src: "bin/*", dest: "pkg/bin" },
        { src: "templates/**/*", dest: "pkg/templates" },
      ],
    }),
    generatePackageJson({
      outputFolder: "pkg",
      baseContents: (pkg) => ({
        name: pkg.name,
        main: pkg.main,
        dependencies: pkg.dependencies,
        version: pkg.version,
        bin: {
          faable: "bin/faable.js",
        },
        type: "module",
        license: "MIT",
        author: "Marc Pomar <marc@faable.com>",
        types: "./dist/index.d.ts",
        bugs: {
          url: "https://github.com/faablecloud/faable/issues",
        },
        publishConfig: {
          access: "public",
        },
        homepage: "https://github.com/faablecloud/faable#readme",
      }),
    }),
  ],
};
