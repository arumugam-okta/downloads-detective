import {
  ATTESTATION_LABEL, SYSTEM_ACTOR, attestationInput, dueAtFor, escalationTargets,
  type AttestationInput, type Item, type Person,
} from '@dd/shared';
import { fingerprintOf, type NewAudit, type Store } from '@dd/db';
import {
  escalationMessage, filesAddedMessage, itemMessage, manualReminderMessage, reassignedNotice, reopenedNotice,
  type MessageContext, type SlackMessage,
} from './blocks.ts';
import { requireCompliance, requireEngineer, requireManagerOf } from './authz.ts';
import { HttpError } from './errors.ts';
import { nameFromEmail, parseReport } from './ingest.ts';
import type { Notifier } from './notifier.ts';
import { ZodError } from 'zod';

export interface LifecycleDeps {
  store: Store;
  notifier: Notifier;
  webUrl: string;
  /** Where the SLA clock starts when the report carries no case-closed date. */
  closedFallback: 'received' | 'downloaded';
  clock?: () => Date;
}

export interface ReportSummary {
  importId: number;
  rowsTotal: number;
  duplicateRows: number;
  invalidRows: number;
  itemsCreated: number;
  itemsUpdated: number;
  needsTriage: number;
  failed: number;
}

export type DeliveryResult = 'delivered' | 'triage' | 'failed';

const SYSTEM = { actorId: null, actorLabel: SYSTEM_ACTOR } as const;
const person = (p: Person) => ({ actorId: p.id, actorLabel: p.name });

export class Lifecycle {
  constructor(readonly deps: LifecycleDeps) {}

  get store() { return this.deps.store; }
  now(): Date { return this.deps.clock?.() ?? new Date(); }
  ctx(): MessageContext { return { webUrl: this.deps.webUrl, now: this.now() }; }

  async audit(e: NewAudit): Promise<void> {
    await this.store.appendAudit({ at: this.now().toISOString(), ...e });
  }

  async mustItem(id: number): Promise<Item> {
    const item = await this.store.getItem(id);
    if (!item) throw new HttpError(404, `Item ${id} not found`);
    return item;
  }
  async mustPerson(id: number): Promise<Person> {
    const p = await this.store.getPerson(id);
    if (!p) throw new HttpError(404, `Person ${id} not found`);
    return p;
  }

  /** Best-effort Slack calls after the state change has been saved; a Slack outage must not undo a confirmation. */
  private async quiet(what: string, fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { console.error(`[slack] ${what} failed: ${(e as Error).message}`); }
  }

  async refreshMessage(itemId: number): Promise<void> {
    const item = await this.mustItem(itemId);
    if (!item.slackChannel || !item.slackTs) return;
    const files = await this.store.listFiles([itemId]);
    await this.quiet('update message', () =>
      this.deps.notifier.update({ channel: item.slackChannel!, ts: item.slackTs! }, itemMessage(item, files, this.ctx())));
  }

  /** A fresh DM to the item's engineer (not a thread reply, so Slack notifies them). */
  private async nudge(item: Item, msg: SlackMessage): Promise<void> {
    if (!item.slackChannel) return;
    await this.quiet('direct message', () => this.deps.notifier.sendInDm(item.slackChannel!, msg));
  }

  /** DM anyone by Person, caching the Slack id. Returns false when they have no Slack account. */
  async dmPerson(p: Person, msg: SlackMessage): Promise<boolean> {
    let id = p.slackUserId;
    if (!id) {
      id = await this.deps.notifier.lookupUserByEmail(p.email);
      if (id) await this.store.updatePerson(p.id, { slackUserId: id });
    }
    if (!id) return false;
    await this.deps.notifier.sendDirect(id, msg);
    return true;
  }

  // ---------------------------------------------------------------- ingest

