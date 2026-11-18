import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, ReportFormatError, runSlaTick, sendTest, slackStatus, type Lifecycle, type ServiceConfig } from '@dd/core';
import type { Person } from '@dd/shared';
import { ConsoleNotifier } from '@dd/core';

/** The web app sends this header with the signed-in user's email. It is only trusted with the bearer token. */
const ACTOR_HEADER = 'x-dd-actor';

/**
 * Thin HTTP layer for the two-service topology: authenticates the caller, resolves the actor, then calls the
 * Lifecycle, which owns every rule and permission check. The same Lifecycle runs in-process in the mono app.
 */
export async function buildServer(l: Lifecycle, cfg: ServiceConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 20 * 1024 * 1024 });
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ReportFormatError) return reply.code(400).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  app.addHook('onRequest', async (req) => {
    if (req.url === '/healthz') return;
    if (!cfg.internalToken) return; // dev: loopback-only (see config.host)
    const given = req.headers.authorization?.replace(/^Bearer /i, '');
    if (given !== cfg.internalToken) throw new HttpError(401, 'Unauthorized');
  });

  const actorOf = async (req: FastifyRequest): Promise<Person> => {
    const email = String(req.headers[ACTOR_HEADER] ?? '').trim().toLowerCase();
    if (!email) throw new HttpError(401, `Missing ${ACTOR_HEADER} header`);
    const p = await l.store.getPersonByEmail(email);
    if (!p || !p.active) throw new HttpError(403, 'Unknown or inactive user');
    return p;
  };
  const id = (req: FastifyRequest) => z.coerce.number().int().positive().parse((req.params as { id: string }).id);

  app.get('/healthz', async () => ({ ok: true }));

  app.post<{ Body: string; Querystring: { filename?: string; source?: string } }>('/reports', async (req) => {
    if (typeof req.body !== 'string' || !req.body.trim()) throw new HttpError(400, 'Send the CSV as the request body with Content-Type: text/csv');
    return l.processReport(req.body, { filename: req.query.filename ?? `upload_${new Date().toISOString().slice(0, 10)}.csv`, source: req.query.source ?? 'api' });
  });

  app.post('/items/:id/acknowledge', async (req) => l.acknowledge(id(req), await actorOf(req)));
  app.post('/items/:id/attest', async (req) => l.attest(id(req), await actorOf(req), req.body));
  app.post('/items/:id/remind', async (req) => l.remind(id(req), await actorOf(req)));
  app.post('/items/:id/escalate', async (req) => l.escalate(id(req), await actorOf(req)));
  app.post('/items/:id/review', async (req) => l.review(id(req), await actorOf(req)));
  app.post('/items/:id/reassign', async (req) => {
    const { personId } = z.object({ personId: z.number().int().positive() }).parse(req.body);
    return l.reassign(id(req), personId, await actorOf(req));
  });
  app.post('/items/:id/retry', async (req) => ({ result: await l.retryDelivery(id(req), await actorOf(req)) }));
  app.post('/imports/retry-failed', async (req) => l.retryAllFailed(await actorOf(req)));
  app.post('/people/:id/slack-map', async (req) => {
    const { slackUserId } = z.object({ slackUserId: z.string().regex(/^[UW][A-Z0-9]{2,}$/, 'Not a Slack member ID').optional() }).parse(req.body ?? {});
    return l.mapSlackUser(id(req), await actorOf(req), slackUserId);
  });
  const personInput = z.object({
    name: z.string().optional(), email: z.string().optional(), title: z.string().nullable().optional(), team: z.string().nullable().optional(),
    managerId: z.number().int().positive().nullable().optional(), slackUserId: z.string().nullable().optional(),
    isManager: z.boolean().optional(), isCompliance: z.boolean().optional(), active: z.boolean().optional(),
  });
  app.post('/people', async (req) => l.createPerson(await actorOf(req), personInput.parse(req.body ?? {})));
  app.patch('/people/:id', async (req) => l.updatePersonDetails(await actorOf(req), id(req), personInput.parse(req.body ?? {})));
  app.post<{ Body: string }>('/people/import/inspect', async (req) => {
    if (typeof req.body !== 'string' || !req.body.trim()) throw new HttpError(400, 'Send the CSV as the request body with Content-Type: text/csv');
    return l.inspectPeopleCsv(await actorOf(req), req.body);
  });
  app.post('/people/import', async (req) => {
    const b = z.object({ csv: z.string().min(1), mapping: z.record(z.string(), z.string()), dryRun: z.boolean(), filename: z.string().optional() }).parse(req.body);
    return l.importPeople(await actorOf(req), b.csv, b.mapping, { dryRun: b.dryRun, ...(b.filename ? { filename: b.filename } : {}) });
  });
  app.get('/people/slack-directory', async (req) => l.readSlackDirectory(await actorOf(req)));
  app.post('/people/slack-sync', async (req) => {
    const b = z.object({
      snapshotId: z.string().min(1), mapping: z.record(z.string(), z.string()), selected: z.array(z.string()).max(5000),
      withChain: z.boolean(), overwrite: z.boolean(), dryRun: z.boolean(),
    }).parse(req.body ?? {});
    return l.syncFromSlack(await actorOf(req), b);
  });
  app.put('/policy', async (req) => l.updatePolicy(await actorOf(req), req.body));
  app.put('/slack/enabled', async (req) => l.setSlackEnabled(await actorOf(req), z.object({ enabled: z.boolean() }).parse(req.body ?? {}).enabled));
  app.get('/slack/status', async (req) => slackStatus(l, await actorOf(req), cfg));
  app.post('/slack/test', async (req) => {
    const actor = await actorOf(req);
    const { email } = z.object({ email: z.string().trim().toLowerCase().email().optional() }).parse(req.body ?? {});
    return sendTest(l, actor, email ?? actor.email);
  });

  // SLA tick: also driven by the in-process timer; safe to call from an external cron as a backstop.
  app.post('/internal/sla-tick', async () => runSlaTick(l));

  if (l.deps.notifier instanceof ConsoleNotifier) {
    const dev = l.deps.notifier;
    app.get('/dev/outbox', async () => dev.outbox);
  }

  return app;
}
