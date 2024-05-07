module.exports = {
  files: ["src/**/*.test.ts"],
  typescript: {
    extensions: ["ts", "tsx"],
    rewritePaths: {
      "src/": "dist/",
    },
    compile: "tsc",
  },
};
