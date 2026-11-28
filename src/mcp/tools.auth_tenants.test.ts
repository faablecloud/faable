import test from 'ava'
import { hintAuthError } from '../api/auth_admin'
import { tenant_status } from '../commands/auth/accounts'
import { tenant_disabled_error } from '../lib/errors'
import { TOOLS } from './tools'

// A disabled Auth tenant (arch/auth/tenant-disable.md): the list says so, and
// an action that hits auth's 403 `account_disabled` says what happened and
// who undoes it — not «your session is not allowed to manage this tenant».
const list_auth_tenants = TOOLS.find(t => t.name === 'list_auth_tenants')!

test('list_auth_tenants tells disabled tenants apart, and by whom', t => {
  const out: any = list_auth_tenants.shape!(
    {
      data: [
        { id: 'account_a', name: 'On', domain: 'on.auth.faable.link' },
        {
          id: 'account_b',
          name: 'Off',
          domain: 'off.auth.faable.link',
          disabled_at: '2026-11-28T10:58:04.049Z',
          disabled_by: 'staff'
        },
        {
          id: 'account_c',
          name: 'Paused',
          domain: 'p.auth.faable.link',
          disabled_at: '2026-11-28T10:58:04.049Z',
          disabled_by: null
        }
      ]
    },
    {}
  )
  t.deepEqual(
    out.data.map((r: any) => [r.disabled, r.disabled_by]),
    [
      [false, undefined],
      [true, 'staff'],
      [true, 'owner']
    ]
  )
})

test('the CLI table says the same', t => {
  t.is(tenant_status({}), 'active')
  t.is(
    tenant_status({ disabled_at: 'x', disabled_by: 'staff' }),
    'disabled by Faable staff'
  )
  t.is(tenant_status({ disabled_at: 'x', disabled_by: 'owner' }), 'disabled')
})

// auth's exact body, as the management SDK throws it.
const disabled = (disabled_by: string) => ({
  response: {
    status: 403,
    data: {
      status: 403,
      message: 'This sign-in service is disabled.',
      error_code: 'account_disabled',
      details: { disabled_by }
    }
  }
})

test('disabled by staff: support restores it', t => {
  const err = tenant_disabled_error(disabled('staff'))!
  t.is(err.code, 'account_disabled')
  t.is(err.status, 403)
  t.is(err.action, 'contact_support')
  t.regex(err.message, /support@faable\.com/)
})

test('disabled by its owner: enabled again in the dashboard', t => {
  const err = tenant_disabled_error(disabled('owner'))!
  t.is(err.action, 'enable_tenant')
  t.regex(err.message, /Settings/)
  t.notRegex(err.message, /support@/)
})

test('any other 403 is not this', t => {
  t.is(
    tenant_disabled_error({
      response: { status: 403, data: { error_code: 'forbidden' } }
    }),
    undefined
  )
  t.is(tenant_disabled_error(new Error('boom')), undefined)
})

test('a management command that hits it is not told to check its credentials', t => {
  const err = t.throws(() => hintAuthError(disabled('staff')))!
  t.is((err as any).code, 'account_disabled')
  t.notRegex(err.message, /not allowed to manage/)
})
