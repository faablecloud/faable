import { CommandModule } from 'yargs'
import { CliError } from '../../../lib/errors'
import { confirm } from '../../../lib/interactive'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app } from '../schedule/shared'
import { volume_dest } from './operation'
import {
  app_option,
  require_completed,
  resolve_volume,
  state_label,
  volume_option,
  wait_operation,
  wait_option
} from './shared'

interface RmArgs {
  paths?: string[]
  undo?: string
  app?: string
  volume?: string
  yes?: boolean
  wait?: boolean
  json?: boolean
}

// rm never deletes on the spot (backlog §460): the paths go to the volume's
// trash, `--undo <rm id>` brings them back, and they are emptied 7 days later.
export const volumes_rm: CommandModule<unknown, RmArgs> = {
  command: 'rm [paths..]',
  describe:
    'Move files or directories of a volume to its trash, with the app serving: --undo brings them back for 7 days, then they are emptied',
  builder: yargs =>
    wait_option(volume_option(app_option(json_option(yargs))))
      .positional('paths', {
        type: 'string',
        array: true,
        description: 'Files or directories of the volume, relative to its root'
      })
      .option('undo', {
        type: 'string',
        description: 'Bring back what an rm moved to the trash (its id)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .check(a => {
        const n = ((a.paths as string[] | undefined) ?? []).length
        if (a.undo && n)
          throw new Error('Either paths to rm, or --undo <rm id>')
        if (!a.undo && !n) throw new Error('Say what to rm, or --undo <rm id>')
        return true
      })
      .example(
        '$0 deploy volumes rm wp-content/plugins/old-plugin -a my-blog',
        'A plugin directory, to the trash'
      )
      .example(
        '$0 deploy volumes rm --undo volumeop_… -a my-blog',
        'Back from the trash'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const onState = (s: keyof typeof state_label) => {
      if (!args.json && s !== 'completed' && s !== 'failed')
        log.info(state_label[s])
    }

    if (args.undo) {
      const { api, team, app } = await resolve_app(args.app)
      const op = await api.undoVolumeOperation(team, args.undo)
      if (!args.wait) {
        if (args.json) return print_json(op)
        log.info(`♻️  Undo ${op.id} queued.`)
        return
      }
      if (!args.json)
        log.info(
          `♻️  Bringing back ${(op.paths ?? []).join(', ')} in ${app.name}`
        )
      const done = await wait_operation(api, team, op, { onState })
      if (args.json) print_json(done)
      require_completed(done)
      if (!args.json) log.info('✅ Back where they were.')
      return
    }

    const paths = (args.paths ?? []).map(p => {
      const d = volume_dest(p)
      if (d === '.') {
        throw new CliError(
          'usage',
          'rm takes files or directories, not the whole volume'
        )
      }
      return d
    })
    const { api, team, app, volume } = await resolve_volume(
      args.app,
      args.volume
    )
    const go = await confirm({
      message: `Move ${paths.join(', ')} of ${app.name}/${volume.name} to the trash? They can be brought back for 7 days.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }
    const op = await api.removeVolumePaths(team, volume.id, paths)
    const undo = `faable deploy volumes rm --undo ${op.id} -a ${app.name}`
    if (!args.wait) {
      if (args.json) return print_json(op)
      log.info(`🗑  rm ${op.id} queued. To undo it: ${undo}`)
      return
    }
    const done = await wait_operation(api, team, op, { onState })
    if (args.json) print_json(done)
    require_completed(done)
    if (!args.json) {
      log.info(`🗑  Moved to the trash: ${paths.join(', ')}.`)
      log.info(`To bring them back (7 days): ${undo}`)
    }
  }
}
