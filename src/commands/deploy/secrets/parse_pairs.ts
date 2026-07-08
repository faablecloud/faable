// API limits for a secret (mirrors the server-side schema).
export const NAME_MAX = 255
export const VALUE_MAX = 50000

export interface SecretPair {
  name: string
  value: string
}

// Split each "KEY=VALUE" on the FIRST '=' only, so values may contain '='.
// An empty value ("KEY=") is allowed — it is a legitimate way to blank a
// secret. Throws on the first invalid pair so callers can validate the whole
// input before writing anything.
export const parse_pairs = (inputs: string[]): SecretPair[] => {
  return inputs.map(raw => {
    const idx = raw.indexOf('=')
    if (idx <= 0) {
      throw new Error(
        `Invalid secret "${raw}". Expected KEY=VALUE (e.g. DATABASE_URL=postgres://...).`
      )
    }
    const name = raw.slice(0, idx)
    const value = raw.slice(idx + 1)
    if (name.length > NAME_MAX) {
      throw new Error(
        `Secret name "${name.slice(0, 32)}…" exceeds ${NAME_MAX} characters.`
      )
    }
    if (value.length > VALUE_MAX) {
      throw new Error(`Value for "${name}" exceeds ${VALUE_MAX} characters.`)
    }
    return { name, value }
  })
}
