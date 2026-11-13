import { createStore } from '@dd/db';
import { loadConfig } from './config.ts';
import { Lifecycle } from './lifecycle.ts';
import { ConsoleNotifier, createSlackNotifier, type Notifier } from './notifier.ts';
import { buildServer } from './server.ts';
import { createSlackApp } from './slack-app.ts';
import { runSlaTick } from './sla.ts';

const cfg = loadConfig();
const store = createStore();

const live = !!cfg.slack.botToken;
const notifier: Notifier = live ? createSlackNotifier(cfg.slack.botToken!) : new ConsoleNotifier();
if (!live) console.warn('SLACK_BOT_TOKEN not set: messages are logged and served at GET /dev/outbox instead of being sent.');

const lifecycle = new Lifecycle({ store, notifier, webUrl: cfg.webUrl, closedFallback: 'received' });

if (live && cfg.slack.appToken) {
  await createSlackApp(lifecycle, { botToken: cfg.slack.botToken!, appToken: cfg.slack.appToken }).start();
  console.log('Slack Socket Mode connected');
} else if (live) {
  console.warn('SLACK_APP_TOKEN not set: messages will be sent but the buttons will not work (no Socket Mode).');
}

const server = await buildServer(lifecycle, cfg);
await server.listen({ port: cfg.port, host: cfg.host });

const tick = () => runSlaTick(lifecycle).catch((e: Error) => console.error('[sla] tick failed:', e.message));
setInterval(tick, cfg.slaTickMinutes * 60_000);
void tick();
