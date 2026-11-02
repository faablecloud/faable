import { CommandModule } from 'yargs'
import { confirm } from '../../../lib/interactive'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import {
  app_option,
  require_completed,
  resolve_volume,
  state_label,
  volume_option,
  wait_operation,
  wait_option
} from './shared'

interface RestoreArgs {
  backup_id: string
  app?: string
  volume?: string
  yes?: boolean
  wait?: boolean
  json?: boolean
}

export const volumes_restore: CommandModule<unknown, RestoreArgs> = {
  command: 'restore <backup_id>',
  describe:
    'Replace the contents of a volume with a backup (a backup of what is there now goes first)',
  builder: yargs =>
    wait_option(volume_option(app_option(json_option(yargs))))
      .positional('backup_id', {
        type: 'string',
        demandOption: true,
        description: 'The backup (see `faable deploy volumes backups`)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api, team, app, volume } = await resolve_volume(
      args.app,
      args.volume
    )
    const go = await confirm({
      message: `Replace everything in ${app.name}/${volume.name} with backup ${args.backup_id}? The app stops while it restores; what is there now is backed up first.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }
    const op = await api.restoreVolume(team, volume.id, args.backup_id)
    if (!args.wait) {
      if (args.json) return print_json(op)
      log.info(
        `♻️  Restore ${op.id} queued, after the backup ${op.after_id ?? ''} of the current contents.`
      )
      return
    }
    if (!args.json)
      log.info(
        `♻️  Restoring ${app.name}/${volume.name} from ${args.backup_id} (${op.id}); the current contents are backed up first (${op.after_id ?? '—'})`
      )
    const done = await wait_operation(api, team, op, {
      onState: s => {
        if (!args.json && s !== 'completed' && s !== 'failed')
          log.info(state_label[s])
      }
    })
    if (args.json) print_json(done)
    require_completed(done)
    if (!args.json)
      log.info(
        `✅ Restored. To undo it, restore the backup taken just before: ${done.after_id ?? '(see faable deploy volumes backups)'}`
      )
  }
}
