// Pieces shared by the `faable auth email-subscriptions` commands.
//
// An email subscription is a notification subscription with `channel: 'email'`
// (the same resource as webhooks): Faable Auth emails the tenant's own people
// on an event — e.g. every time a form creates or updates a user, the
// recipients get an email with the user's `faable.com/fields`.

export type EmailSubscription = {
  id: string
  channel: 'webhook' | 'email'
  events: string[]
  active: boolean
  config: { recipients?: string[] }
  createdAt?: string
}

export const isEmail = (s: { channel?: string }) => s.channel === 'email'

// The only events with an email template in Faable Auth
// (auth: EMAIL_SUBSCRIPTION_EVENTS). Any other event would be stored and never
// sent, so it is refused here, before the request.
export const EMAIL_EVENTS = [
  'user.created',
  'user.updated',
  'credentials.exported'
] as const

export const assertEmailEvents = (events: string[]) => {
  const unknown = events.filter(
    e => !(EMAIL_EVENTS as readonly string[]).includes(e)
  )
  if (unknown.length) {
    throw new Error(
      `Email subscriptions can only send ${EMAIL_EVENTS.join(', ')} (no email template for: ${unknown.join(', ')}). For other events use \`faable auth webhooks\`.`
    )
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const assertRecipients = (to: string[]) => {
  const bad = to.filter(r => !EMAIL.test(r))
  if (bad.length) throw new Error(`Not an email address: ${bad.join(', ')}`)
}
