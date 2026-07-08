import { spawn } from 'promisify-child-process'
import { log } from '../log'

// Returns the "org/repo" slug of the git origin remote (the format the API
// stores in `app.repository`), the raw URL for non-GitHub remotes, or
// undefined when there is no usable remote.
//
// This is a best-effort auto-detection: running outside a git repository (or
// without an `origin` remote) is an expected, benign case, so failures are
// swallowed at debug level — never surfaced as errors/warnings. It does NOT
// go through `cmd()` on purpose: that helper loudly logs stderr and the exit
// code, which is right for user-invoked build steps but pure noise here.
export const getGitRemoteUrl = async (
  workdir: string
): Promise<string | undefined> => {
  try {
    const child = spawn('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: workdir
    })
    const { stdout } = await child
    const url = stdout?.toString().trim()
    if (!url) return undefined

    // Extract org/repo from github urls
    const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
    if (match) {
      return match[1]
    }
    return url
  } catch {
    log.debug('No git origin remote detected; skipping repo-based app lookup.')
    return undefined
  }
}
