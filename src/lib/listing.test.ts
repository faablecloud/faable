import test from 'ava'
import { fetch_page, from_paginator, more_hint } from './listing'

// A server of `total` items that pages like crudRoutesPlugin: `next` is the
// index of the first item of the following page.
const server = (total: number) => {
  const calls: { pageSize: number; next?: string }[] = []
  const fetch = async (p: { pageSize: number; next?: string }) => {
    calls.push(p)
    const from = Number(p.next ?? 0)
    const to = Math.min(from + p.pageSize, total)
    const results = Array.from({ length: to - from }, (_, i) => from + i)
    return { results, next: to < total ? String(to) : null }
  }
  return { fetch, calls }
}

test('one page of --limit, with the cursor to continue', async t => {
  const s = server(250)
  const page = await fetch_page(s.fetch, { limit: 100 })
  t.deepEqual(s.calls, [{ pageSize: 100 }])
  t.is(page.object, 'list')
  t.is(page.data.length, 100)
  t.true(page.has_more)
  t.is(page.next_cursor, '100')
})

test('--starting-after travels as the next cursor', async t => {
  const s = server(250)
  const page = await fetch_page(s.fetch, { limit: 100, startingAfter: '200' })
  t.deepEqual(s.calls, [{ pageSize: 100, next: '200' }])
  t.deepEqual(page.data.slice(0, 2), [200, 201])
  t.false(page.has_more)
  t.is(page.next_cursor, null)
})

test('--all walks past the 100 pages the SDK paginator gives up at', async t => {
  const s = server(200 * 120 + 7)
  const page = await fetch_page(s.fetch, { limit: 5, all: true })
  t.is(page.data.length, 200 * 120 + 7)
  t.is(s.calls.length, 121)
  t.true(s.calls.every(c => c.pageSize === 200))
  t.false(page.has_more)
})

test('a cursor that repeats is an error, not an endless loop', async t => {
  const fetch = async () => ({ results: [1], next: 'same' })
  await t.throwsAsync(fetch_page(fetch, { limit: 1, all: true, startingAfter: 'same' }), {
    message: /Bad next cursor/
  })
})

test('the SDK paginator gets the cursor as `cursor`, and nothing unset', async t => {
  const seen: unknown[] = []
  const fetch = from_paginator({
    pass: async (params?: unknown) => {
      seen.push(params)
      return { results: [], next: null }
    }
  })
  await fetch({ pageSize: 100 })
  await fetch({ pageSize: 100, next: 'abc' })
  t.deepEqual(seen, [{ pageSize: '100' }, { pageSize: '100', cursor: 'abc' }])
})

test('the rerun hint names the cursor only when there is more', t => {
  t.regex(
    more_hint({ object: 'list', data: [], has_more: true, next_cursor: 'xyz' })!,
    /--starting-after xyz/
  )
  t.is(more_hint({ object: 'list', data: [], has_more: false, next_cursor: null }), undefined)
})