  async processReport(csv: string, meta: { filename: string; source: string }): Promise<ReportSummary> {
    const { rows, invalid } = parseReport(csv);
    const { store } = this;
    const imp = await store.createImport({ filename: meta.filename, source: meta.source });
    const receivedAt = this.now();

    for (const bad of invalid) {
      await store.addIssue({ importId: imp.id, itemId: null, rowNo: bad.rowNo, downloadedBy: bad.downloadedBy, issue: bad.reason, kind: 'failed' });
    }

    const keyed = rows.map((r) => ({ r, fp: fingerprintOf({ downloadedBy: r.downloadedBy, caseNumber: r.caseNumber, filename: r.filename, downloadedOn: r.downloadedOn }) }));
    const existing = await store.existingFingerprints(keyed.map((k) => k.fp));
    const seen = new Set<string>();
    let duplicateRows = 0;
    const fresh = keyed.filter((k) => {
      if (existing.has(k.fp) || seen.has(k.fp)) { duplicateRows++; return false; }
      seen.add(k.fp);
      return true;
    });

    const groups = new Map<string, typeof fresh>();
    for (const k of fresh) {
      const key = `${k.r.downloadedBy}|${k.r.caseNumber}`;
      groups.set(key, [...(groups.get(key) ?? []), k]);
    }

    const policy = await store.getPolicy();
    const created: number[] = [];
    const appended: Array<{ itemId: number; filenames: Set<string> }> = [];
    const reopened: number[] = [];

    for (const group of groups.values()) {
      const first = group[0]!.r;
      const engineer = await store.upsertPersonByEmail({ email: first.downloadedBy, name: group.find((g) => g.r.downloadedByName)?.r.downloadedByName ?? nameFromEmail(first.downloadedBy) });
      const closedOn = group.map((g) => g.r.caseClosedOn).find(Boolean)
        ?? (this.deps.closedFallback === 'downloaded' ? group.map((g) => g.r.downloadedOn).sort()[0]! : receivedAt.toISOString());
      let item = await store.findItem(engineer.id, first.caseNumber);
      let isNew = false;

      if (!item) {
        item = await store.createItem({
          engineerId: engineer.id, caseNumber: first.caseNumber, caseSubject: group.find((g) => g.r.caseSubject)?.r.caseSubject ?? null,
          caseClosedAt: closedOn, dueAt: dueAtFor(new Date(closedOn), policy).toISOString(), state: 'open', createdImportId: imp.id,
        });
        isNew = true;
        created.push(item.id);
        await this.audit({ ...SYSTEM, itemId: item.id, importId: imp.id, action: 'case_created', detail: `Created cleanup item ${item.ref} (Case #${item.caseNumber})` });
      } else if (item.state === 'closed') {
        // New downloads after a confirmed cleanup start a fresh SLA window.
        item = await store.updateItem(item.id, {
          state: 'open', dueAt: dueAtFor(receivedAt, policy).toISOString(), acknowledgedAt: null, remindersSent: [], breachNotifiedAt: null,
          directorNotifiedAt: null, attestationKind: null, attestationNotes: null, attestedAt: null, reviewedBy: null, reviewedAt: null,
        });
        reopened.push(item.id);
        await this.audit({ ...SYSTEM, itemId: item.id, importId: imp.id, action: 'reopened', detail: 'Reopened: new downloads reported for a closed case' });
      }

      await store.addFiles(group.map((g) => ({ fingerprint: g.fp, itemId: item!.id, filename: g.r.filename, downloadedOn: g.r.downloadedOn })));
      for (const g of group) await this.audit({ ...SYSTEM, itemId: item.id, importId: imp.id, action: 'file_added', detail: g.r.filename });
      if (!isNew) appended.push({ itemId: item.id, filenames: new Set(group.map((g) => g.r.filename)) });
    }

    let needsTriage = 0;
    let failed = invalid.length;
    for (const id of created) {
      const result = await this.deliver(id, imp.id);
      if (result === 'triage') needsTriage++;
      if (result === 'failed') failed++;
    }
    for (const a of appended) {
      await this.quiet(`append files to ${a.itemId}`, async () => {
        const item = await this.mustItem(a.itemId);
        const added = (await store.listFiles([a.itemId])).filter((f) => a.filenames.has(f.filename));
        if (reopened.includes(a.itemId)) await this.nudge(item, reopenedNotice(item));
        else await this.nudge(item, filesAddedMessage(item, added));
        await this.refreshMessage(a.itemId);
      });
    }

    await store.updateImport(imp.id, {
      rowsTotal: rows.length + invalid.length, duplicateRows, itemsCreated: created.length, itemsUpdated: appended.length, failures: failed,
    });
    await this.audit({ ...SYSTEM, importId: imp.id, action: 'report_ingested', detail: `Ingested ${rows.length + invalid.length} report rows` });
    return {
      importId: imp.id, rowsTotal: rows.length + invalid.length, duplicateRows, invalidRows: invalid.length,
      itemsCreated: created.length, itemsUpdated: appended.length, needsTriage, failed,
    };
  }

  // -------------------------------------------------------------- delivery

