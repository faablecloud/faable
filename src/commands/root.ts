import { CommandModule } from 'yargs'
import { auth } from './auth'
import { challenge } from './challenge'
import { commands } from './commands'
import { deploy } from './deploy'
import { link_deprecated } from './link'
import { login } from './login'
import { logout } from './logout'
import { mcp } from './mcp'
import { organization } from './organization'
import { project } from './project'
import { upgrade } from './upgrade'
import { whoami } from './whoami'

// The top level of `faable`, in help order — registered by src/index.ts and
// walked by `faable commands` (src/lib/catalog.ts), so both see one list.
export const ROOT_COMMANDS: CommandModule<any, any>[] = [
  deploy,
  auth,
  challenge,
  project,
  organization,
  login,
  logout,
  whoami,
  commands,
  mcp,
  upgrade,
  link_deprecated
]
