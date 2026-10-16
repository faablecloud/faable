export default {
  files: ["src/**/*.test.ts"],
  // The end-to-end tests spawn the CLI (and the MCP server) through tsx; on a
  // busy CI runner that outlasts ava's 10s default without any test failing.
  timeout: "2m",
  // No test waits for a real URL to answer after a deploy (commands/deploy/
  // reachable.ts): the stub apps' hosts are not ours. Inherited by every CLI
  // and MCP server the tests spawn.
  environmentVariables: { FAABLE_REACHABLE_TIMEOUT_MS: "0" },
  extensions: ["ts"],
  nodeArguments: [
    "--import",
    "tsx"
  ]
};