  /** Sends (or re-sends) the engineer's Slack message. Never throws: failure becomes item state. */
  async deliver(itemId: number, importId?: number): Promise<DeliveryResult> {
    const { store, deps } = this;
    let item = await this.mustItem(itemId);
    const engineer = await this.mustPerson(item.engineerId);
    const unresolved = async () => (await store.listIssues({ unresolvedOnly: true })).filter((i) => i.itemId === itemId);
    const raise = async (issue: string, kind: 'triage' | 'failed') => {
      if ((await unresolved()).length) return;
      await store.addIssue({ importId: importId ?? item.createdImportId ?? 0, itemId, rowNo: null, downloadedBy: engineer.email, issue, kind });
    };

    try {
      let slackId = engineer.slackUserId;
      if (!slackId) {
        slackId = await deps.notifier.lookupUserByEmail(engineer.email);
        if (slackId) await store.updatePerson(engineer.id, { slackUserId: slackId });
      }
      if (!slackId) {
        const reason = 'No Slack user found for this email';
        item = await store.updateItem(itemId, { state: 'triage', error: reason });
        await raise(reason, 'triage');
        await this.audit({ ...SYSTEM, itemId, importId: item.createdImportId, action: 'triage_flagged', detail: `No Slack user found for ${engineer.email}` });
        return 'triage';
      }

      if (item.state === 'triage' || item.state === 'failed') item = await store.updateItem(itemId, { state: 'open', error: null });
      const files = await store.listFiles([itemId]);
      const sent = await deps.notifier.sendDirect(slackId, itemMessage(item, files, this.ctx()));
      await store.updateItem(itemId, { slackChannel: sent.channel, slackTs: sent.ts, error: null });
      for (const issue of await unresolved()) await store.resolveIssue(issue.id);
      await this.audit({ ...SYSTEM, itemId, importId: item.createdImportId, action: 'slack_notified', detail: `Sent Slack message to ${engineer.name}` });
      return 'delivered';
    } catch (e) {
      const reason = (e as Error).message;
      await store.updateItem(itemId, { state: 'failed', error: reason });
      await raise(reason, 'failed');
      await this.audit({ ...SYSTEM, itemId, importId: item.createdImportId, action: 'delivery_failed', detail: reason });
      return 'failed';
    }
  }

  // --------------------------------------------------------- engineer actions

