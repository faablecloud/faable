import { CommandModule } from 'yargs'
import { volumes_backup, volumes_backups } from './backups'
import { volumes_export } from './export'
import { volumes_import, volumes_put } from './import'
import { volumes_list } from './list'
import { volumes_restore } from './restore'

// The volumes of an app (api `/volume`, `/volume-operation`): today the ones
// a blueprint defines (WordPress: `site` at /faable/app). Hidden until the
// blueprints are published, like the api endpoints (x-internal); then the
// describe below. Arch: deploy/volumenes-cli-comparativa.md (backlog §460).
export const volumes: CommandModule = {
  command: 'volumes <command>',
  // 'Manage the volumes of an app: usage, backups, restore, export, import and put'
  describe: false,
  builder: yargs =>
    yargs
      .command(volumes_list)
      .command(volumes_backups)
      .command(volumes_backup)
      .command(volumes_restore)
      .command(volumes_export)
      .command(volumes_import)
      .command(volumes_put)
      .demandCommand(
        1,
        'Specify a volumes command: list, backups, backup, restore, export, import or put'
      ),
  handler: () => {
    // Unreachable: demandCommand(1) either routes to a subcommand or fails
    // through the global .fail() in src/index.ts.
  }
}
