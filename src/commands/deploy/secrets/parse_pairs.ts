// API limits for a secret (mirrors the server-side schema).
export const NAME_MAX = 255
export const VALUE_MAX = 50000

// Mirror of the API's secret-name rule (api/src/deploy/secrets/SecretsManager.ts):
// printable ASCII (0x20-0x7E) except '=' (0x3D). Checked here so a bad name
// fails before the request instead of 400-ing the whole batch.
const PRINTABLE_ASCII_NO_EQUALS = /^[\x20-\x3C\x3E-\x7E]+$/

export interface SecretPair {
  name: string
  value: string
}

// Shared by the KEY=VALUE arguments and the --env-file parser, so both reject
// the same names and sizes with the same wording.
export const validate_pair = (name: string, value: string): SecretPair => {
  if (name.length > NAME_MAX) {
    throw new Error(
      `Secret name "${name.slice(0, 32)}…" exceeds ${NAME_MAX} characters.`
    )
  }
  if (!PRINTABLE_ASCII_NO_EQUALS.test(name)) {
    throw new Error(
      `Invalid secret name "${name}". Names must be printable ASCII and cannot contain '='.`
    )
  }
  if (value.length > VALUE_MAX) {
    throw new Error(`Value for "${name}" exceeds ${VALUE_MAX} characters.`)
  }
  return { name, value }
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
    return validate_pair(raw.slice(0, idx), raw.slice(idx + 1))
  })
}
