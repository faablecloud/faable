import test from 'ava'
import {
  MANAGED_DOCS_URL,
  managed_name,
  managed_warning
} from './managed_names'

test('PORT is reserved', t => {
  t.is(managed_name('PORT')?.kind, 'reserved')
})

test('every FAABLE_* injected name is reserved', t => {
  for (const name of [
    'FAABLE_HOST',
    'FAABLE_APP_ID',
    'FAABLE_DEPLOY_ID',
    'FAABLE_RELEASE',
    'FAABLE_GIT_COMMIT',
    'FAABLE_GIT_REF'
  ]) {
    t.is(managed_name(name)?.kind, 'reserved', name)
  }
})

test('runtime image defaults are flagged as overridable', t => {
  t.is(managed_name('NODE_ENV')?.kind, 'runtime_default')
  t.is(managed_name('PYTHONUNBUFFERED')?.kind, 'runtime_default')
})

test("a name of the user's own is not managed", t => {
  t.is(managed_name('DATABASE_URL'), undefined)
  t.is(managed_warning('DATABASE_URL'), undefined)
})

test('matching is exact, not a prefix', t => {
  t.is(managed_name('PORTAL'), undefined)
  t.is(managed_name('MY_PORT'), undefined)
})

test('surrounding whitespace does not hide a managed name', t => {
  t.is(managed_name(' PORT ')?.kind, 'reserved')
})

test('the reserved warning says the value is ignored and links the docs', t => {
  const warning = managed_warning('PORT') ?? ''
  t.regex(warning, /^PORT is reserved/)
  t.regex(warning, /ignored/)
  t.true(warning.endsWith(MANAGED_DOCS_URL.reserved))
})

test('the runtime-default warning does not claim the value is ignored', t => {
  const warning = managed_warning('NODE_ENV') ?? ''
  t.regex(warning, /already set/)
  t.notRegex(warning, /ignored/)
})
