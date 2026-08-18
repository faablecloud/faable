import test from 'ava'
import { fetch_items } from './paging'

const listing = {
  all: async () => ['a', 'b', 'c'],
  pass: async () => ({ next: 'cursor123', results: ['a', 'b'] })
}

test('fetch_items returns one page and flags more results', t => {
  return fetch_items(listing).then(r => {
    t.deepEqual(r.items, ['a', 'b'])
    t.true(r.more)
  })
})

test('fetch_items with all=true walks every page', t => {
  return fetch_items(listing, true).then(r => {
    t.deepEqual(r.items, ['a', 'b', 'c'])
    t.false(r.more)
  })
})

test('fetch_items reports no more pages on a final page', t => {
  const last = {
    all: async () => ['x'],
    pass: async () => ({ next: null, results: ['x'] })
  }
  return fetch_items(last).then(r => {
    t.deepEqual(r.items, ['x'])
    t.false(r.more)
  })
})
