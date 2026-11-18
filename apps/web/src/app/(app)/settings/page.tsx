import { FileText, MessageSquare, Users } from 'lucide-react';
import { PageHeader } from '@/components/dd/kpi';
import { PolicyForm } from '@/components/dd/policy-form';
import { SlackSwitch } from '@/components/dd/slack-switch';
import { SlackTest } from '@/components/dd/slack-test';
import { getSlackStatus } from '@/lib/actions';
import { getSession, getStore, requireRole } from '@/lib/session';

export default async function Settings() {
  const s = await requireRole('compliance');
  const [policy, slack] = await Promise.all([getStore().then((st) => st.getPolicy()), getSlackStatus()]);
  const mode = slack ? slack.mode : 'unreachable';
  const slackDetail = mode === 'live'
    ? `Connected via bot token${slack?.interactive ? ' · buttons enabled' : ' · buttons disabled (no app token)'}`
    : mode === 'dev' ? 'Dev mode: messages are logged, not sent' : 'The Slack service is not reachable';
  const tone = mode === 'live' && slack?.interactive ? 'text-st-closed' : 'text-st-triage';
  const toneLabel = mode === 'live' ? (slack?.interactive ? 'Connected' : 'Connected, no buttons') : mode === 'dev' ? 'Dev mode' : 'Unreachable';
  void getSession;

  return (
    <>
      <PageHeader title="Settings" subtitle="Organization-wide policy and delivery controls." />
      <SlackSwitch enabled={policy.slackEnabled} pausedAt={policy.slackPausedAt} held={s.world.items.filter((i) => i.state === 'open' && !i.slackChannel).length} connected={slack?.mode === 'live'} />
      <div className="grid grid-cols-[1fr_340px] gap-4">
        <section className="rounded-xl border bg-card p-6"><PolicyForm initial={policy} /></section>
        <section className="self-start rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold">Connected services</h2>
          <ul className="mt-5 space-y-6">
            <li className="flex gap-3"><FileText className="mt-0.5 size-5 text-primary" aria-hidden /><div><div className="text-sm font-semibold">Salesforce report</div><div className="text-xs text-muted-foreground">CSV · Daily at 06:00 UTC</div><div className="mt-1 text-xs font-medium text-st-closed">Connected</div></div></li>
            <li className="flex gap-3"><MessageSquare className="mt-0.5 size-5 text-primary" aria-hidden /><div><div className="text-sm font-semibold">Slack workspace</div><div className="text-xs text-muted-foreground">{slackDetail}</div><div className={`mt-1 text-xs font-medium ${tone}`}>{toneLabel}</div></div></li>
            <li className="flex gap-3"><Users className="mt-0.5 size-5 text-primary" aria-hidden /><div><div className="text-sm font-semibold">Organization directory</div><div className="text-xs text-muted-foreground">HR sync · Daily at 05:30 UTC</div><div className="mt-1 text-xs font-medium text-st-closed">Connected</div></div></li>
          </ul>
          <SlackTest defaultEmail={s.viewer.person.email} mode={mode} disabled={!policy.slackEnabled} />
        </section>
      </div>
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Retention and access</h2>
        <dl className="mt-4 divide-y text-sm">
          {[['Source CSV retention', '90 days'], ['Audit and attestation retention', '7 years · Policy COM-17'], ['Scope model', 'Reporting hierarchy · Least privilege']].map(([k, v]) => (
            <div key={k} className="grid grid-cols-2 py-3"><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Policy changes are versioned and logged. Existing cleanup due dates are not changed retroactively.</p>
      </section>
    </>
  );
}
