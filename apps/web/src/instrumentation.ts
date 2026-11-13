/**
 * Runs once per server start. In the single-app deployment this starts the Slack connection (Socket Mode) and the
 * SLA timer inside the web process. When SERVICE_URL is set, a separate Slack service owns both, so do nothing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.SERVICE_URL) return;
  try {
    const { getRuntime } = await import('@dd/core');
    await getRuntime().start();
  } catch (e) {
    // A missing database config must not stop the site from serving its health check and explaining itself.
    console.error('[startup] backend did not start:', (e as Error).message);
  }
}
