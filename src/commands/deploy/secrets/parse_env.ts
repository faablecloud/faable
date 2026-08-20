import { SecretPair, validate_pair } from './parse_pairs'

/**
 * Parser for `.env` files, the format every runtime already agrees on
 * (dotenv, docker, `source`). Deliberately a strict subset:
 *
 *  - `#` comments and blank lines are skipped; an inline `#` only starts a
 *    comment when it follows whitespace in an UNQUOTED value.
 *  - a leading `export ` is tolerated, so a file meant for `source` works.
 *  - values may be single- or double-quoted; double quotes expand `\n`, `\r`,
 *    `\t`, `\\` and `\"`, single quotes are literal. Quoted values may span
 *    lines, which is how PEM keys survive.
 *  - a line that is not a comment and has no `=` is an ERROR, not a silently
 *    ignored line: a typo must not quietly drop a variable from the deploy.
 *
 * Repeated names keep the last occurrence, matching `source`.
 */

// Closing quote for `quote`, honouring backslash escapes inside double
// quotes. Single quotes have no escapes, so the first one closes.
const closing_quote = (text: string, quote: string): number => {
  if (quote === "'") return text.indexOf(quote)
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === quote) return i
  }
  return -1
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '\\': '\\',
  '"': '"',
  "'": "'"
}

const unescape_double = (value: string): string =>
  value.replace(/\\(.)/g, (match, char: string) => ESCAPES[char] ?? match)

// `VALUE # comment` → `VALUE`. Requires the whitespace, so `pa#ss` (no space)
// stays whole; a value that really needs " #" has to be quoted.
const strip_inline_comment = (value: string): string =>
  value.replace(/\s+#.*$/, '')

const preview = (line: string): string =>
  line.length > 40 ? `${line.slice(0, 40)}…` : line

export const parse_env = (content: string, source = '.env'): SecretPair[] => {
  // A BOM would otherwise become part of the first variable's name.
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  const pairs = new Map<string, string>()

  for (let i = 0; i < lines.length; i++) {
    const line_no = i + 1
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const declaration = trimmed.replace(/^export\s+/, '')
    const eq = declaration.indexOf('=')
    if (eq < 0) {
      throw new Error(
        `${source}:${line_no}: expected KEY=VALUE, got "${preview(declaration)}".`
      )
    }

    const name = declaration.slice(0, eq).trim()
    if (!name) {
      throw new Error(`${source}:${line_no}: missing name before '='.`)
    }

    const raw = declaration.slice(eq + 1).replace(/^[ \t]*/, '')
    const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : undefined

    let value: string
    if (quote) {
      let body = raw.slice(1)
      let end = closing_quote(body, quote)
      // Unterminated on this line: keep pulling raw lines in until the quote
      // closes (multi-line values), reporting the line the value STARTED on.
      while (end < 0) {
        i++
        if (i >= lines.length) {
          throw new Error(
            `${source}:${line_no}: unterminated ${quote} quote for "${name}".`
          )
        }
        body += `\n${lines[i]}`
        end = closing_quote(body, quote)
      }
      const quoted = body.slice(0, end)
      value = quote === '"' ? unescape_double(quoted) : quoted
    } else {
      value = strip_inline_comment(raw).trim()
    }

    // Re-throw with the file position: "exceeds 255 characters" is useless
    // when the file has eighty lines.
    try {
      const pair = validate_pair(name, value)
      pairs.set(pair.name, pair.value)
    } catch (err) {
      throw new Error(`${source}:${line_no}: ${(err as Error).message}`, {
        cause: err
      })
    }
  }

  return [...pairs.entries()].map(([name, value]) => ({ name, value }))
}
