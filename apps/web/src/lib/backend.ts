import 'server-only';
import type { PeopleMapping, Person, PersonInput, SlackSyncRequest } from '@dd/shared';

export interface BackendResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

export interface PolicyInput {
  slaDays: number;
  reminderHours: number[];
  escalationLevels: number;
  escalationStepHours: number;
}

/**
 * Everything the web app asks the backend to do. Two implementations behind one interface:
 * - InProcessBackend: the Lifecycle runs inside this Next.js process (single "mono" deployment).
 * - HttpBackend: calls the separately deployed Slack service (two-service deployment).
 * Chosen by SERVICE_URL. Every rule and permission check lives in the Lifecycle either way.
 */
export interface Backend {
  acknowledge(actor: Person, id: number): Promise<BackendResult>;
  attest(actor: Person, id: number, kind: string, notes: string): Promise<BackendResult>;
  remind(actor: Person, id: number): Promise<BackendResult>;
  escalate(actor: Person, id: number): Promise<BackendResult>;
  review(actor: Person, id: number): Promise<BackendResult>;
  reassign(actor: Person, id: number, personId: number): Promise<BackendResult>;
  retry(actor: Person, id: number): Promise<BackendResult>;
  retryAllFailed(actor: Person): Promise<BackendResult>;
  mapSlackUser(actor: Person, personId: number, slackUserId?: string): Promise<BackendResult>;
  savePolicy(actor: Person, p: PolicyInput): Promise<BackendResult>;
  uploadReport(actor: Person, csv: string, filename: string): Promise<BackendResult>;
  inspectPeople(actor: Person, csv: string): Promise<BackendResult>;
  importPeople(actor: Person, csv: string, mapping: PeopleMapping, dryRun: boolean, filename: string): Promise<BackendResult>;
  readSlackDirectory(actor: Person): Promise<BackendResult>;
  syncSlack(actor: Person, req: SlackSyncRequest): Promise<BackendResult>;
  createPerson(actor: Person, input: PersonInput): Promise<BackendResult>;
  updatePerson(actor: Person, id: number, input: PersonInput): Promise<BackendResult>;
  setSlackEnabled(actor: Person, enabled: boolean): Promise<BackendResult>;
  slackStatus(actor: Person): Promise<BackendResult>;
  sendTest(actor: Person, email?: string): Promise<BackendResult>;
}

// ---------------------------------------------------------------- in-process

class InProcessBackend implements Backend {
  private async rt() {
    const { getRuntime } = await import('@dd/core');
    const rt = getRuntime();
    await rt.start(); // idempotent; also covers a hot reload where instrumentation did not run
    return rt;
  }

  /** Turns thrown HttpError / validation errors into the same result shape the HTTP path returns. */
  private async run(fn: (rt: Awaited<ReturnType<InProcessBackend['rt']>>) => Promise<unknown>): Promise<BackendResult> {
    try {
      return { ok: true, data: await fn(await this.rt()) };
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status && err.status < 500) return { ok: false, error: err.message };
      console.error('[backend]', err);
      return { ok: false, error: 'Something went wrong. Check the server logs.' };
    }
  }

  acknowledge(a: Person, id: number) { return this.run((r) => r.lifecycle.acknowledge(id, a)); }
  attest(a: Person, id: number, kind: string, notes: string) { return this.run((r) => r.lifecycle.attest(id, a, { kind, notes })); }
  remind(a: Person, id: number) { return this.run((r) => r.lifecycle.remind(id, a)); }
  escalate(a: Person, id: number) { return this.run((r) => r.lifecycle.escalate(id, a)); }
  review(a: Person, id: number) { return this.run((r) => r.lifecycle.review(id, a)); }
  reassign(a: Person, id: number, personId: number) { return this.run((r) => r.lifecycle.reassign(id, personId, a)); }
  async retry(a: Person, id: number) { return this.run(async (r) => ({ result: await r.lifecycle.retryDelivery(id, a) })); }
  retryAllFailed(a: Person) { return this.run((r) => r.lifecycle.retryAllFailed(a)); }
  mapSlackUser(a: Person, personId: number, slackUserId?: string) { return this.run((r) => r.lifecycle.mapSlackUser(personId, a, slackUserId)); }
  savePolicy(a: Person, p: PolicyInput) { return this.run((r) => r.lifecycle.updatePolicy(a, p)); }
  async uploadReport(a: Person, csv: string, filename: string) {
    if (!a.isCompliance) return { ok: false, error: 'Compliance access required' };
    return this.run((r) => r.lifecycle.processReport(csv, { filename, source: 'web-upload' }));
  }
  inspectPeople(a: Person, csv: string) { return this.run(async (r) => r.lifecycle.inspectPeopleCsv(a, csv)); }
  importPeople(a: Person, csv: string, m: PeopleMapping, dryRun: boolean, filename: string) { return this.run((r) => r.lifecycle.importPeople(a, csv, m, { dryRun, filename })); }
  readSlackDirectory(a: Person) { return this.run((r) => r.lifecycle.readSlackDirectory(a)); }
  syncSlack(a: Person, req: SlackSyncRequest) { return this.run((r) => r.lifecycle.syncFromSlack(a, req)); }
  createPerson(a: Person, input: PersonInput) { return this.run((r) => r.lifecycle.createPerson(a, input)); }
  updatePerson(a: Person, id: number, input: PersonInput) { return this.run((r) => r.lifecycle.updatePersonDetails(a, id, input)); }
  setSlackEnabled(a: Person, enabled: boolean) { return this.run((r) => r.lifecycle.setSlackEnabled(a, enabled)); }
  async slackStatus(a: Person) {
    return this.run(async (r) => (await import('@dd/core')).slackStatus(r.lifecycle, a, r.cfg));
  }
  async sendTest(a: Person, email?: string) {
    return this.run(async (r) => (await import('@dd/core')).sendTest(r.lifecycle, a, (email ?? a.email).toLowerCase()));
  }
}

