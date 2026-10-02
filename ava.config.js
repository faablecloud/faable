export default {
  files: ["src/**/*.test.ts"],
  // The end-to-end tests spawn the CLI (and the MCP server) through tsx; on a
  // busy CI runner that outlasts ava's 10s default without any test failing.
  timeout: "2m",
  extensions: ["ts"],
  nodeArguments: [
    "--import",
    "tsx"
  ]
};
