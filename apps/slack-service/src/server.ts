import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Person } from '@dd/shared';
import { Lifecycle } from './lifecycle.ts';
import { HttpError } from './errors.ts';
import { ReportFormatError } from './ingest.ts';
import { runSlaTick } from './sla.ts';
import { ConsoleNotifier } from './notifier.ts';
import { sendTest } from './test-message.ts';
import type { ServiceConfig } from './config.ts';

/** The web app sends this header with the signed-in user's email. It is only trusted with the bearer token. */
const ACTOR_HEADER = 'x-dd-actor';

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

  // engineer
  app.post('/items/:id/acknowledge', async (req) => l.acknowledge(id(req), await actorOf(req)));
  app.post('/items/:id/attest', async (req) => l.attest(id(req), await actorOf(req), req.body));

  // manager
  app.post('/items/:id/remind', async (req) => l.remind(id(req), await actorOf(req)));
  app.post('/items/:id/escalate', async (req) => l.escalate(id(req), await actorOf(req)));
  app.post('/items/:id/review', async (req) => l.review(id(req), await actorOf(req)));
  app.post('/items/:id/reassign', async (req) => {
    const { personId } = z.object({ personId: z.number().int().positive() }).parse(req.body);
    return l.reassign(id(req), personId, await actorOf(req));
  });

  // compliance
  app.post('/items/:id/retry', async (req) => ({ result: await l.retryDelivery(id(req), await actorOf(req)) }));
  app.post('/imports/retry-failed', async (req) => l.retryAllFailed(await actorOf(req)));
  app.post('/people/:id/slack-map', async (req) => {
    const { slackUserId } = z.object({ slackUserId: z.string().regex(/^[UW][A-Z0-9]{2,}$/, 'Not a Slack member ID').optional() }).parse(req.body ?? {});
    return l.mapSlackUser(id(req), await actorOf(req), slackUserId);
  });
  app.put('/policy', async (req) => {
    const actor = await actorOf(req);
    if (!actor.isCompliance) throw new HttpError(403, 'Compliance access required');
    const body = z.object({
      slaDays: z.number().int().min(1).max(30),
      reminderHours: z.array(z.number().int().min(1)).min(0).max(5),
      directorAfterBreachHours: z.number().int().min(1).max(168),
    }).parse(req.body);
    await l.store.setPolicy(body, actor.id);
    await l.audit({ actorId: actor.id, actorLabel: actor.name, action: 'policy_changed', detail: `SLA ${body.slaDays} days; reminders at ${body.reminderHours.join('h, ')}h` });
    return body;
  });

  // Slack status and a one-click test, both for compliance. Reports what this process actually runs with.
  app.get('/slack/status', async (req) => {
    const actor = await actorOf(req);
    if (!actor.isCompliance) throw new HttpError(403, 'Compliance access required');
    const live = !(l.deps.notifier instanceof ConsoleNotifier);
    return { mode: live ? 'live' : 'dev', botToken: !!cfg.slack.botToken, interactive: !!cfg.slack.appToken, webUrl: cfg.webUrl };
  });
  app.post('/slack/test', async (req) => {
    const actor = await actorOf(req);
    if (!actor.isCompliance) throw new HttpError(403, 'Compliance access required');
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
