import test from 'ava'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// The commands the Faable MCP server drives (catalog v1 of
// arch/deploy/mcp-server-faable.md, mapped in arch/deploy/mcp-cli-gaps.md).
// A renamed flag or a moved command breaks a tool silently, in the user's
// editor; this makes it break here. When `faable mcp` exists, its tool
// registry replaces this table.
const CATALOG: Record<string, string[]> = {
  list_projects: ['project', 'list'],
  list_apps: ['deploy', 'apps', 'list'],
  get_app: ['deploy', 'apps', 'get'],
  list_deployments: ['deploy', 'deployments'],
  get_deployment: ['deploy', 'inspect'],
  get_build_logs: ['deploy', 'logs'],
  get_runtime_logs: ['deploy', 'logs'],
  get_app_traffic: ['deploy', 'traffic'],
  get_usage: ['deploy', 'usage'],
  list_domains: ['deploy', 'domains', 'list'],
  list_secrets: ['deploy', 'secrets', 'list'],
  get_quota: ['deploy', 'quota'],
  create_app: ['deploy', 'apps', 'create'],
  deploy_app: ['deploy', 'trigger'],
  cancel_deployment: ['deploy', 'cancel'],
  set_secrets: ['deploy', 'secrets', 'set'],
  add_domain: ['deploy', 'domains', 'add'],
  configure_repo: ['deploy', 'apps', 'set']
}

// Flags a tool passes beyond --json, per command.
const FLAGS: Record<string, string[]> = {
  get_build_logs: ['--build', '--tail', '--deployment'],
  get_runtime_logs: ['--tail', '--deployment'],
  set_secrets: ['-f, --env-file'],
  create_app: ['--repo', '--branch', '--deploy'],
  configure_repo: ['--branch', '--root-dir', '--mode']
}

const exec_file = promisify(execFile)
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (const [tool, argv] of Object.entries(CATALOG)) {
  test(`${tool} → faable ${argv.join(' ')} takes --json`, async t => {
    const { stdout } = await exec_file(
      process.execPath,
      ['--import', 'tsx', path.join(src, 'index.ts'), ...argv, '--help'],
      { env: { ...process.env, NO_COLOR: '1' } }
    )
    t.regex(stdout, /--json/)
    // Every tool targets explicitly: an app (--app) or a project (global).
    t.regex(stdout, /--project/)
    for (const flag of FLAGS[tool] ?? []) t.true(stdout.includes(flag), flag)
  })
}
