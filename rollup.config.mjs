import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import copy from "rollup-plugin-copy";
import generatePackageJson from "rollup-plugin-generate-package-json";

export default {
  input: "src/index.ts",
  output: {
    file: "pkg/dist/faable.js",
    format: "cjs",
    exports: "named",
    preserveModules: false,
    preserveModulesRoot: "src",
  },
  plugins: [
    json(),
    typescript(),
    commonjs(),
    nodeResolve(),
    copy({
      targets: [
        { src: "README.md", dest: "pkg" },
        { src: "bin/*", dest: "pkg/bin" },
      ],
    }),
    generatePackageJson({
      outputFolder: "pkg",
      baseContents: (pkg) => ({
        name: pkg.name,
        main: pkg.main,
        dependencies: pkg.dependencies,
        bin: {
          faable: "bin/faable",
        },
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
