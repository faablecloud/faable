import { CommandModule } from 'yargs'
import { waf_allow } from './allow'
import { waf_block } from './block'
import { waf_limit } from './limit'
import { waf_list } from './list'
import { waf_monitor } from './monitor'
import { waf_rm } from './rm'
import { waf_sink } from './sink'

export const waf: CommandModule = {
  command: 'waf <command>',
  describe:
    'Block, silence or rate-limit requests at the edge, before the app wakes',
  builder: yargs =>
    yargs
      .command(waf_list)
      .command(waf_block)
      .command(waf_sink)
      .command(waf_monitor)
      .command(waf_allow)
      .command(waf_limit)
      .command(waf_rm)
      .demandCommand(
        1,
        'Specify a waf command: list, block, sink, monitor, allow, limit or rm'
      ),
  handler: () => {
    // Unreachable: demandCommand(1) either routes to a subcommand or fails
    // through the global .fail() in src/index.ts.
  }
}
