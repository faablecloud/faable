import { CommandModule } from 'yargs'
import { serve_http } from '../../mcp/http'
import { serve_stdio } from '../../mcp/server'

interface McpArgs {
  writes?: boolean
  http?: boolean
  port?: number
}

// `faable mcp` — this CLI as an MCP server, for Claude Code, Cursor and any
// MCP client.
//
//   claude mcp add faable -- npx -y @faable/faable mcp          (stdio, local)
//   faable mcp --http --port 8080                               (mcp.faable.com)
//
// stdio acts with the `faable login` session (or FAABLE_TOKEN); --http with
// each caller's API key (src/mcp/http.ts). Every tool is one run of this same
// CLI (src/mcp/run_cli.ts). Over stdio, stdout is the protocol: nothing else
// may print there.
export const mcp: CommandModule<unknown, McpArgs> = {
  command: 'mcp',
  describe:
    'Run the Faable MCP server for AI agents and editors (stdio, or --http)',
  builder: yargs =>
    yargs
      .option('writes', {
        type: 'boolean',
        default: false,
        description:
          'Also expose the reversible writes: create apps, set secrets, add domains, retry or cancel builds, change deploy settings (over HTTP: ?mode=write)'
      })
      .option('http', {
        type: 'boolean',
        default: false,
        description:
          'Serve Streamable HTTP for remote clients, authenticated per request with a Faable API key'
      })
      .option('port', {
        type: 'number',
        default: Number(process.env.PORT) || 8080,
        description: 'With --http: the port (env PORT)'
      })
      .example(
        'claude mcp add faable -- npx -y @faable/faable mcp',
        'Add it to Claude Code (read-only + deploy)'
      )
      .example(
        'claude mcp add faable -- npx -y @faable/faable mcp --writes',
        'With the reversible writes'
      )
      .example(
        '$0 mcp --http --port 8080',
        'Host it (what runs at mcp.faable.com)'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    if (args.http) {
      await serve_http({ port: args.port ?? 8080 })
      return
    }
    await serve_stdio({ writes: args.writes })
  }
}
