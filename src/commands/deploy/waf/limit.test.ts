import test from 'ava'
import { log } from '../../../log'
import { add_rule } from './add_rule'
import { format_waf, limit_label } from './format'
import { parse_rate } from './rate'

test('parse_rate reads requests per second or per minute', t => {
  t.deepEqual(parse_rate('10/m'), { average: 10, period: '1m' })
  t.deepEqual(parse_rate('5/s'), { average: 5, period: '1s' })
  t.deepEqual(parse_rate(' 60 / min '), { average: 60, period: '1m' })
  t.deepEqual(parse_rate('2/second'), { average: 2, period: '1s' })
})

test('parse_rate refuses an hour with the reason, not as an unknown unit', t => {
  const e = t.throws(() => parse_rate('100/h'))
  t.regex(e!.message, /not per hour or day/)
  t.regex(e!.message, /2\/m/)
  t.regex(t.throws(() => parse_rate('10/w'))!.message, /Unknown unit/)
  t.regex(t.throws(() => parse_rate('ten/m'))!.message, /Can't read/)
  t.throws(() => parse_rate('0/m'))
  t.throws(() => parse_rate('10001/s'))
})

test('limit_label says the number, the unit, who shares it and the 429', t => {
  t.is(
    limit_label({ average: 10, period: '1m', burst: 10 }, 'ip'),
    '10/min per IP, then 429'
  )
  t.is(
    limit_label({ average: 5, period: '1s', burst: 20 }, 'rule'),
    '5/s shared by all clients (burst 20), then 429'
  )
})

test('list shows a limit with its rate', t => {
  const out = format_waf({
    enabled: true,
    platform_profiles: [],
    rules: [
      {
        pattern: '^/api/login$',
        action: 'limit',
        match: 'path',
        rate: { average: 10, period: '1m', burst: 10 },
        per: 'ip'
      }
    ]
  }).join('\n')
  t.regex(out, /\^\/api\/login\$ → 10\/min per IP, then 429/)
})

test.serial(
  'limit sends the rate and per, and says what happens over it',
  async t => {
    const lines: string[] = []
    const orig = log.info
    ;(log as any).info = (m: string) => lines.push(m)
    let sent: any
    const api: any = {
      addAppWafRule: async (_id: string, body: any) => {
        sent = body
        return {
          enabled: true,
          platform_profiles: [],
          rules: [
            {
              pattern: '^/api/login$',
              action: 'limit',
              match: 'path',
              rate: { average: 10, period: '1m', burst: 10 },
              per: 'ip'
            }
          ]
        }
      }
    }
    try {
      await add_rule({
        api,
        app_id: 'app_1',
        app_name: 'shop',
        app_url: 'shop.faable.link',
        pattern: '^/api/login$',
        action: 'limit',
        rate: { average: 10, period: '1m' },
        per: 'ip'
      })
    } finally {
      ;(log as any).info = orig
    }
    t.like(sent, {
      pattern: '^/api/login$',
      action: 'limit',
      rate: { average: 10, period: '1m' },
      per: 'ip'
    })
    const out = lines.join('\n')
    t.regex(out, /10\/min per IP, then 429/)
    t.regex(out, /429 at the edge/)
    t.regex(out, /--action limit -a app_1/)
  }
)

test.serial('a block does not send rate or per', async t => {
  let sent: any
  const api: any = {
    addAppWafRule: async (_id: string, body: any) => {
      sent = body
      return { enabled: true, platform_profiles: [], rules: [] }
    }
  }
  const orig = log.info
  ;(log as any).info = () => undefined
  try {
    await add_rule({
      api,
      app_id: 'app_1',
      app_name: 'shop',
      app_url: 'shop.faable.link',
      pattern: '^/admin',
      action: 'deny',
      rate: { average: 1, period: '1s' }
    })
  } finally {
    ;(log as any).info = orig
  }
  t.false('rate' in sent)
  t.false('per' in sent)
})
