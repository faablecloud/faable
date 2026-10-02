import { CommandModule } from 'yargs'
import { serve_stdio } from '../../mcp/server'

interface McpArgs {
  writes?: boolean
}

// `faable mcp` — this CLI as an MCP server, over stdio, for Claude Code,
// Cursor and any MCP client:
//
//   claude mcp add faable -- npx -y @faable/faable mcp
//
// It acts with the `faable login` session (or FAABLE_TOKEN), and every tool is
// one run of this same CLI (src/mcp/run_cli.ts). stdout is the protocol from
// here on: nothing else may print there.
export const mcp: CommandModule<unknown, McpArgs> = {
  command: 'mcp',
  describe: 'Run the Faable MCP server (stdio) for AI agents and editors',
  builder: yargs =>
    yargs
      .option('writes', {
        type: 'boolean',
        default: false,
        description:
          'Also expose the reversible writes: create apps, set secrets, add domains, retry or cancel builds, change deploy settings'
      })
      .example(
        'claude mcp add faable -- npx -y @faable/faable mcp',
        'Add it to Claude Code (read-only + deploy)'
      )
      .example(
        'claude mcp add faable -- npx -y @faable/faable mcp --writes',
        'With the reversible writes'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    await serve_stdio({ writes: args.writes })
  }
}
