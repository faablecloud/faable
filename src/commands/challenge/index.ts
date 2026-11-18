import { Argv, CommandModule } from 'yargs'
import {
  ChallengeApi,
  ChallengeSite,
  ChallengeSiteWithSecret,
  requireChallengeToken,
  resolveSite
} from '../../api/challenge'
import { requireApi } from '../../api/context'
import { requireProject } from '../../api/project'
import { CliError } from '../../lib/errors'
import { confirm } from '../../lib/interactive'
import { json_option, print, print_json, table_lines } from '../../lib/listing'
import { log } from '../../log'

// `faable challenge` — Faable Challenge, the proof-of-work check that keeps
// bots off a site's forms (arch/auth/challenge-standalone-product.md). A
// project registers its sites here: each gets a public site key for the
// widget and a secret for the server-side verify, shown once. The API is the
// challenge service's, not api.faable.com (src/api/challenge.ts); the project
// is the usual one (--project, FAABLE_PROJECT, `faable project use`).

interface ChallengeArgs {
  json?: boolean
}

// Who and where, once per command: the Faable token Challenge takes, and the
// project (resolved by the deploy api, like every other command).
const challenge_context = async () => {
  const token = await requireChallengeToken()
  const { api } = await requireApi()
  const { id: project } = await requireProject(api)
  return { challenge: new ChallengeApi(token), project }
}

const site_lines = (s: ChallengeSite) => [
  `Site:      ${s.name} (${s.id})`,
  `Domains:   ${s.domains.join(', ')}`,
  `Site key:  ${s.site_key}`
]

// The secret goes to stdout (it is the data), the warning to stderr.
const print_secret = (s: ChallengeSiteWithSecret, what: string) => {
  for (const line of site_lines(s)) print(line)
  print(`Secret:    ${s.secret}`)
  log.warn(
    `⚠️ ${what}: this is the only time the secret is shown. Store it now in your server's environment (e.g. faable deploy secrets set FAABLE_CHALLENGE_SECRET=…); it cannot be read again, only rotated.`
  )
}

const domain_option = <T>(yargs: Argv<T>, description: string) =>
  yargs.option('domain', {
    alias: 'd',
    type: 'string',
    array: true,
    description
  })

const site_positional = <T>(yargs: Argv<T>) =>
  yargs.positional('site', {
    type: 'string',
    demandOption: true,
    describe: 'Site id (site_…), site key (fcs_pk_…) or name'
  })

const sites_list: CommandModule<unknown, ChallengeArgs> = {
  command: 'list',
  aliases: ['ls'],
  describe: "List the project's Challenge sites",
  builder: yargs => json_option(yargs).showHelpOnFail(false) as any,
  handler: async args => {
    const { challenge, project } = await challenge_context()
    const sites = await challenge.listSites(project)
    if (args.json) {
      return print_json({
        object: 'list',
        data: sites,
        has_more: false,
        next_cursor: null
      })
    }
    if (sites.length === 0) {
      return log.info(
        '📭 No Challenge sites. Create one with: faable challenge sites create --name <name> --domain <domain>'
      )
    }
    for (const line of table_lines(
      ['ID', 'NAME', 'SITE KEY', 'DOMAINS'],
      sites.map(s => [s.id, s.name, s.site_key, s.domains.join(', ')])
    )) {
      print(line)
    }
  }
}

interface CreateArgs extends ChallengeArgs {
  name?: string
  domain?: string[]
}

const sites_create: CommandModule<unknown, CreateArgs> = {
  command: 'create',
  describe:
    'Register a site: prints its site key and its secret (shown only once)',
  builder: yargs =>
    domain_option(
      json_option(yargs).option('name', {
        type: 'string',
        description: 'A name for the site, e.g. "Contact form"'
      }),
      'A domain the widget runs on (repeatable, up to 10; subdomains match too)'
    )
      .example(
        '$0 challenge sites create --name web --domain example.com --domain shop.example.com',
        ''
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    if (!args.name || !args.domain?.length) {
      throw new CliError(
        'usage',
        'A site needs --name and at least one --domain.'
      )
    }
    const { challenge, project } = await challenge_context()
    const site = await challenge.createSite(project, {
      name: args.name,
      domains: args.domain
    })
    if (args.json) return print_json(site)
    log.info(`✅ Created Challenge site ${site.name}`)
    print_secret(site, 'Site created')
  }
}

interface UpdateArgs extends ChallengeArgs {
  site: string
  name?: string
  domain?: string[]
}