// ---------------------------------------------------------------------- http

class HttpBackend implements Backend {
  constructor(private base: string) {}

  private async call(actor: Person, method: string, path: string, body?: unknown, contentType = 'application/json'): Promise<BackendResult> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          'content-type': contentType,
          'x-dd-actor': actor.email,
          ...(process.env.INTERNAL_TOKEN ? { authorization: `Bearer ${process.env.INTERNAL_TOKEN}` } : {}),
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return res.ok ? { ok: true, data: json } : { ok: false, error: json.error ?? `Request failed (${res.status})` };
    } catch {
      return { ok: false, error: 'Could not reach the Slack service. Is it running?' };
    }
  }

  acknowledge(a: Person, id: number) { return this.call(a, 'POST', `/items/${id}/acknowledge`); }
  attest(a: Person, id: number, kind: string, notes: string) { return this.call(a, 'POST', `/items/${id}/attest`, { kind, notes }); }
  remind(a: Person, id: number) { return this.call(a, 'POST', `/items/${id}/remind`); }
  escalate(a: Person, id: number) { return this.call(a, 'POST', `/items/${id}/escalate`); }
  review(a: Person, id: number) { return this.call(a, 'POST', `/items/${id}/review`); }
  reassign(a: Person, id: number, personId: number) { return this.call(a, 'POST', `/items/${id}/reassign`, { personId }); }
  retry(a: Person, id: number) { return this.call(a, 'POST', `/items/${id}/retry`); }
  retryAllFailed(a: Person) { return this.call(a, 'POST', '/imports/retry-failed'); }
  mapSlackUser(a: Person, personId: number, slackUserId?: string) { return this.call(a, 'POST', `/people/${personId}/slack-map`, slackUserId ? { slackUserId } : {}); }
  savePolicy(a: Person, p: PolicyInput) { return this.call(a, 'PUT', '/policy', p); }
  uploadReport(a: Person, csv: string, filename: string) {
    if (!a.isCompliance) return Promise.resolve({ ok: false, error: 'Compliance access required' });
    return this.call(a, 'POST', `/reports?filename=${encodeURIComponent(filename)}&source=web-upload`, csv, 'text/csv');
  }
  inspectPeople(a: Person, csv: string) { return this.call(a, 'POST', '/people/import/inspect', csv, 'text/csv'); }
  importPeople(a: Person, csv: string, mapping: PeopleMapping, dryRun: boolean, filename: string) {
    return this.call(a, 'POST', '/people/import', { csv, mapping, dryRun, filename });
  }
  readSlackDirectory(a: Person) { return this.call(a, 'GET', '/people/slack-directory'); }
  syncSlack(a: Person, req: SlackSyncRequest) { return this.call(a, 'POST', '/people/slack-sync', req); }
  createPerson(a: Person, input: PersonInput) { return this.call(a, 'POST', '/people', input); }
  updatePerson(a: Person, id: number, input: PersonInput) { return this.call(a, 'PATCH', `/people/${id}`, input); }
  setSlackEnabled(a: Person, enabled: boolean) { return this.call(a, 'PUT', '/slack/enabled', { enabled }); }
  slackStatus(a: Person) { return this.call(a, 'GET', '/slack/status'); }
  sendTest(a: Person, email?: string) { return this.call(a, 'POST', '/slack/test', email ? { email } : {}); }
}

/** Mono deployment unless SERVICE_URL points at a separately deployed Slack service. */
export const isInProcess = (): boolean => !process.env.SERVICE_URL;

const g = globalThis as unknown as { __ddBackend?: Backend };
export function getBackend(): Backend {
  return (g.__ddBackend ??= isInProcess() ? new InProcessBackend() : new HttpBackend(process.env.SERVICE_URL!.replace(/\/$/, '')));
}
