// Reading an export file into plain records, before any provider-specific
// mapping. Exports come as a JSON array, a JSON object wrapping the array
// (`{ "users": [...] }` — Firebase, Keycloak), NDJSON (Auth0, `faable auth
// users export`) or CSV (Clerk, a Supabase table dump).

export type RawRecord = Record<string, unknown>

// RFC 4180: comma-separated, `"` quotes a field, `""` is a literal quote, and
// quoted fields may span lines. The first row is the header.
export const parse_csv = (text: string): RawRecord[] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')

  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
    } else if (c === '"' && field === '') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }
  if (quoted) throw new Error('CSV: unterminated quoted field')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const [header, ...body] = rows.filter(r => !(r.length === 1 && r[0] === ''))
  if (!header) return []
  return body.map((cells, line) => {
    if (cells.length !== header.length) {
      throw new Error(
        `CSV: row ${line + 2} has ${cells.length} fields, the header has ${header.length}`
      )
    }
    return Object.fromEntries(header.map((h, i) => [h.trim(), cells[i]]))
  })
}

export const parse_records = (text: string, format: 'json' | 'csv'): RawRecord[] => {
  if (format === 'csv') return parse_csv(text)

  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed
      if (Array.isArray(parsed?.users)) return parsed.users
      // A single object on one line is NDJSON with one record.
      if (!trimmed.includes('\n')) return [parsed]
    } catch {
      // Not one JSON document: fall through to NDJSON.
    }
  }
  return trimmed
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line)
      } catch {
        throw new Error(`NDJSON: line ${i + 1} is not valid JSON`)
      }
    })
}
