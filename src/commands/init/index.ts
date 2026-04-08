import prompts from 'prompts'
import { CommandModule } from 'yargs'
import { CredentialsStore } from '../../lib/CredentialsStore'

export const init: CommandModule<any, { overwrite: boolean }> = {
  command: 'init',
  describe: 'Initialize Faable with API Key',
  builder: yargs => {
    return yargs.showHelpOnFail(false) as any
  },

  handler: async () => {
    const store: CredentialsStore = new CredentialsStore()

    const creds = await store.loadCredentials()
    if (creds?.apikey) {
      const { overwrite } = await prompts({
        type: 'confirm',
        name: 'overwrite',
        message: 'An API key already exists. Do you want to overwrite it?',
        initial: false
      })
      if (!overwrite) {
        return
      }
    }
    const { apikey } = await prompts([
      {
        type: 'text',
        name: 'apikey',
        message: 'What is your Faable ApiKey?'
      }
    ])
    await store.saveCredentials({ apikey })
  }
}
