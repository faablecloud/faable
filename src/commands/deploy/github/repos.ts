import { CommandModule } from 'yargs'
import type { FaableApi } from '../../../api/FaableApi'
import { requireApi } from '../../../api/context'
import { json_option, print, print_json } from '../../../lib/listing'
import { log } from '../../../log'

// Where a user installs the Faable GitHub App — the one step of "deploy this
// repository" that needs a browser (github.com), so it is handed over, never
// automated.
export const GITHUB_INSTALL_URL =
  'https://github.com/apps/faable-deploy/installations/new'

interface ReposArgs {
  q?: string
  limit?: number
  json?: boolean
}

export const github_repos_listing = async (
  api: Pick<FaableApi, 'listGithubInstallations' | 'listGithubRepos'>,
  opts: { q?: string; limit?: number }
) => {
  const installations = await api.listGithubInstallations()
  const repositories = []
  for (const i of installations) {
    const repos = await api.listGithubRepos(i.installation_id, {
      ...(opts.q ? { q: opts.q } : {}),
      limit: opts.limit ?? 30
    })
    for (const r of repos) {
      repositories.push({
        full_name: r.full_name,
        default_branch: r.default_branch,
        private: r.private,
        installation: i.account_login
      })
    }
  }
  return {
    installations: installations.map(i => ({
      installation_id: i.installation_id,
      account: i.account_login,
      account_type: i.account_type
    })),
    repositories,
    install_url: GITHUB_INSTALL_URL
  }
}

export const github_repos: CommandModule<unknown, ReposArgs> = {
  command: 'repos',
  describe:
    'GitHub repositories Faable can deploy (where the Faable GitHub App is installed)',
  builder: yargs =>
    json_option(yargs)
      .option('q', {
        type: 'string',
        description: 'Filter by name'
      })
      .option('limit', {
        alias: 'n',
        type: 'number',
        default: 30,
        description: 'Repositories per GitHub account (max 100)'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const listing = await github_repos_listing(api, {
      q: args.q,
      limit: Math.min(args.limit ?? 30, 100)
    })
    if (args.json) return print_json(listing)
    if (listing.installations.length === 0) {
      log.info(
        `The Faable GitHub App is not installed on any account yet. Install it: ${GITHUB_INSTALL_URL}`
      )
      return
    }
    for (const r of listing.repositories) {
      print(`${r.full_name}${r.private ? ' (private)' : ''}  ·  ${r.default_branch}`)
    }
    log.info(
      `A repository that is not listed: give the Faable GitHub App access to it at ${GITHUB_INSTALL_URL}`
    )
  }
}
