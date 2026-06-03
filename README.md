<p align="center">
  <a href="https://faable.com">
    <img src="https://www.faable.com/assets/logo/Emblem.png" height="96">
    <h3 align="center">Faable</h3>
  </a>
</p>

<p align="center">
  Your React, Node.js or Python apps, up to the cloud in seconds.
</p>

## Faable

Faable is the best platform to build modern architectures that scale precisely
to meet demand. We handle the hard stuff so you can focus on building cloud
ready apps. Make your business cloud driven and join those awesome companies.

To install the latest version of Faable CLI:

```bash
npm i -g @faable/faable
```

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

For details on how to use Faable CLI, check out our
[documentation](https://faable.com/docs).
