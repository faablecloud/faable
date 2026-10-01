import { Argv } from 'yargs'

// One listing contract for every `faable … list`, modelled on Stripe's CLI so
// a script — or the MCP server that will drive this CLI — learns it once:
//
//   --limit N              one page of up to N items (default 100, max 200)
//   --starting-after CUR   the page after CUR (the previous page's next_cursor)
//   --all                  walk every page
//   --json                 {"object":"list","data":[…],"has_more",…,"next_cursor"}
//
// The servers page by cursor (`pageSize` + `next`, arch/api/pagination.md);
// this is the translation. There is no --ending-before: the cursor only runs
// forward.

export const MAX_PAGE_SIZE = 200
export const DEFAULT_PAGE_SIZE = 100

export interface ListArgs {
  limit: number
  startingAfter?: string
  all?: boolean
  json?: boolean
}

export interface Page<T> {
  results: T[]
  next?: string | null
}

export interface ListPage<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  next_cursor: string | null
}

export const json_option = <T>(yargs: Argv<T>) =>
  yargs.option('json', {
    type: 'boolean',
    default: false,
    description: 'Output JSON on stdout (for scripting)'
  })

export const list_options = <T>(
  yargs: Argv<T>,
  { default_limit = DEFAULT_PAGE_SIZE }: { default_limit?: number } = {}
) =>
  json_option(yargs)
    .option('limit', {
      alias: 'n',
      type: 'number',
      default: default_limit,
      description: `Items per page (1-${MAX_PAGE_SIZE})`
    })
    .option('starting-after', {
      alias: 'cursor',
      type: 'string',
      description: 'Cursor to continue from (the next_cursor of the previous page)'
    })
    .option('all', {
      type: 'boolean',
      default: false,
      description: 'Fetch every page'
    })
    .check(argv => {
      const limit = (argv as { limit?: number }).limit
      if (
        limit !== undefined &&
        (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE)
      ) {
        throw new Error(`--limit must be an integer between 1 and ${MAX_PAGE_SIZE}`)
      }
      return true
    })

// A page of the server's `{ results, next }` from the listing flags. With
// --all the cursor is walked here rather than by the SDK paginator's `.all()`,
// which gives up at 100 pages.
export const fetch_page = async <T>(
  fetch: (params: { pageSize: number; next?: string }) => Promise<Page<T>>,
  args: Pick<ListArgs, 'limit' | 'startingAfter' | 'all'>
): Promise<ListPage<T>> => {
  const pageSize = args.all ? MAX_PAGE_SIZE : args.limit
  let next = args.startingAfter || undefined
  const data: T[] = []
  do {
    const page = await fetch({ pageSize, ...(next ? { next } : {}) })
    data.push(...page.results)
    const following = page.next || undefined
    if (following && following === next) throw new Error('Bad next cursor')
    next = following
  } while (args.all && next)
  return as_list(data, next ?? null)
}

// The SDKs' paginators (`api.userList(…)` etc.) as a page fetcher. They take
// the cursor as `cursor`, the server's alias of `next`.
export interface Paginator<T> {
  pass: (params?: { cursor?: string; pageSize?: string }) => Promise<Page<T>>
}

export const from_paginator =
  <T>(listing: Paginator<T>) =>
  ({ pageSize, next }: { pageSize: number; next?: string }) =>
    listing.pass({ pageSize: String(pageSize), ...(next ? { cursor: next } : {}) })

export const as_list = <T>(
  data: T[],
  next_cursor: string | null = null
): ListPage<T> => ({
  object: 'list',
  data,
  has_more: !!next_cursor,
  next_cursor
})

// Data goes to stdout, untouched by the logger (which writes to stderr).
export const print = (line = ''): void => {
  process.stdout.write(line + '\n')
}

export const print_json = (data: unknown): void => {
  print(JSON.stringify(data, null, 2))
}

// The rerun hint for the next page, on stderr (the logger's): shown to a
// person, invisible to a pipe.
export const more_hint = (page: ListPage<unknown>) =>
  page.has_more
    ? `… more results: rerun with --starting-after ${page.next_cursor} (or --all)`
    : undefined

// Left-padded fixed-width table lines. Cells are stringified as-is; column
// width = max(header, cells).
export const table_lines = (
  headers: string[],
  rows: string[][]
): string[] => {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  )
  const render = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : (c ?? '').padEnd(widths[i])))
      .join('  ')
      .trimEnd()
  return [render(headers), ...rows.map(render)]
}
