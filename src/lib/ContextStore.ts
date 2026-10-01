import fs from 'fs-extra'
import os from 'os'
import path from 'path'

// The CLI's working context, kept apart from the credentials (`auth.json`) so
// `faable logout` doesn't forget which project you were on, and a context
// change never rewrites the file that holds the tokens.
//
//  - `project`: the active project (`faable project use`). A flag
//    (`--project`) or FAABLE_PROJECT overrides it per call — that's what a
//    script or the MCP server uses, so concurrent callers never race on this
//    file.
//  - `auth_accounts`: the Auth tenant chosen per project (`faable auth use`),
//    for projects with more than one.
export interface FaableContext {
  project?: string
  auth_accounts?: Record<string, string>
}

export class ContextStore {
  constructor(
    private faable_home = path.join(os.homedir(), '.faable')
  ) {}

  get path() {
    return path.join(this.faable_home, 'config.json')
  }

  async load(): Promise<FaableContext> {
    try {
      return ((await fs.readJSON(this.path)) as FaableContext) || {}
    } catch {
      return {}
    }
  }

  async update(patch: (ctx: FaableContext) => FaableContext) {
    const next = patch(await this.load())
    await fs.ensureDir(this.faable_home)
    await fs.writeJSON(this.path, next, { spaces: 2 })
    await fs.chmod(this.path, 0o600)
    return next
  }
}
