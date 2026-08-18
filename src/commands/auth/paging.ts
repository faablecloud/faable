// The auth-sdk list methods return a paginator ({ all, pass, first }). Fetch
// one page (the pageSize travels in the list params) or, with --all, walk the
// cursor to exhaustion. `more` tells the caller to hint about extra pages.
export interface Listing<T> {
  all: () => Promise<T[]>
  pass: () => Promise<{ next: string | null; results: T[] }>
}

export const fetch_items = async <T>(
  listing: Listing<T>,
  all?: boolean
): Promise<{ items: T[]; more: boolean }> => {
  if (all) {
    return { items: await listing.all(), more: false }
  }
  const page = await listing.pass()
  return { items: page.results, more: !!page.next }
}
