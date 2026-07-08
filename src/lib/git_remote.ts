import { cmd } from './cmd'
import { log } from '../log'

// Returns the "org/repo" slug of the git origin remote (the format the API
// stores in `app.repository`), the raw URL for non-GitHub remotes, or
// undefined when there is no usable remote.
export const getGitRemoteUrl = async (
  workdir: string
): Promise<string | undefined> => {
  try {
    const { stdout } = await cmd('git remote get-url origin', { cwd: workdir })
    const url = stdout?.toString().trim()
    if (!url) return undefined

    // Extract org/repo from github urls
    const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
    if (match) {
      return match[1]
    }
    return url
  } catch {
    log.warn('Could not detect git remote origin URL.')
    return undefined
  }
}
