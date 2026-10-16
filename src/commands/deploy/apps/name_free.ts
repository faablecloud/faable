import { FaableApi } from '../../../api/FaableApi'
import { CliError } from '../../../lib/errors'
import { fetch_page } from '../../../lib/listing'

// Before creating an app: is the name free in the project? The api accepts a
// duplicate, but a second "web" in a project is never what someone retrying
// meant — it is the app from the last attempt, and from then on `--app web`
// is ambiguous (arch/deploy/cli-mcp-fallos-2026-10-16-plan.md, F2). The error
// names the existing app, so the next step is to deploy to it.
export const assert_name_free = async (
  api: Pick<FaableApi, 'listApps'>,
  project: string,
  name: string
): Promise<void> => {
  const apps = await fetch_page(p => api.listApps(p, project), {
    limit: 200,
    all: true
  })
  const wanted = name.toLowerCase()
  const clash = apps.data.find(a => a.name.toLowerCase() === wanted)
  if (clash) {
    throw new CliError(
      'name_taken',
      `${project} already has an app named "${clash.name}" (${clash.id}). Deploy to it with --app ${clash.id}, or choose another name.`
    )
  }
}
