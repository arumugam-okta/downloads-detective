import { WebClient } from '@slack/web-api';
import type { SlackMessage } from './blocks.ts';

export interface Delivered {
  channel: string;
  ts: string;
}

/** Everything the service needs from Slack. Swapped for ConsoleNotifier when no bot token is configured. */
export interface Notifier {
  /** null when Slack has no such user. Throws on transport errors (rate limit, timeout). */
  lookupUserByEmail(email: string): Promise<string | null>;
  sendDirect(slackUserId: string, msg: SlackMessage): Promise<Delivered>;
  update(target: Delivered, msg: SlackMessage): Promise<void>;
  /** A new message in an existing DM. Top-level on purpose: a reply in a thread the user never joined often does not notify them. */
  sendInDm(channel: string, msg: SlackMessage): Promise<void>;
}

const slackErrorCode = (e: unknown): string | undefined => (e as { data?: { error?: string } }).data?.error;

export class SlackNotifier implements Notifier {
  constructor(private client: WebClient) {}

  async lookupUserByEmail(email: string) {
    try {
      const r = await this.client.users.lookupByEmail({ email });
      return r.user?.id ?? null;
    } catch (e) {
      if (slackErrorCode(e) === 'users_not_found') return null;
      throw e;
    }
  }

  async sendDirect(slackUserId: string, msg: SlackMessage) {
    // channel = user id: Slack opens (or reuses) the DM.
    const r = await this.client.chat.postMessage({ channel: slackUserId, text: msg.text, blocks: msg.blocks, unfurl_links: false });
    if (!r.channel || !r.ts) throw new Error('Slack did not return a message timestamp');
    return { channel: r.channel, ts: r.ts };
  }

  async update(t: Delivered, msg: SlackMessage) {
    await this.client.chat.update({ channel: t.channel, ts: t.ts, text: msg.text, blocks: msg.blocks });
  }

  async sendInDm(channel: string, msg: SlackMessage) {
    await this.client.chat.postMessage({ channel, text: msg.text, blocks: msg.blocks, unfurl_links: false });
  }
}

export interface OutboxEntry {
  at: string;
  kind: 'direct' | 'update' | 'dm';
  to: string;
  text: string;
  blocks: SlackMessage['blocks'];
}

/**
 * Dev notifier: nothing leaves the machine. Messages land in `outbox` (served at GET /dev/outbox) so the
 * Block Kit JSON can be pasted into Block Kit Builder. Any email resolves to a fake Slack user, except
 * local parts starting with "noslack", which behave like an unmapped user (-> "Needs triage").
 */
export class ConsoleNotifier implements Notifier {
  outbox: OutboxEntry[] = [];
  private n = 0;

  private record(kind: OutboxEntry['kind'], to: string, msg: SlackMessage) {
    this.outbox.push({ at: new Date().toISOString(), kind, to, text: msg.text, blocks: msg.blocks });
    if (this.outbox.length > 500) this.outbox.shift();
    console.log(`[slack:${kind}] -> ${to}: ${msg.text}`);
  }

  async lookupUserByEmail(email: string) {
    if (email.startsWith('noslack')) return null;
    return `UDEV${Buffer.from(email).toString('hex').slice(0, 8).toUpperCase()}`;
  }
  async sendDirect(slackUserId: string, msg: SlackMessage) {
    this.record('direct', slackUserId, msg);
    return { channel: `D${slackUserId.slice(1)}`, ts: `${Math.floor(Date.now() / 1000)}.${String(++this.n).padStart(6, '0')}` };
  }
  async update(t: Delivered, msg: SlackMessage) { this.record('update', `${t.channel}@${t.ts}`, msg); }
  async sendInDm(channel: string, msg: SlackMessage) { this.record('dm', channel, msg); }
}

export const createSlackNotifier = (botToken: string): SlackNotifier => new SlackNotifier(new WebClient(botToken));
