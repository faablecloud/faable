import test from 'ava'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { TOOLS } from '../mcp/tools'

// Every tool of `faable mcp` is one CLI command (src/mcp/tools.ts). A renamed
// flag or a moved command would break a tool silently, in somebody's editor;
// this makes it break here: each tool's command must exist, take --json, and
// know every flag the tool passes for its example arguments.
const exec_file = promisify(execFile)
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const tool of TOOLS) {
  test(`${tool.name} → faable ${tool.command.join(' ')}`, async t => {
    const { stdout } = await exec_file(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(src, 'index.ts'),
        ...tool.command,
        '--help'
      ],
      { env: { ...process.env, NO_COLOR: '1' } }
    )
    t.regex(stdout, /--json/)
    for (const flag of tool
      .flags(tool.example)
      .filter(f => /^-{1,2}[a-z]/.test(f))) {
      // yargs lists --deploy and takes --no-deploy implicitly.
      const listed = flag.replace(/^--no-/, '--')
      t.regex(stdout, new RegExp(`(^|[\\s,])${listed}\\b`), flag)
    }
  })
}
