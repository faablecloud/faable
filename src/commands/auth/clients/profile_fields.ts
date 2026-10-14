// The `profile_fields` of a client: which custom fields its users may write on
// themselves with `PATCH /me` (`auth-js updateProfile`), stored in
// `user_metadata["faable.com/fields"]`. A client's list REPLACES the tenant's
// for that app; no list (`null`) inherits the tenant's.

export type ProfileFieldDeclaration = {
  key: string
  type: 'string' | 'enum'
  options?: string[]
  max_length?: number
}

const KEY = /^[a-z0-9_]{1,40}$/

const invalid = (spec: string, why: string) =>
  new Error(`Invalid field "${spec}": ${why}`)

const checkKey = (key: string, spec: string) => {
  if (!KEY.test(key)) {
    throw invalid(
      spec,
      'the key takes lowercase letters, digits and _ (1-40 characters)'
    )
  }
}

/**
 * `--add-field` syntax:
 *
 *   profile                     a string field, default max length (200)
 *   school:string:120           a string field of at most 120 characters
 *   profile:enum:student,teacher  one of the listed values
 */
export const parse_field_spec = (spec: string): ProfileFieldDeclaration => {
  const [key, type, rest] = spec.includes(':')
    ? splitSpec(spec)
    : [spec, 'string', undefined]
  checkKey(key, spec)

  if (type === 'enum') {
    const options = (rest ?? '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean)
    if (!options.length) {
      throw invalid(spec, 'an enum needs its values: key:enum:a,b,c')
    }
    return { key, type: 'enum', options: [...new Set(options)] }
  }
  if (type === 'string') {
    if (rest === undefined || rest === '') return { key, type: 'string' }
    const max = Number(rest)
    if (!Number.isInteger(max) || max < 1 || max > 1000) {
      throw invalid(spec, 'the max length is a whole number from 1 to 1000')
    }
    return { key, type: 'string', max_length: max }
  }
  throw invalid(spec, `unknown type "${type}" (string or enum)`)
}

// `key:type:rest`, where `rest` may itself contain `:` (an enum value).
const splitSpec = (spec: string): [string, string, string | undefined] => {
  const first = spec.indexOf(':')
  const key = spec.slice(0, first)
  const after = spec.slice(first + 1)
  const second = after.indexOf(':')
  if (second < 0) return [key, after, undefined]
  return [key, after.slice(0, second), after.slice(second + 1)]
}

/** `--fields-json`: the whole list, validated the same way. */
export const parse_fields_json = (raw: string): ProfileFieldDeclaration[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('--fields-json is not valid JSON')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('--fields-json must be a JSON array of field declarations')
  }
  return parsed.map((f, i) => {
    const d = f as Partial<ProfileFieldDeclaration>
    const spec = `--fields-json[${i}]`
    if (typeof d?.key !== 'string') throw invalid(spec, 'missing "key"')
    checkKey(d.key, spec)
    if (d.type === 'enum') {
      if (!Array.isArray(d.options) || !d.options.length) {
        throw invalid(spec, 'an enum needs "options"')
      }
      return { key: d.key, type: 'enum', options: d.options.map(String) }
    }
    if (d.type !== 'string') {
      throw invalid(spec, '"type" is "string" or "enum"')
    }
    return {
      key: d.key,
      type: 'string',
      ...(d.max_length !== undefined ? { max_length: d.max_length } : {})
    }
  })
}

/**
 * The client's new list after removing and adding. Adding a key that is
 * already declared replaces its declaration in place; removing a key that is
 * not there is an error, so a typo does not look like success.
 */
export const apply_field_changes = (
  current: ProfileFieldDeclaration[] | null | undefined,
  adds: ProfileFieldDeclaration[],
  removes: string[]
): ProfileFieldDeclaration[] => {
  const next = [...(current ?? [])]
  for (const key of removes) {
    const at = next.findIndex(f => f.key === key)
    if (at < 0) {
      const have = next.map(f => f.key).join(', ') || 'none'
      throw new Error(`The client has no field "${key}" (declared: ${have})`)
    }
    next.splice(at, 1)
  }
  for (const field of adds) {
    const at = next.findIndex(f => f.key === field.key)
    if (at >= 0) next[at] = field
    else next.push(field)
  }
  if (next.length > 20) {
    throw new Error(
      `A client declares at most 20 fields (this would be ${next.length})`
    )
  }
  return next
}

/** One line per field, for `clients get` and the update summary. */
export const format_field = (f: ProfileFieldDeclaration): string =>
  f.type === 'enum'
    ? `${f.key} (enum: ${(f.options ?? []).join(', ')})`
    : `${f.key} (string${f.max_length ? `, max ${f.max_length}` : ''})`
