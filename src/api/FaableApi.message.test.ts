import test from 'ava'
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { FaableApi } from './FaableApi'

// A 4xx with the api's sentence prints that sentence alone; the
// "FaableApi <url> <status>:" prefix is ours and stays on 5xx and on bodies
// with no sentence (backlog §390: the 429 of a new account's third app reached
// users as "❌ FaableApi /app 429: New accounts can…").

const failing = async (status: number, body: Record<string, unknown>) => {
  const api = FaableApi.create()
  api.client.defaults.adapter = async config => {
    const response = {
      data: body,
      status,
      statusText: 'Too Many Requests',
      headers: {},
      config: config as InternalAxiosRequestConfig
    } as AxiosResponse
    throw new AxiosError(
      String(status),
      'ERR_BAD_REQUEST',
      config as InternalAxiosRequestConfig,
      undefined,
      response
    )
  }
  try {
    await api.listApps({})
  } catch (e) {
    return e as Error & { code?: string; status?: number; url?: string }
  }
  throw new Error(`expected a ${status}`)
}

const SENTENCE =
  'New accounts can have up to 2 apps in their first 24 hours. You can create another in 23 h 54 min.'

test("a 4xx with the api's sentence prints just the sentence", async t => {
  const e = await failing(429, {
    error_code: 'app_rate_limited',
    code: 'app_rate_limited',
    message: SENTENCE
  })
  t.is(e.message, SENTENCE)
  t.is(e.status, 429)
  t.is(e.code, 'app_rate_limited')
  t.truthy(e.url)
})

test('a 5xx keeps the technical prefix', async t => {
  const e = await failing(500, { message: 'boom' })
  t.regex(e.message, /^FaableApi \S* 500: boom$/)
})

test('a 4xx with no sentence keeps the prefix too', async t => {
  const e = await failing(404, {})
  t.regex(e.message, /^FaableApi \S* 404: /)
})
