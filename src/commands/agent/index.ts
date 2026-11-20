import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { CommandModule } from 'yargs'
import { package_root, version } from '../../config'
import { CliError } from '../../lib/errors'
import { json_option, print, print_json, print_noop } from '../../lib/listing'
import { log } from '../../log'

// `faable agent` — the Faable skill for coding agents (arch/deploy/
// cli-code-mode-plan.md, F2). The skill ships inside this package
// (plugin/skills/faable/SKILL.md, the same file the Claude Code plugin of this
// repository serves), so what an agent reads always matches the CLI it runs.
//
//   faable agent install                   ~/.claude/skills/faable  (Claude Code, every project)
//   faable agent install --scope project   ./.claude/skills/faable  (this project, commit it)
//   faable agent install --agents          ~/.agents/skills/faable  (other agents; `.agents`
//                                                                    with --scope project too)
//   faable agent skill               print it (to paste into AGENTS.md, a prompt…)

const SKILL_SOURCE = () =>
  path.join(package_root, 'plugin', 'skills', 'faable', 'SKILL.md')

// The line `install` adds after the frontmatter: which CLI wrote the file, and
// how `install` recognises a file of its own it may overwrite.
const STAMP_PREFIX = '<!-- installed by `faable agent install`'
const stamp = () =>
  `${STAMP_PREFIX} from @faable/faable ${version}; run it again to update -->`

export const read_skill = async () => {
  const file = SKILL_SOURCE()
  if (!(await fs.pathExists(file)))
    throw new CliError(
      'not_found',
      `The Faable skill is missing from this installation (${file}).`,
      { action: 'Reinstall the CLI: npm i -g @faable/faable' }
    )
  return fs.readFile(file, 'utf8')
}

// The skill with the stamp right after its frontmatter (a skill has to start
// with it).
export const stamped = (skill: string) => {
  const end = skill.indexOf('\n---\n', 4)
  if (!skill.startsWith('---\n') || end < 0) return `${stamp()}\n\n${skill}`
  const cut = end + '\n---\n'.length
  return `${skill.slice(0, cut)}${stamp()}\n${skill.slice(cut)}`
}

interface InstallArgs {
  scope?: 'user' | 'project'
  agents?: boolean
  dir?: string
  force?: boolean
  json?: boolean
}

export const install_dir = (
  args: InstallArgs,
  cwd = process.cwd(),
  home = os.homedir()
) => {
  if (args.dir) return path.resolve(cwd, args.dir)
  return path.join(
    args.scope === 'project' ? cwd : home,
    args.agents ? '.agents' : '.claude',
    'skills',
    'faable'
  )
}

const install: CommandModule<unknown, InstallArgs> = {
  command: 'install',
  describe:
    'Install the Faable skill for coding agents (Claude Code by default)',
  builder: yargs =>
    json_option(yargs)
      // Not --project: that is the Faable project every command takes.
      .option('scope', {
        type: 'string',
        choices: ['user', 'project'],
        default: 'user',
        description:
          'user: your home, for every project; project: the current directory (commit it)'
      })
      .option('agents', {
        type: 'boolean',
        default: false,
        description:
          'Into .agents/skills/faable instead of .claude/skills/faable, for agents other than Claude Code'
      })
      .option('dir', {
        type: 'string',
        description: 'Into this directory instead (it gets SKILL.md)'
      })
      .option('force', {
        type: 'boolean',
        default: false,
        description: 'Replace a SKILL.md there that this command did not write'
      })
      .example('$0 agent install', 'For Claude Code, in every project')
      .example(
        '$0 agent install --scope project',
        'For this project only (commit .claude/skills/faable)'
      ) as any,
  handler: async args => {
    const dir = install_dir(args)
    const file = path.join(dir, 'SKILL.md')
    const content = stamped(await read_skill())
    const existing = (await fs.pathExists(file))
      ? await fs.readFile(file, 'utf8')
      : undefined

    if (existing === content) {
      if (args.json)
        print_noop(`The skill of @faable/faable ${version} is already there`)
      else log.info(`✅ Already installed: ${file}`)
      return
    }
    if (
      existing !== undefined &&
      !existing.includes(STAMP_PREFIX) &&
      !args.force
    )
      throw new CliError(
        'usage',
        `${file} exists and was not written by \`faable agent install\`; it was left as it is.`,
        { action: 'Pass --force to replace it, or --dir to install elsewhere' }
      )

    await fs.ensureDir(dir)
    await fs.writeFile(file, content)
    if (args.json) {
      print_json({
        result: existing === undefined ? 'installed' : 'updated',
        path: file,
        cli_version: version
      })
      return
    }
    log.info(
      `✅ Faable skill ${existing === undefined ? 'installed' : 'updated'}: ${file}`
    )
    log.info(
      'It runs the CLI read-only by default (--read-only): the agent asks before anything that changes Faable.'
    )
  }
}

const skill: CommandModule = {
  command: 'skill',
  describe:
    'Print the Faable skill for coding agents (to paste into AGENTS.md or a prompt)',
  handler: async () => {
    print((await read_skill()).trimEnd())
  }
}

export const agent: CommandModule = {
  command: 'agent',
  describe: 'The Faable skill for coding agents (Claude Code, Codex, Cursor…)',
  builder: yargs =>
    yargs.command(install).command(skill).showHelpOnFail(false) as any,
  handler: () => {}
}
