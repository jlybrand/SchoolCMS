/**
 * Starts Payload's job crons when the server starts (`src/payload.config.ts`, `jobs`).
 *
 * Payload starts them only for a `getPayload({ cron: true })` call, which otherwise first happens
 * on an admin or API request. Without this, a server restarted overnight would run no scheduled
 * job — the district's morning digest included — until somebody opened the admin.
 *
 * Node only: the edge runtime (`src/proxy.ts`) cannot run Payload.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { getPayload } = await import('payload')
  const config = (await import('@payload-config')).default
  await getPayload({ config, cron: true })
}
