import { Network, ShieldCheck, UserX, Users } from 'lucide-react';
import { Kpi, PageHeader } from '@/components/dd/kpi';
import { PeopleImport } from '@/components/dd/people-import';
import { UsersTable, type UserRow } from '@/components/dd/users-table';
import { requireRole } from '@/lib/session';
import { childrenMap, subtreeIds } from '@dd/shared';

export default async function UsersPage() {
  const s = await requireRole('compliance');
  const { people, items } = s.world;
  const kids = childrenMap(people);
  const byId = new Map(people.map((p) => [p.id, p]));
  const open = new Map<number, number>();
  for (const i of items) if (i.state !== 'closed') open.set(i.engineerId, (open.get(i.engineerId) ?? 0) + 1);

  const rows: UserRow[] = people.map((p) => {
    const below = subtreeIds(people, p.id);
    return {
      id: p.id, name: p.name, email: p.email, title: p.title, team: p.team, managerId: p.managerId, managerName: p.managerId ? byId.get(p.managerId)?.name ?? null : null,
      slackUserId: p.slackUserId, isManager: p.isManager, isCompliance: p.isCompliance, active: p.active, reports: kids.get(p.id)?.length ?? 0, openItems: open.get(p.id) ?? 0,
      managerOptions: people.filter((m) => m.active && !below.has(m.id)).map((m) => ({ id: m.id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const active = rows.filter((r) => r.active);
  const teams = [...new Set(people.map((p) => p.team).filter((t): t is string => !!t))].sort();
  return (
    <>
      <PageHeader title="Users" subtitle="Who receives cleanup items, who they report to, and what they can see." actions={<PeopleImport />} />
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Active people" value={active.length} icon={Users} />
        <Kpi label="Managers" value={active.filter((r) => r.isManager || r.reports > 0).length} hint="Explicit or leading a team" icon={Network} />
        <Kpi label="Compliance" value={active.filter((r) => r.isCompliance).length} icon={ShieldCheck} />
        <Kpi label="Without a manager" value={active.filter((r) => r.managerId === null).length} hint="Escalations have nowhere to go" icon={UserX} tone={active.some((r) => r.managerId === null && r.reports === 0) ? 'danger' : undefined} />
      </div>
      <UsersTable rows={rows} teams={teams} meId={s.viewer.person.id} />
    </>
  );
}
