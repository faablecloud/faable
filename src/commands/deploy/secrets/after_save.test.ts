import test from 'ava'
import { after_save_lines, is_restarting } from './after_save'

const app = { id: 'app_1', name: 'web' }
const text = (lines: { text: string }[]) => lines.map(l => l.text).join('\n')

test('no redeploy: the restart line of always, or the no-op line', t => {
  t.is(
    text(after_save_lines({ app, redeploy: null, changed: true })),
    'ℹ️ The app is restarting to apply the changes.'
  )
  t.is(
    text(after_save_lines({ app, redeploy: null, changed: false })),
    'ℹ️ Already up to date — the app was not restarted.'
  )
})

test('started: names the new deployment and how to follow it, never a restart', t => {
  const lines = after_save_lines({
    app,
    changed: true,
    redeploy: {
      status: 'started',
      failed_deployment_id: 'deployment_old',
      deployment_id: 'deployment_new'
    }
  })
  const out = text(lines)
  t.regex(
    out,
    /Redeploying web with the new variables \(deployment deployment_new\)/
  )
  t.true(
    out.includes(
      'faable deploy logs --build -d deployment_new -a app_1 --follow'
    )
  )
  t.notRegex(out, /restarting/)
  t.true(lines.every(l => l.level === 'info'))
})

test('needs_rebuild: says it failed to build and how to rebuild it', t => {
  const lines = after_save_lines({
    app,
    changed: true,
    redeploy: {
      status: 'needs_rebuild',
      failed_deployment_id: 'deployment_old',
      deployment_id: null
    }
  })
  const out = text(lines)
  t.regex(out, /failed to build/)
  t.true(out.includes('faable deploy redeploy deployment_old -a app_1'))
  t.notRegex(out, /restarting/)
  t.true(lines.every(l => l.level === 'warn'))
})

test('not_started: says it was not relaunched and how to do it by hand', t => {
  const lines = after_save_lines({
    app,
    changed: true,
    what: 'the updated variables',
    redeploy: {
      status: 'not_started',
      failed_deployment_id: 'deployment_old',
      deployment_id: null
    }
  })
  const out = text(lines)
  t.regex(out, /could not relaunch the failed deployment deployment_old/)
  t.regex(out, /the updated variables are saved but not deployed/)
  t.true(out.includes('faable deploy redeploy deployment_old -a app_1'))
  t.true(lines.every(l => l.level === 'warn'))
})

test('restarting only when something changed and nothing was relaunched', t => {
  t.true(is_restarting(null, true))
  t.false(is_restarting(null, false))
  t.false(
    is_restarting(
      {
        status: 'started',
        failed_deployment_id: 'deployment_old',
        deployment_id: 'deployment_new'
      },
      true
    )
  )
})