const sites_update: CommandModule<unknown, UpdateArgs> = {
  command: 'update <site>',
  describe: "Rename a site or replace its domains (its keys don't change)",
  builder: yargs =>
    domain_option(
      site_positional(json_option(yargs)).option('name', {
        type: 'string',
        description: 'New name'
      }),
      'The full new list of domains (repeatable; replaces the current one)'
    ).showHelpOnFail(false) as any,
  handler: async args => {
    if (args.name === undefined && !args.domain?.length) {
      throw new CliError('usage', 'Nothing to change: pass --name or --domain.')
    }
    const { challenge, project } = await challenge_context()
    const current = await resolveSite(challenge, project, args.site)
    const site = await challenge.updateSite(project, current.id, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.domain?.length ? { domains: args.domain } : {})
    })
    if (args.json) return print_json(site)
    log.info(`✅ Updated Challenge site ${site.name}`)
    for (const line of site_lines(site)) print(line)
  }
}

interface ConfirmArgs extends ChallengeArgs {
  site: string
  yes?: boolean
}

const yes_option = <T>(yargs: Argv<T>) =>
  yargs.option('yes', {
    alias: 'y',
    type: 'boolean',
    default: false,
    description: 'Skip the confirmation prompt'
  })

const sites_delete: CommandModule<unknown, ConfirmArgs> = {
  command: 'delete <site>',
  aliases: ['rm'],
  describe:
    'Delete a site: its key and secret stop working at once (asks first; --yes to skip)',
  builder: yargs =>
    yes_option(site_positional(json_option(yargs))).showHelpOnFail(
      false
    ) as any,
  handler: async args => {
    const { challenge, project } = await challenge_context()
    const site = await resolveSite(challenge, project, args.site)
    const go = await confirm({
      message: `Delete Challenge site ${site.name} (${site.id})? Its site key and secret stop working at once: forms that check it start failing.`,
      yes: args.yes
    })
    if (!go) return log.info('Cancelled.')
    await challenge.deleteSite(project, site.id)
    if (args.json) {
      return print_json({ deleted: true, id: site.id, name: site.name })
    }
    log.info(`🗑️ Deleted Challenge site ${site.name} (${site.id}).`)
  }
}

const sites_rotate: CommandModule<unknown, ConfirmArgs> = {
  command: 'rotate-secret <site>',
  describe:
    'Issue a new secret: the old one stops working at once (asks first; --yes to skip)',
  builder: yargs =>
    yes_option(site_positional(json_option(yargs))).showHelpOnFail(
      false
    ) as any,
  handler: async args => {
    const { challenge, project } = await challenge_context()
    const site = await resolveSite(challenge, project, args.site)
    const go = await confirm({
      message: `Rotate the secret of ${site.name} (${site.id})? The current secret stops working at once: update your server with the new one right after.`,
      yes: args.yes
    })
    if (!go) return log.info('Cancelled.')
    const rotated = await challenge.rotateSecret(project, site.id)
    if (args.json) return print_json(rotated)
    log.info(`🔑 New secret for ${rotated.name}`)
    print_secret(rotated, 'Secret rotated')
  }
}

const sites: CommandModule = {
  command: 'sites',
  describe: 'Challenge sites: list, create, update, delete, rotate-secret',
  builder: yargs =>
    yargs
      .command(sites_list)
      .command(sites_create)
      .command(sites_update)
      .command(sites_delete)
      .command(sites_rotate)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}

const fmt_limit = (n: number | null | undefined) =>
  n == null ? 'unlimited' : n.toLocaleString('en-US')

const usage: CommandModule<unknown, ChallengeArgs> = {
  command: 'usage',
  describe:
    "This month's Challenge verifications and sites against the plan's quota",
  builder: yargs => json_option(yargs).showHelpOnFail(false) as any,
  handler: async args => {
    const { challenge, project } = await challenge_context()
    const u = await challenge.getUsage(project)
    if (args.json) return print_json({ project, ...u })
    print(`Month:          ${u.month}${u.plan ? ` · plan ${u.plan.tier}` : ''}`)
    print(
      `Verifications:  ${u.verified.toLocaleString('en-US')} of ${fmt_limit(u.plan?.verifications_month)}`
    )
    print(`Sites:          ${u.sites} of ${fmt_limit(u.plan?.sites)}`)
    print(
      `Challenges:     ${u.issued.toLocaleString('en-US')} issued, ${u.answered.toLocaleString('en-US')} solved, ${u.verify_failed.toLocaleString('en-US')} failed verifications`
    )
    if (!u.plan) {
      log.warn('The plan could not be read right now: no limit is shown.')
    }
  }
}

export const challenge: CommandModule = {
  command: 'challenge',
  describe: 'Faable Challenge: bot protection for your forms (sites, usage)',
  builder: yargs =>
    yargs
      .command(sites)
      .command(usage)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
