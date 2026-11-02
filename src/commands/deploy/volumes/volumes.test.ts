import test from 'ava'
import type { FaableApi, FaableVolumeOperation } from '../../../api/FaableApi'
import {
  format_entry,
  format_usage,
  is_archive,
  volume_dest,
  wait_operation
} from './operation'

test('--to stays inside the volume', t => {
  t.is(volume_dest(undefined), '.')
  t.is(volume_dest('.'), '.')
  t.is(volume_dest('./'), '.')
  t.is(volume_dest('wp-content/mu-plugins/'), 'wp-content/mu-plugins')
  t.is(volume_dest('./wp-content//x'), 'wp-content/x')
  t.is(volume_dest('a/../b'), 'b')
  for (const bad of ['..', '../etc', 'a/../../b', '/faable/app/wp-content']) {
    t.throws(() => volume_dest(bad), { message: /volume/ }, bad)
  }
})

test('an archive is a .tar.gz or .tgz', t => {
  t.true(is_archive('site.tar.gz'))
  t.true(is_archive('SITE.TGZ'))
  t.false(is_archive('site.tar'))
  t.false(is_archive('site.zip'))
})

test('usage against the quota', t => {
  const v = { used_bytes: 1_250_000_000, quota_gb: 10 } as never
  t.is(format_usage(v), '1.3 GB of 10 GB (13%)')
  t.regex(
    format_usage({ used_bytes: null, quota_gb: 10 } as never),
    /not measured/
  )
})

test('waits through the backup that goes first, until the operation is done', async t => {
  const op = (state: FaableVolumeOperation['state']) =>
    ({ id: 'op1', kind: 'restore', state }) as FaableVolumeOperation
  const states = ['queued', 'running', 'completed'] as const
  let reads = 0
  const api = {
    getVolumeOperation: async () => op(states[Math.min(++reads, 2)])
  } as unknown as FaableApi
  const seen: string[] = []
  const done = await wait_operation(api, 'team', op('queued'), {
    sleep: async () => {},
    onState: s => seen.push(s)
  })
  t.is(done.state, 'completed')
  t.deepEqual(seen, ['queued', 'running', 'completed'])
})

test('one line of volumes ls', t => {
  t.is(
    format_entry({
      name: 'ferp',
      type: 'dir',
      size: 4096,
      mtime: '2026-11-02T13:32:37.592Z'
    }),
    'd         —  2026-11-02 13:32  ferp/'
  )
  t.is(
    format_entry({
      name: 'ferp.php',
      type: 'file',
      size: 2500,
      mtime: '2026-11-02T13:32:37.592Z'
    }),
    '-    2.5 KB  2026-11-02 13:32  ferp.php'
  )
})
