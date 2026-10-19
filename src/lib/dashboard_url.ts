// Dashboard links to an app, in the canonical `project_` form.
//
// The api returns `app.team` as `team_<hex>`. The dashboard accepts it, but a
// session that lands on a `team_` URL keeps navigating with it and pays a 400
// on `/project-favorites/recents` each time — so links leave as `project_`
// (same rule as the api's emails, arch backlog §387).
const DASHBOARD = 'https://dashboard.faable.com'

export const toProjectId = (team: string): string =>
  team.replace(/^team_/, 'project_')

export const dashboardAppUrl = (team: string, app_id: string): string =>
  `${DASHBOARD}/deploy/${toProjectId(team)}/app/${app_id}`
