import { WebClient } from '@slack/web-api';
import type { SlackProfile } from '@dd/shared';
import type { SlackMessage } from './blocks.ts';

export interface Delivered {
  channel: string;
  ts: string;
}

export interface SlackDirectory {
  profiles: SlackProfile[];
  /** People whose profile could not be read; the sync carries on without them. */
  failed: Array<{ slackUserId: string; error: string }>;
  /** Profile fields this workspace does not define, so they cannot be synced. */
  missingFields: string[];
}

/** Everything the service needs from Slack. Swapped for ConsoleNotifier when no bot token is configured. */
export interface Notifier {
  /** null when Slack has no such user. Throws on transport errors (rate limit, timeout). */
  lookupUserByEmail(email: string): Promise<string | null>;
  sendDirect(slackUserId: string, msg: SlackMessage): Promise<Delivered>;
  update(target: Delivered, msg: SlackMessage): Promise<void>;
  /** A new message in an existing DM. Top-level on purpose: a reply in a thread the user never joined often does not notify them. */
  sendInDm(channel: string, msg: SlackMessage): Promise<void>;
  /** Every active, non-guest person with their profile fields. null when Slack is not connected. */
  listProfiles(): Promise<SlackDirectory | null>;
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

  /**
   * users.list has no custom profile fields, so this reads each profile (users.profile.get). Fields are found by
   * their stable field_name via team.profile.get rather than hard-coded ids, so it works in any workspace.
   */
  async listProfiles(): Promise<SlackDirectory> {
    const team = await this.client.team.profile.get({});
    const defs = ((team.profile as { fields?: Field[] } | undefined)?.fields ?? []);
    const idOf = new Map(defs.flatMap((f) => (f.field_name && f.id ? [[f.field_name, f.id] as const] : [])));
    const missingFields = WANTED.filter((n) => !idOf.has(n));

    const members: Member[] = [];
    for await (const page of this.client.paginate('users.list', { limit: 200 })) members.push(...(((page as { members?: Member[] }).members) ?? []));
    const people = members.filter((m) => m.id && m.id !== 'USLACKBOT' && !m.deleted && !m.is_bot && !m.is_restricted && !m.is_ultra_restricted && m.profile?.email);

    const profiles: SlackProfile[] = [];
    const failed: SlackDirectory['failed'] = [];
    const read = async (m: Member): Promise<SlackProfile | null> => {
      try {
        const r = await this.client.users.profile.get({ user: m.id! });
        const f = ((r.profile as { fields?: Record<string, { value?: string }> } | undefined)?.fields ?? {});
        const val = (name: string) => clean(f[idOf.get(name) ?? '']?.value);
        return {
          slackUserId: m.id!, email: m.profile!.email!.toLowerCase(), name: clean(m.real_name) ?? m.profile!.email!, title: clean(m.profile?.title),
          department: val('department'), division: val('division'), organization: val('organization'), costCenter: val('costCenter'),
          employeeNumber: val('employeeNumber'), employeeType: val('userType'),
          location: ['locality', 'region', 'country'].map(val).filter(Boolean).join(', ') || null,
          timezone: clean(m.tz), managerSlackId: val('managerId'),
        };
      } catch (e) {
        failed.push({ slackUserId: m.id!, error: slackErrorCode(e) ?? (e as Error).message });
        return null;
      }
    };
    const seen = new Set(people.map((m) => m.id!));
    const push = (p: SlackProfile | null) => { if (p) profiles.push(p); };
    await pool(people, 5, async (m) => push(await read(m)));

    // users.list only returns the workspace the bot is installed in. On an enterprise, managers often sit in another
    // workspace, so follow each unresolved manager id (and their manager, and so on) with users.info.
    let frontier = [...new Set(profiles.map((p) => p.managerSlackId).filter((id): id is string => !!id && !seen.has(id)))];
    for (let depth = 0; depth < 8 && frontier.length; depth++) {
      frontier.forEach((id) => seen.add(id));
      const found: SlackProfile[] = [];
      await pool(frontier, 5, async (id) => {
        try {
          const u = (await this.client.users.info({ user: id })).user as Member | undefined;
          if (!u?.profile?.email || u.deleted || u.is_bot) return; // deactivated managers stay unresolved
          const p = await read({ ...u, id });
          if (p) found.push(p);
        } catch (e) {
          failed.push({ slackUserId: id, error: slackErrorCode(e) ?? (e as Error).message });
        }
      });
      profiles.push(...found);
      frontier = [...new Set(found.map((p) => p.managerSlackId).filter((id): id is string => !!id && !seen.has(id)))];
    }
    return { profiles, failed, missingFields };
  }
}

type Field = { id?: string; field_name?: string };
type Member = { id?: string; deleted?: boolean; is_bot?: boolean; is_restricted?: boolean; is_ultra_restricted?: boolean; real_name?: string; tz?: string; profile?: { email?: string; title?: string } };

const WANTED = ['managerId', 'department', 'division', 'organization', 'costCenter', 'employeeNumber', 'userType'] as const;
const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.trim() !== '-' ? v.trim() : null);

/** Runs `fn` over `items` with at most `n` in flight. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]!); }));
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
  async listProfiles() { return null; }
}

export const createSlackNotifier = (botToken: string): SlackNotifier => new SlackNotifier(new WebClient(botToken));
