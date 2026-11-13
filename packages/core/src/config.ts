/** Settings for the backend runtime. The HTTP-only fields (port, host, internalToken) are used by apps/slack-service. */
export interface ServiceConfig {
  port: number;
  host: string;
  /** Shared secret the web app (and cron backstop) present as a bearer token. */
  internalToken: string | undefined;
  /** Base URL of the web app, used for deep links in Slack messages. */
  webUrl: string;
  slack: {
    botToken: string | undefined;
    /** xapp- token; enables Socket Mode so no public interactivity URL is needed. */
    appToken: string | undefined;
  };
  slaTickMinutes: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return {
    port: Number(env.PORT ?? 4000),
    // Without a token the API is unauthenticated, so it only listens on loopback.
    host: env.HOST ?? (env.INTERNAL_TOKEN ? '0.0.0.0' : '127.0.0.1'),
    internalToken: env.INTERNAL_TOKEN || undefined,
    webUrl: (env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    slack: {
      botToken: env.SLACK_BOT_TOKEN || undefined,
      appToken: env.SLACK_APP_TOKEN || undefined,
    },
    slaTickMinutes: Number(env.SLA_TICK_MINUTES ?? 5),
  };
}
