import test from 'ava'
import { FaableApp, FaableDeployment } from '../../../api/FaableApi'
import {
  artifact_summary,
  deployment_detail,
  format_bytes,
  short_ref
} from './detail'

const app: FaableApp = {
  id: 'app_1',
  name: 'shop-api',
  url: 'shop-api.faable.link',
  team: 'team_1',
  repository: 'acme/shop-api',
  status: { phase: 'READY', deployment: 'deployment_live' }
}

const minutes_ago = (n: number) =>
  new Date(Date.now() - n * 60_000).toISOString()

// Value of a "  Label:   value" line, so the assertions read the content and
// not the padding (alignment gets its own test).
const field = (lines: string[], name: string): string | undefined => {
  const line = lines.find(l => l.trimStart().startsWith(`${name}:`))
  return line
    ?.trimStart()
    .slice(name.length + 1)
    .trim()
}

test('format_bytes scales and keeps bytes integral', t => {
  t.is(format_bytes(512), '512 B')
  t.is(format_bytes(1536), '1.5 KB')
  t.is(format_bytes(43_212_800), '41.2 MB')
  t.is(format_bytes(undefined), '-')
  t.is(format_bytes(0), '-')
})

test('short_ref strips the git ref prefix', t => {
  t.is(short_ref('refs/heads/main'), 'main')
  t.is(short_ref('refs/tags/v1.2.0'), 'v1.2.0')
  t.is(short_ref('main'), 'main')
  t.is(short_ref(undefined), null)
})

test('artifact_summary renders profile, runtime and size', t => {
  t.is(
    artifact_summary({
      id: 'artifact_1',
      deployment_id: 'deployment_1',
      app_id: 'app_1',
      artifact: {
        sha256: 'a'.repeat(64),
        size: 43_212_800,
        format: 'tar.zst',
        runtime: { name: 'node', version: '22' },
        profile: 'next-standalone'
      }
    }),
    'next-standalone · node 22 · 41.2 MB'
  )
  // No descriptor yet (build still running, or an image deploy).
  t.is(
    artifact_summary({
      id: 'artifact_1',
      deployment_id: 'deployment_1',
      app_id: 'app_1'
    }),
    null
  )
  t.is(artifact_summary(null), null)
})

test('deployment_detail renders a live artifact deployment', t => {
  const deployment: FaableDeployment = {
    id: 'deployment_live',
    app_id: 'app_1',
    release: '1.2.0',
    github_commit: 'abcdef1234567890',
    github_commit_message: 'fix: bump deps\n\nlong body ignored',
    github_ref: 'refs/heads/main',
    github_actor: 'marc',
    artifact_id: 'artifact_1',
    artifact_ready_at: minutes_ago(16),
    trigger: 'webhook',
    detected: {
      buildpack: 'node',
      framework: 'next',
      runtime: { name: 'node', version: '22.1.0' }
    },
    createdAt: minutes_ago(18),
    status: {
      phase: 'READY',
      runtime_image: 'ghcr.io/faable/node-22@sha256:be'
    }
  }

  const lines = deployment_detail({
    app,
    deployment,
    artifact: {
      id: 'artifact_1',
      deployment_id: 'deployment_live',
      app_id: 'app_1',
      artifact: {
        sha256: 'a'.repeat(64),
        size: 43_212_800,
        format: 'tar.zst',
        runtime: { name: 'node', version: '22' },
        profile: 'next-standalone',
        start_command: 'node server.js'
      }
    }
  })

  t.is(lines[0], '🟢 READY  deployment_live')
  t.is(field(lines, 'App'), 'shop-api (app_1)')
  t.is(field(lines, 'Trigger'), 'push (webhook)')
  t.is(field(lines, 'Serving'), 'yes — https://shop-api.faable.link')
  t.is(field(lines, 'Commit'), 'abcdef1 "fix: bump deps" (main by marc)')
  t.is(field(lines, 'Release'), '1.2.0')
  t.is(field(lines, 'Stack'), 'node 22.1.0 (next)')
  t.is(
    field(lines, 'Artifact'),
    'next-standalone · node 22 · 41.2 MB (sealed 16m ago)'
  )
  t.is(field(lines, 'Start'), 'node server.js')
  // Platform internals never reach the terminal: neither the per-deploy image
  // nor the runtime image (registry host = our infrastructure).
  t.is(field(lines, 'Runtime'), undefined)
  t.is(field(lines, 'Image'), undefined)
  t.true(field(lines, 'Created')?.startsWith('18m ago ('))
  // Live deployment: the useful follow-up is the runtime log, not the build.
  t.is(field(lines, 'Logs'), 'faable deploy logs')
})

