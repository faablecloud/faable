<p align="center">
  <a href="https://faable.com">
    <img src="https://www.faable.com/assets/logo/Emblem.png" height="96">
    <h3 align="center">Faable</h3>
  </a>
</p>

<p align="center">
  Your React, Node.js or Python apps, up to the cloud in seconds.
</p>

## Faable CLI

`@faable/faable` is the command-line interface for the Faable platform. It covers
**Faable Deploy** (ship and operate apps) and **Faable Auth** (manage an identity
tenant: users, login-flow actions, OAuth clients and the audit log) from one binary.

Full reference: **[faable.com/docs/cli](https://faable.com/docs/cli)**.

To install the latest version:

```bash
npm i -g @faable/faable
```

## Commands

| Group | What it does | Docs |
| --- | --- | --- |
| `faable login` / `whoami` / `logout` | Session management (device flow; CI uses OIDC, no login needed) | [Authentication](https://faable.com/docs/cli#authentication) |
| `faable project` | The project commands act on: `list`, `use`, `current`, `clear` (or `--project` on any command) | [Projects](https://faable.com/docs/cli#projects) |
| `faable deploy` | `launch` (the default: a bare `faable deploy` deploys the current directory), then `status`, `logs`, `deployments`, `inspect`, `trigger`, `redeploy`, `cancel`, `traffic`, `usage`, `quota`, `open` | [Deployment](https://faable.com/docs/cli#deployment) |
| `faable deploy apps` | `list`, `get`, `create` (from a GitHub repository, first deploy included), `set` (branch, root directory, deploy mode) | [Apps](https://faable.com/docs/cli#apps) |
| `faable deploy secrets` | Environment variables: `list`, `set` (`KEY=VALUE`, `--env-file`, or `-f -` from stdin), `rm` | [Secrets](https://faable.com/docs/cli#secrets) |
| `faable deploy domains` | Custom domains: `add` (prints the CNAME), `list`, `check`, `rm` | [Domains](https://faable.com/docs/cli#domains) |
| `faable deploy waf` | Edge rules: `block` (403), `sink` (404 without waking the app), `list`, `rm` | [Edge rules](https://faable.com/docs/cli#edge-rules-waf) |
| `faable auth users` | `list` (FaableQL filters), `get` (federated identities included), `suspend`, `reinstate` | [Users](https://faable.com/docs/cli#users) |
| `faable auth actions` | Login-flow hooks: `list`, `get --code`, `create`, `update`, `rm` | [Actions](https://faable.com/docs/cli#actions) |
| `faable auth clients` | OAuth clients: `list`, `get --secret`, `create`, `rm` | [OAuth clients](https://faable.com/docs/cli#oauth-clients) |
| `faable auth logs` | Audit log (read-only): `list` with filters, `get` | [Audit logs](https://faable.com/docs/cli#audit-logs) |

Every command has `--help` and `--json`. `--app` takes an app id, name or slug.
The complete table is in the
[command reference](https://faable.com/docs/cli#command-reference).

### MCP server

`faable mcp` runs the CLI as an [MCP](https://modelcontextprotocol.io) server over
stdio, so Claude Code, Cursor or any MCP client can read your apps, deployments
and logs — "why did my last deploy fail?" — and deploy, with your `faable login`
session:

```bash
claude mcp add faable -- npx -y @faable/faable mcp
```

By default it exposes reads plus `deploy_app` (build the latest commit server-side).
`faable mcp --writes` adds the reversible writes: create an app from a repository,
set environment variables, add a domain, retry or cancel a build, change deploy
settings. Nothing destructive is exposed. Secret values are never returned, and
logs come back marked as data, not instructions.

### Scripting and agents

Data goes to stdout, messages to stderr. With `--json`:

- every listing is `{"object":"list","data":[…],"has_more","next_cursor"}`
  (`--limit`, `--starting-after`, `--all`);
- every write returns what it changed, and a write with nothing to do returns
  `{"result":"noop","reason"}`;
- a failure exits 1 with `{"error":{"message","code","status","action"}}` on
  stderr. Codes: `not_logged_in`, `session_expired`, `account_suspended`,
  `apikey_session`, `forbidden`, `not_found`, `confirmation_required`,
  `app_required`, `usage`, or the API's own code.

A program driving the CLI should set `FAABLE_NONINTERACTIVE=1` (or pass
`--non-interactive`): nothing prompts — a confirmation without `--yes` fails
with `confirmation_required` —, the app is never inferred from the working
directory, and `faable deploy launch` needs `--app`, `--workdir` and `--yes`.
Pass secret values on stdin (`faable deploy secrets set -f -`), never as
arguments.

### Deploy

```bash
faable login
faable deploy                       # deploy the current directory (= deploy launch)
faable deploy launch --app app_x    # deploy another app, from anywhere
faable deploy apps create --repo acme/web   # create, link, first deploy
faable deploy status                # phase, URL and detected stack
faable deploy logs --build -n 100   # end of the build output (--follow to tail)
faable deploy traffic --since 7d    # status codes, top and failing paths
faable deploy secrets set KEY=value
faable deploy domains add app.example.com
```

### Faable Auth

`faable auth` manages a [Faable Auth](https://faable.com/docs/auth) tenant and
reuses your `faable login` session. Point it at your tenant with
`--auth-url https://<account>.auth.faable.link` (or `FAABLE_AUTH_URL`).

```bash
faable auth users list --query email_verified:false --limit 50
faable auth users get user_abc123                   # includes GitHub/… identities
faable auth users suspend user_abc123 -r "abuse: crypto miner"

# Bulk: pipe ids from a filtered listing
faable auth users list --suspended --json | jq -r '.data[].id' | faable auth users reinstate -y

faable auth actions create -n add-claims -t post-login -f ./claims.js
faable auth clients create -n my-app --callback https://app.example.com/callback
faable auth logs list --origin oauth --status failed --since 2026-08-01
```

See [`faable auth` in the docs](https://faable.com/docs/cli#faable-auth) for
every flag. The concepts behind each group are documented in Faable Auth:
[users & suspension](https://faable.com/docs/auth/suspend-users),
[actions](https://faable.com/docs/auth/extensibility/actions),
[login flows](https://faable.com/docs/auth/login-flows),
[OAuth clients](https://faable.com/docs/auth/clients) and
[audit logs](https://faable.com/docs/auth/logs).

## Documentation

The CLI is a thin client: what it deploys and what it manages is documented in
the public docs, not here.

### CLI

- [Command reference](https://faable.com/docs/cli#command-reference) — every command and flag
- [Authentication](https://faable.com/docs/cli#authentication) — `login`, `whoami`, `logout`
- [Deployment](https://faable.com/docs/cli#deployment) · [Inspecting](https://faable.com/docs/cli#inspecting) · [Secrets](https://faable.com/docs/cli#secrets) · [Domains](https://faable.com/docs/cli#domains) · [Edge rules](https://faable.com/docs/cli#edge-rules-waf) · [Faable Auth](https://faable.com/docs/cli#faable-auth)

### Faable Deploy

- [Get started](https://faable.com/docs/deploy/get-started) — first deploy in minutes
- [How deployment works](https://faable.com/docs/deploy/how-it-works) — push-to-deploy, builds and releases
- [Runtime](https://faable.com/docs/deploy/runtime) — supported languages, framework detection, `faable.json` / `Procfile` overrides
- [What the builder expects](https://faable.com/docs/deploy/build-requirements) — build and start commands, `$PORT`, monorepos
- [Environment & releases](https://faable.com/docs/deploy/environment) — secrets, env vars and release versions
- [Custom domains](https://faable.com/docs/deploy/domains/custom-domain) and [SSL certificates](https://faable.com/docs/deploy/domains/ssl-certificates)
- [Web Application Firewall](https://faable.com/docs/deploy/security-waf) — the edge rules behind `faable deploy waf`
- [Deploy from your own CI](https://faable.com/docs/deploy/github-actions) — OIDC, no login needed
- Framework guides: [Next.js](https://faable.com/docs/deploy/guides/guide-next), [Vite](https://faable.com/docs/deploy/guides/guide-vite), [Astro](https://faable.com/docs/deploy/guides/guide-astro), [Express](https://faable.com/docs/deploy/guides/guide-express), [Django](https://faable.com/docs/deploy/guides/guide-django), [FastAPI](https://faable.com/docs/deploy/guides/guide-fastapi), [Flask](https://faable.com/docs/deploy/guides/guide-flask), [PHP](https://faable.com/docs/deploy/guides/guide-php)

### Faable Auth

- [Get started](https://faable.com/docs/auth/get-started) — create a tenant
- [Clients](https://faable.com/docs/auth/clients) · [Connections](https://faable.com/docs/auth/connections) · [Social login](https://faable.com/docs/auth/social) · [Passwordless](https://faable.com/docs/auth/passwordless)
- [Suspend users](https://faable.com/docs/auth/suspend-users) — what `users suspend` / `reinstate` do to sessions and tokens
- [Login flows](https://faable.com/docs/auth/login-flows) and [actions](https://faable.com/docs/auth/extensibility/actions) — the hooks managed by `auth actions`
- [Logs](https://faable.com/docs/auth/logs) — the audit trail read by `auth logs`
- [OAuth 2.0 flows](https://faable.com/docs/auth/oauth-flows) · [OpenID Connect](https://faable.com/docs/auth/oidc) · [Validate access tokens](https://faable.com/docs/auth/validate-access-tokens)
