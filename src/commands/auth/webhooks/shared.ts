// Pieces shared by the `faable auth webhooks` commands.

// What a webhook subscription looks like to these commands. Email
// subscriptions share the resource (`channel: 'email'`) but are not webhooks:
// the commands only show and manage `channel: 'webhook'`.
export type WebhookSubscription = {
  id: string
  channel: 'webhook' | 'email'
  events: string[]
  active: boolean
  config: { url?: string; previous_secret_expires_at?: string }
  status?: 'healthy' | 'failing'
  consecutive_failures?: number
  last_success_at?: string
  last_failure_at?: string
  createdAt?: string
}

export const isWebhook = (s: { channel?: string }) => s.channel === 'webhook'

// The secret is returned exactly once (create, rotate-secret): say so where
// the person will see it, not in the docs.
export const SECRET_WARNING =
  "⚠️ Store it now (e.g. as the receiver's environment variable): it is never shown again. `faable auth webhooks rotate-secret` issues a new one."