test('every label lines up in the same column', t => {
  const lines = deployment_detail({
    app,
    deployment: {
      id: 'deployment_live',
      release: '1.2.0',
      github_commit: 'abcdef1234567890',
      redeploy_of: 'deployment_older',
      createdAt: minutes_ago(3),
      status: { phase: 'READY' }
    }
  })
  // "  Rebuild of:" is the longest label — every value must still start at the
  // same column as the shortest one ("  App:").
  const columns = lines
    .map(l => l.match(/^ {2}[A-Za-z ]+?: +/)?.[0].length)
    .filter(Boolean)
  t.true(columns.length > 3)
  t.deepEqual([...new Set(columns)], [14])
})

test('deployment_detail spells out a failure and how to retry it', t => {
  const lines = deployment_detail({
    app,
    deployment: {
      id: 'deployment_bad',
      app_id: 'app_1',
      github_commit: 'dbd9afa1234567',
      trigger: null,
      createdAt: minutes_ago(41),
      redeploy_of: 'deployment_older',
      status: {
        phase: 'BUILD_ERROR',
        reason: 'npm ci failed\nmissing lockfile'
      }
    }
  })

  t.is(lines[0], '🔴 BUILD_ERROR  deployment_bad')
  t.is(field(lines, 'Trigger'), 'cli')
  t.is(field(lines, 'Serving'), 'no (not live)')
  t.is(field(lines, 'Rebuild of'), 'deployment_older')
  // The full reason, indented under its own label (multi-line stays readable).
  const out = lines.join('\n')
  t.true(out.includes('  Reason:\n    npm ci failed\n    missing lockfile'))
  // A build that never produced a runnable has no runtime logs to offer.
  t.is(field(lines, 'Build'), 'faable deploy logs --build -d deployment_bad')
  t.is(field(lines, 'Logs'), undefined)
  t.is(field(lines, 'Retry'), 'faable deploy redeploy deployment_bad')
})

test('deployment_detail falls back to the app stack when the build detected none', t => {
  const lines = deployment_detail({
    app: {
      ...app,
      detected: {
        buildpack: 'python',
        runtime: { name: 'python', version: '3.12.1' }
      }
    },
    deployment: {
      id: 'deployment_x',
      createdAt: minutes_ago(2),
      status: { phase: 'QUEUED' }
    }
  })

  t.is(field(lines, 'Stack'), 'python 3.12.1')
  // Nothing recorded yet: no commit/release/artifact noise.
  t.is(field(lines, 'Commit'), undefined)
  t.is(field(lines, 'Artifact'), undefined)
  // Still building: point at the live tail.
  t.is(
    field(lines, 'Follow'),
    'faable deploy logs --build -d deployment_x --follow'
  )
})

test('a retired deployment points at both of its log sources', t => {
  const lines = deployment_detail({
    app,
    deployment: {
      id: 'deployment_old',
      createdAt: minutes_ago(200),
      status: { phase: 'SUPERSEDED' }
    }
  })

  t.is(field(lines, 'Logs'), 'faable deploy logs -d deployment_old')
  t.is(field(lines, 'Build'), 'faable deploy logs --build -d deployment_old')
})

test('a crashed deployment offers runtime logs, build output and a retry', t => {
  const lines = deployment_detail({
    app,
    deployment: {
      id: 'deployment_crash',
      createdAt: minutes_ago(5),
      status: { phase: 'ERROR', reason: 'Container "app" crashed on startup' }
    }
  })

  t.is(field(lines, 'Logs'), 'faable deploy logs -d deployment_crash')
  t.is(field(lines, 'Build'), 'faable deploy logs --build -d deployment_crash')
  t.is(field(lines, 'Retry'), 'faable deploy redeploy deployment_crash')
})
