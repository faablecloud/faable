import { CommandModule } from 'yargs'
import { github_repos } from './repos'

export const github: CommandModule = {
  command: 'github',
  describe: 'The GitHub repositories Faable can deploy',
  builder: yargs =>
    yargs.command(github_repos).demandCommand(1).showHelpOnFail(false) as any,
  handler: () => {}
}
