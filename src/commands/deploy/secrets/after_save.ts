import { SecretsRedeploy } from '../../../api/FaableApi'

// What happens to the app after a secrets save, in the words the user reads.
//
// A running app restarts to apply the new values. An app with NOTHING running
// whose last deployment failed at runtime (a crashloop over a missing
// variable, the usual reason to come and set one) has nothing to restart: the
// api relaunches that deployment itself and reports it (api §403). Promising
// a restart there was wrong — nothing was coming, or a whole new deployment
// was.
//
// Every command carries `-a <app id>`: these lines get copied, and outside
// the app's checkout a bare command resolves no app.
export const after_save_lines = (args: {
  app: { id: string; name: string }
  redeploy: SecretsRedeploy | null
  // Whether the save changed anything; a no-op restarts nothing.
  changed: boolean
  // "the new variables" for a set, "the updated variables" for a removal.
  what?: string
}): { level: 'info' | 'warn'; text: string }[] => {
  const { app, redeploy, changed } = args
  const what = args.what ?? 'the new variables'
  const a = `-a ${app.id}`
  if (!redeploy) {
    return [
      {
        level: 'info',
        text: changed
          ? `ℹ️ The app is restarting to apply the changes.`
          : `ℹ️ Already up to date — the app was not restarted.`
      }
    ]
  }
  const failed = redeploy.failed_deployment_id
  if (redeploy.status === 'started') {
    const id = redeploy.deployment_id
    return [
      {
        level: 'info',
        text: `🔁 Redeploying ${app.name} with ${what} (deployment ${id}): its last deployment ${failed} had failed and nothing was running.`
      },
      {
        level: 'info',
        text: `Follow it with: faable deploy logs --build -d ${id} ${a} --follow  ·  status: faable deploy status ${a}`
      }
    ]
  }
  if (redeploy.status === 'needs_rebuild') {
    return [
      {
        level: 'warn',
        text: `⚠️ Nothing is running: the last deployment ${failed} failed to build, so ${what} are saved but not deployed.`
      },
      {
        level: 'warn',
        text: `Rebuild it with: faable deploy redeploy ${failed} ${a}  ·  why it failed: faable deploy logs --build -d ${failed} ${a}`
      }
    ]
  }
  return [
    {
      level: 'warn',
      text: `⚠️ Nothing is running and Faable could not relaunch the failed deployment ${failed}, so ${what} are saved but not deployed.`
    },
    {
      level: 'warn',
      text: `Relaunch it by hand (it tells you why if it is refused): faable deploy redeploy ${failed} ${a}`
    }
  ]
}

// The `restarting` of the --json output: only a running app restarts. When
// the api reports a redeploy (started or not), nothing restarts.
export const is_restarting = (
  redeploy: SecretsRedeploy | null,
  changed: boolean
) => changed && !redeploy
