import { App } from '@slack/bolt';
import type { Lifecycle } from './lifecycle.ts';
import { ACTION, ATTEST_MODAL, attestModal } from './blocks.ts';
import { HttpError } from './errors.ts';

/**
 * Slack interactivity over Socket Mode (an outbound WebSocket), so no public URL has to pass the OAP app gate.
 * Every handler maps the Slack user to a Person and goes through Lifecycle, the same code path the web app uses.
 */
export function createSlackApp(l: Lifecycle, tokens: { botToken: string; appToken: string }) {
  const app = new App({ token: tokens.botToken, appToken: tokens.appToken, socketMode: true });

  const personFor = async (slackUserId: string) => {
    const people = await l.store.listPeople();
    const p = people.find((x) => x.slackUserId === slackUserId);
    if (p) return p;
    const info = await app.client.users.info({ user: slackUserId });
    const email = info.user?.profile?.email?.toLowerCase();
    const byEmail = email ? people.find((x) => x.email === email) : undefined;
    if (byEmail) return l.store.updatePerson(byEmail.id, { slackUserId });
    throw new HttpError(403, 'Your Slack account is not linked to a Downloads Detective user');
  };

  const tell = (userId: string, channel: string, text: string) =>
    app.client.chat.postEphemeral({ channel, user: userId, text }).catch(() => undefined);

  app.action(ACTION.OPEN_WEB, async ({ ack }) => { await ack(); }); // link button: Slack opens the URL itself

  app.action(ACTION.ACK, async ({ ack, body, action }) => {
    await ack();
    try {
      const actor = await personFor(body.user.id);
      await l.acknowledge(Number((action as { value: string }).value), actor);
    } catch (e) {
      if (body.channel?.id) await tell(body.user.id, body.channel.id, (e as Error).message);
    }
  });

  app.action(ACTION.CONFIRM, async ({ ack, body, action, client }) => {
    await ack();
    const trigger = (body as { trigger_id: string }).trigger_id;
    try {
      const actor = await personFor(body.user.id);
      const item = await l.mustItem(Number((action as { value: string }).value));
      if (item.engineerId !== actor.id) throw new HttpError(403, 'Only the assigned engineer can do this');
      if (item.state === 'closed') return;
      await client.views.open({ trigger_id: trigger, view: attestModal(item) });
    } catch (e) {
      if (body.channel?.id) await tell(body.user.id, body.channel.id, (e as Error).message);
    }
  });

  app.view(ATTEST_MODAL, async ({ ack, body, view }) => {
    const kind = view.state.values.kind?.v?.selected_option?.value;
    const notes = view.state.values.notes?.v?.value ?? undefined;
    if (!kind) return void (await ack({ response_action: 'errors', errors: { kind: 'Choose what you did' } }));
    if (kind !== 'deleted' && !notes?.trim()) {
      return void (await ack({ response_action: 'errors', errors: { notes: 'Say where the files are, or why this does not apply' } }));
    }
    await ack();
    try {
      const actor = await personFor(body.user.id);
      await l.attest(Number(view.private_metadata), actor, { kind, notes });
    } catch (e) {
      await app.client.chat.postMessage({ channel: body.user.id, text: `Could not save your confirmation: ${(e as Error).message}` }).catch(() => undefined);
    }
  });

  return app;
}
