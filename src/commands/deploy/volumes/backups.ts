import { CommandModule } from 'yargs'
import { json_option, print, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import {
  app_option,
  format_bytes,
  require_completed,
  resolve_volume,
  state_label,
  volume_option,
  wait_operation,
  wait_option
} from './shared'

interface BackupsArgs {
  app?: string
  volume?: string
  json?: boolean
}

export const volumes_backups: CommandModule<unknown, BackupsArgs> = {
  command: 'backups',
  describe: 'List the backups of a volume (nightly, and the ones you take)',
  builder: yargs =>
    volume_option(app_option(json_option(yargs))).showHelpOnFail(
      false
    ) as any,
  handler: async args => {
    const { api, team, app, volume } = await resolve_volume(
      args.app,
      args.volume
    )
    const list = await api.listVolumeBackups(team, volume.id)
    if (args.json) return print_json(list)
    const how = [
      list.scheduled ? 'one every night' : 'no nightly backup',
      list.retention != null ? `the last ${list.retention} kept` : null
    ].filter(Boolean)
    log.info(`🗄  Backups of ${app.name}/${volume.name} (${how.join(', ')}):`)
    if (list.results.length === 0) {
      log.info('  None yet. Take one with: faable deploy volumes backup')
      return
    }
    for (const b of list.results) {
      const when = b.finished_at ?? b.started_at ?? b.createdAt ?? ''
      const note =
        b.state === 'completed'
          ? b.object_deleted_at
            ? 'deleted by retention'
            : format_bytes(b.size_bytes)
          : b.state === 'failed'
            ? `failed: ${b.error ?? '?'}`
            : state_label[b.state]
      print(`  ${b.id}  ${when}  ${b.reason.padEnd(11)}  ${note}`)
    }
    log.info('Restore one with: faable deploy volumes restore <backup id>')
  }
}

interface BackupArgs extends BackupsArgs {
  wait?: boolean
}

export const volumes_backup: CommandModule<unknown, BackupArgs> = {
  command: 'backup',
  describe: 'Back a volume up now (the app keeps running)',
  builder: yargs =>
    wait_option(volume_option(app_option(json_option(yargs)))).showHelpOnFail(
      false
    ) as any,
  handler: async args => {
    const { api, team, app, volume } = await resolve_volume(
      args.app,
      args.volume
    )
    const op = await api.createVolumeOperation(team, volume.id, 'backup')
    if (!args.wait) {
      if (args.json) return print_json(op)
      log.info(`🗄  Backup ${op.id} of ${app.name}/${volume.name} queued.`)
      return
    }
    if (!args.json) log.info(`🗄  Backing up ${app.name}/${volume.name} (${op.id})`)
    const done = await wait_operation(api, team, op, {
      onState: s => {
        if (!args.json && s !== 'completed' && s !== 'failed')
          log.info(state_label[s])
      }
    })
    if (args.json) {
      print_json(done)
      require_completed(done)
      return
    }
    require_completed(done)
    log.info(`✅ Backed up: ${format_bytes(done.size_bytes)} (${done.id}).`)
  }
}
