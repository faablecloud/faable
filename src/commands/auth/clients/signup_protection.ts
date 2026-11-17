// Bot protection of a client's signups and passwordless codes (auth
// SignupProtection, backlog §543). `off`: only Actions stop a signup;
// `on_risk`: a proof-of-work challenge when the request looks automated;
// `always`: every signup and OTP to a new address solves it, and client
// libraries older than @faable/auth-js 3.4.0 are refused. Clients created
// before the field existed have none, which the server reads as `off`; new
// clients are created `on_risk`.
export const SIGNUP_PROTECTION_MODES = ['off', 'on_risk', 'always'] as const
export type SignupProtection = (typeof SIGNUP_PROTECTION_MODES)[number]

export const SIGNUP_PROTECTION_HELP =
  'Bot protection for signups and email codes: off (Actions only), on_risk (proof-of-work when the request looks automated), always (every signup; auth-js < 3.4.0 is refused)'

export const effective_signup_protection = (
  client: unknown
): SignupProtection =>
  (client as { signup_protection?: SignupProtection | null } | null)
    ?.signup_protection ?? 'off'

export const signup_protection_patch = (
  mode: SignupProtection | undefined
): { signup_protection: SignupProtection } | Record<string, never> =>
  mode ? { signup_protection: mode } : {}
