import { createStore, type Store } from '@dd/db';
import { loadConfig, type ServiceConfig } from './config.ts';
import { Lifecycle } from './lifecycle.ts';
import { ConsoleNotifier, createSlackNotifier, type Notifier } from './notifier.ts';
import { createSlackApp } from './slack-app.ts';
import { runSlaTick } from './sla.ts';

export interface Runtime {
  cfg: ServiceConfig;
  store: Store;
  notifier: Notifier;
  lifecycle: Lifecycle;
  /** Connects Socket Mode and starts the SLA timer. Safe to call more than once: only the first call does anything. */
  start(): Promise<void>;
}

const KEY = Symbol.for('dd.runtime');
type Holder = { [KEY]?: Runtime };

/**
 * One backend per process. Next.js can evaluate a module more than once (dev reloads, separate bundles for
 * route handlers and instrumentation), so the instance lives on globalThis to keep a single Slack
 * connection, a single SLA timer and a single database client.
 */
export function getRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const g = globalThis as unknown as Holder;
  if (g[KEY]) return g[KEY]!;

  const cfg = loadConfig(env);
  const store = createStore(env);
  const live = !!cfg.slack.botToken;
  const notifier: Notifier = live ? createSlackNotifier(cfg.slack.botToken!) : new ConsoleNotifier();
  const lifecycle = new Lifecycle({ store, notifier, webUrl: cfg.webUrl, closedFallback: 'received' });
  let started: Promise<void> | null = null;

  const start = () => (started ??= (async () => {
    if (!live) console.warn('SLACK_BOT_TOKEN not set: messages are logged, not sent.');
    else if (cfg.slack.appToken) {
      await createSlackApp(lifecycle, { botToken: cfg.slack.botToken!, appToken: cfg.slack.appToken }).start();
      console.log('Slack Socket Mode connected');
    } else console.warn('SLACK_APP_TOKEN not set: messages are sent but the buttons will not work.');
    const tick = () => runSlaTick(lifecycle).catch((e: Error) => console.error('[sla] tick failed:', e.message));
    setInterval(tick, cfg.slaTickMinutes * 60_000).unref?.();
    void tick();
  })());

  return (g[KEY] = { cfg, store, notifier, lifecycle, start });
}