  async acknowledge(itemId: number, actor: Person): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireEngineer(actor, item.engineerId);
    if (item.state !== 'open') return item; // idempotent: a double click or an already-acknowledged item
    const updated = await this.store.updateItem(itemId, { state: 'acknowledged', acknowledgedAt: this.now().toISOString() });
    await this.audit({ ...person(actor), itemId, action: 'acknowledged', detail: 'Acknowledged' });
    await this.refreshMessage(itemId);
    return updated;
  }

  async attest(itemId: number, actor: Person, raw: unknown): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireEngineer(actor, item.engineerId);
    if (item.state === 'closed') return item;
    let input: AttestationInput;
    try {
      input = attestationInput.parse(raw);
    } catch (e) {
      if (e instanceof ZodError) throw new HttpError(400, e.issues.map((i) => i.message).join('; '));
      throw e;
    }
    const updated = await this.store.updateItem(itemId, {
      state: 'closed', attestationKind: input.kind, attestationNotes: input.notes?.trim() || null,
      attestedAt: this.now().toISOString(), error: null,
    });
    for (const issue of (await this.store.listIssues({ unresolvedOnly: true })).filter((i) => i.itemId === itemId)) await this.store.resolveIssue(issue.id);
    await this.audit({ ...person(actor), itemId, action: 'attested', detail: `Attested: ${ATTESTATION_LABEL[input.kind].toLowerCase()}` });
    await this.refreshMessage(itemId);
    return updated;
  }

  // ---------------------------------------------------------- manager actions

  async remind(itemId: number, by: Person): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireManagerOf(by, item.engineerId, await this.store.listPeople());
    if (item.state === 'closed') throw new HttpError(409, 'This item is already closed');
    if (!item.slackChannel) throw new HttpError(409, 'This item has not been delivered in Slack yet');
    await this.deps.notifier.sendInDm(item.slackChannel, manualReminderMessage(item, by, this.ctx()));
    await this.audit({ ...person(by), itemId, action: 'manual_reminder', detail: 'Sent manual reminder' });
    return item;
  }

  async escalate(itemId: number, by: Person): Promise<Item> {
    const item = await this.mustItem(itemId);
    const people = await this.store.listPeople();
    requireManagerOf(by, item.engineerId, people);
    if (item.state === 'closed') throw new HttpError(409, 'This item is already closed');
    const engineer = await this.mustPerson(item.engineerId);
    const { manager, director } = escalationTargets(people, engineer.id);
    // A manager escalating goes up to their director; compliance goes to the manager.
    const level = manager && by.id === manager.id ? 'director' : 'manager';
    const target = level === 'director' ? director : manager;
    const msg = escalationMessage(item, engineer, level, this.ctx(), by);
    const told: string[] = [];
    if (target && (await this.dmPerson(target, msg))) told.push(target.name);
    const now = this.now().toISOString();
    const updated = await this.store.updateItem(itemId, level === 'director' ? { directorNotifiedAt: now } : { breachNotifiedAt: item.breachNotifiedAt ?? now });
    if (!told.length) throw new HttpError(409, target ? `${target.name} has no Slack account, so nobody could be notified. Map their Slack user on the Ingestion page first.` : `No ${level} is on record for ${engineer.name}`);
    await this.audit({ ...person(by), itemId, action: 'escalated', detail: `Escalated to ${told.join(', ')}` });
    return updated;
  }

  async reassign(itemId: number, toPersonId: number, by: Person): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireManagerOf(by, item.engineerId, await this.store.listPeople());
    if (item.state === 'closed') throw new HttpError(409, 'Closed items cannot be reassigned');
    const to = await this.mustPerson(toPersonId);
    if (!to.active) throw new HttpError(409, `${to.name} is not active`);
    if (to.id === item.engineerId) return item;
    if (await this.store.findItem(to.id, item.caseNumber)) throw new HttpError(409, `${to.name} already has an item for case #${item.caseNumber}`);
    const from = await this.mustPerson(item.engineerId);

    const old = item.slackChannel && item.slackTs ? { channel: item.slackChannel, ts: item.slackTs } : null;
    await this.store.updateItem(itemId, { engineerId: to.id, state: 'open', error: null, acknowledgedAt: null, slackChannel: null, slackTs: null });
    if (old) await this.quiet('reassigned notice', () => this.deps.notifier.update(old, reassignedNotice(item, to)));
    await this.audit({ ...person(by), itemId, action: 'reassigned', detail: `Reassigned from ${from.name} to ${to.name}` });
    await this.deliver(itemId);
    return this.mustItem(itemId);
  }

  async review(itemId: number, by: Person): Promise<Item> {
    const item = await this.mustItem(itemId);
    requireManagerOf(by, item.engineerId, await this.store.listPeople());
    if (item.state !== 'closed' || !item.attestationKind) throw new HttpError(409, 'Only closed items with an attestation can be reviewed');
    if (item.reviewedAt) return item;
    const updated = await this.store.updateItem(itemId, { reviewedBy: by.id, reviewedAt: this.now().toISOString() });
    await this.audit({ ...person(by), itemId, action: 'attestation_reviewed', detail: 'Marked attestation reviewed' });
    return updated;
  }

  // -------------------------------------------------------- compliance actions

  /** Link a person to their Slack account (or look it up by email) and deliver everything that was waiting. */
  async mapSlackUser(personId: number, by: Person, slackUserId?: string): Promise<{ person: Person; delivered: number }> {
    requireCompliance(by);
    const p = await this.mustPerson(personId);
    const id = slackUserId ?? (await this.deps.notifier.lookupUserByEmail(p.email));
    if (!id) throw new HttpError(409, `No Slack user found for ${p.email}. Enter the Slack member ID instead.`);
    const updated = await this.store.updatePerson(personId, { slackUserId: id });
    await this.audit({ ...person(by), action: 'slack_user_mapped', detail: `Mapped Slack user: ${p.name}` });
    const waiting = await this.store.listItems({ engineerIds: [personId], states: ['triage', 'failed'] });
    let delivered = 0;
    for (const item of waiting) if ((await this.deliver(item.id)) === 'delivered') delivered++;
    return { person: updated, delivered };
  }

  async retryDelivery(itemId: number, by: Person): Promise<DeliveryResult> {
    requireCompliance(by);
    const item = await this.mustItem(itemId);
    if (item.state !== 'triage' && item.state !== 'failed') throw new HttpError(409, 'Only items that were not delivered can be retried');
    const result = await this.deliver(itemId);
    await this.audit({ ...person(by), itemId, action: 'delivery_retried', detail: `Retried delivery: ${result}` });
    return result;
  }

  async retryAllFailed(by: Person): Promise<{ retried: number; delivered: number }> {
    requireCompliance(by);
    const failed = await this.store.listItems({ states: ['failed'] });
    let delivered = 0;
    for (const item of failed) if ((await this.deliver(item.id)) === 'delivered') delivered++;
    await this.audit({ ...person(by), action: 'delivery_retried', detail: `Retried ${failed.length} failed deliveries` });
    return { retried: failed.length, delivered };
  }
}
