import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createStore } from '@dd/db';
import { loadConfig } from './config.ts';
import { Lifecycle } from './lifecycle.ts';
import { ConsoleNotifier, createSlackNotifier } from './notifier.ts';

const path = process.argv[2];
if (!path) {
  console.error('Usage: pnpm --filter @dd/slack-service ingest <report.csv>');
  process.exit(1);
}
const cfg = loadConfig();
const notifier = cfg.slack.botToken ? createSlackNotifier(cfg.slack.botToken) : new ConsoleNotifier();
const l = new Lifecycle({ store: createStore(), notifier, webUrl: cfg.webUrl, closedFallback: 'received' });
console.log(JSON.stringify(await l.processReport(readFileSync(path, 'utf8'), { filename: basename(path), source: 'cli' }), null, 2));
