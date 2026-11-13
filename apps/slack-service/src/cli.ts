import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { getRuntime } from '@dd/core';

const path = process.argv[2];
if (!path) {
  console.error('Usage: pnpm --filter @dd/slack-service ingest <report.csv>');
  process.exit(1);
}
const { lifecycle } = getRuntime();
console.log(JSON.stringify(await lifecycle.processReport(readFileSync(path, 'utf8'), { filename: basename(path), source: 'cli' }), null, 2));
