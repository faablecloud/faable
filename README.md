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
| `faable deploy` | Deploy the current directory, then `status`, `logs`, `deployments`, `inspect`, `trigger`, `redeploy`, `cancel`, `open`, `list` | [Deployment](https://faable.com/docs/cli#deployment) |
| `faable deploy secrets` | Environment variables: `list`, `set` (`KEY=VALUE` or `--env-file`), `rm` | [Secrets](https://faable.com/docs/cli#secrets) |
| `faable deploy domains` | Custom domains: `add` (prints the CNAME), `list`, `check`, `rm` | [Domains](https://faable.com/docs/cli#domains) |
| `faable deploy waf` | Edge rules: `block` (403), `sink` (404 without waking the app), `list`, `rm` | [Edge rules](https://faable.com/docs/cli#edge-rules-waf) |
| `faable auth users` | `list` (FaableQL filters), `get` (federated identities included), `suspend`, `reinstate` | [Users](https://faable.com/docs/cli#users) |
| `faable auth actions` | Login-flow hooks: `list`, `get --code`, `create`, `update`, `rm` | [Actions](https://faable.com/docs/cli#actions) |
| `faable auth clients` | OAuth clients: `list`, `get --secret`, `create`, `rm` | [OAuth clients](https://faable.com/docs/cli#oauth-clients) |
| `faable auth logs` | Audit log (read-only): `list` with filters, `get` | [Audit logs](https://faable.com/docs/cli#audit-logs) |

Every command has `--help`; read commands accept `--json` for output you can pipe
to `jq`. The complete table is in the
[command reference](https://faable.com/docs/cli#command-reference).

### Deploy

```bash
faable login
faable deploy                       # deploy the current directory
faable deploy status                # phase, URL and detected stack
faable deploy logs --build          # build output (--follow to tail)
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
faable auth users list --suspended --json | jq -r '.[].id' | faable auth users reinstate -y

faable auth actions create -n add-claims -t post-login -f ./claims.js
faable auth clients create -n my-app --callback https://app.example.com/callback
faable auth logs list --origin oauth --status failed --since 2026-08-01
```

See [`faable auth` in the docs](https://faable.com/docs/cli#faable-auth) for
every flag, and the Faable Auth guides on
[suspending users](https://faable.com/docs/auth/suspend-users),
[login flows](https://faable.com/docs/auth/login-flows) and
[audit logs](https://faable.com/docs/auth/logs).

## Runtimes

`faable deploy` auto-detects the runtime from the files in your project (no
config needed in the common case):

| Detected by | Runtime |
| --- | --- |
| `package.json` | Node.js (Next.js, Vite, Astro, Gatsby, CRA, Vue, Angular, …) |
| `requirements.txt` / `pyproject.toml` / `Pipfile` | Python |
| `Dockerfile` | Your own image (any language) |

> A project with a `package.json` is always treated as Node. To deploy a Python
> backend that also has a `package.json`, ship a `Dockerfile` instead.

### Node.js / static frameworks

SPA frameworks are built and served automatically. If the project has **no
`start` script**, the built output is served statically (e.g. Vite → `npx vite
preview`, CRA/Vue/Angular → `serve`). If it defines a `start` script (custom SSR,
Next.js, Nuxt, Remix, …), that command is used.

### Python

The start command is detected from your framework:

| Framework | Detected from | Start command |
| --- | --- | --- |
| Django | `manage.py` + the package with `wsgi.py` | `gunicorn <pkg>.wsgi:application` |
| FastAPI / ASGI | `fastapi`/`uvicorn`/`starlette` dep | `uvicorn <module>:app` |
| Flask | `flask` dep | `gunicorn <module>:app` |

Dependencies are installed inside the image from `requirements.txt`,
`pyproject.toml` or `Pipfile`. `gunicorn`/`uvicorn` are installed automatically
if missing.

Pin the Python version with a `runtime.txt` (`python-3.11.3`), a
`.python-version`, or `requires-python` in `pyproject.toml`.

### Overriding detection

When auto-detection doesn't fit, set the commands explicitly:

- `faable.json` — `{ "buildCommand": "...", "startCommand": "..." }`
- `Procfile` — a `web:` line, e.g. `web: gunicorn app:app --bind 0.0.0.0:$PORT`

Precedence: `faable.json` → `Procfile` → auto-detection. The container listens on
`$PORT` (80).

## Documentation

- [CLI reference](https://faable.com/docs/cli) — every command and flag
- [Faable Deploy](https://faable.com/docs/deploy) — runtimes, push-to-deploy, secrets, domains
- [Faable Auth](https://faable.com/docs/auth) — the identity server managed by `faable auth`
