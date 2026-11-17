'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Network, Search, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { createPerson, updatePerson } from '@/lib/actions';
import { cn } from '@/lib/utils';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  title: string | null;
  team: string | null;
  managerId: number | null;
  managerName: string | null;
  slackUserId: string | null;
  department: string | null;
  costCenter: string | null;
  managerSource: 'slack' | 'manual' | null;
  isManager: boolean;
  isCompliance: boolean;
  active: boolean;
  reports: number;
  openItems: number;
  /** Everyone this person may be moved under: not themselves, not anyone below them, and active. */
  managerOptions: Array<{ id: number; name: string }>;
}

const initials = (n: string) => n.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

function RolePill({ children, tone }: { children: React.ReactNode; tone: 'manager' | 'compliance' | 'engineer' | 'off' }) {
  const cls = { manager: 'bg-st-ack-bg text-st-ack', compliance: 'bg-st-closed-bg text-st-closed', engineer: 'bg-muted text-muted-foreground', off: 'bg-muted text-muted-foreground line-through' }[tone];
  return <span className={cn('inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium', cls)}>{children}</span>;
}

type RoleFilter = 'all' | 'manager' | 'compliance' | 'inactive' | 'no-manager' | 'no-slack';
const FILTERS: Array<{ key: RoleFilter; label: string }> = [
  { key: 'all', label: 'Everyone' }, { key: 'manager', label: 'Managers' }, { key: 'compliance', label: 'Compliance' },
  { key: 'no-manager', label: 'No manager' }, { key: 'no-slack', label: 'No Slack' }, { key: 'inactive', label: 'Inactive' },
];

export function UsersTable({ rows, teams, meId }: { rows: UserRow[]; teams: string[]; meId: number }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [team, setTeam] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const counts = useMemo(() => ({
    all: rows.filter((r) => r.active).length,
    manager: rows.filter((r) => r.active && (r.isManager || r.reports > 0)).length,
    compliance: rows.filter((r) => r.active && r.isCompliance).length,
    'no-manager': rows.filter((r) => r.active && r.managerId === null).length,
    'no-slack': rows.filter((r) => r.active && !r.slackUserId).length,
    inactive: rows.filter((r) => !r.active).length,
  }), [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !`${r.name} ${r.email} ${r.title ?? ''} ${r.team ?? ''}`.toLowerCase().includes(needle)) return false;
      if (team && r.team !== team) return false;
      switch (filter) {
        case 'manager': return r.active && (r.isManager || r.reports > 0);
        case 'compliance': return r.active && r.isCompliance;
        case 'inactive': return !r.active;
        case 'no-manager': return r.active && r.managerId === null;
        case 'no-slack': return r.active && !r.slackUserId;
        default: return r.active;
      }
    });
  }, [rows, q, filter, team]);

  const editing = rows.find((r) => r.id === editId) ?? null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, team…" className="pl-8" aria-label="Search people" />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter people">
          {FILTERS.map((f) => (
            <button
              key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors', filter === f.key ? 'border-primary bg-accent font-medium text-accent-foreground' : 'bg-card hover:bg-accent/50')}
            >
              {f.label}<span className="text-xs text-muted-foreground tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <select aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} className="ml-auto h-8 rounded-lg border bg-card px-2 text-sm">
          <option value="">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button onClick={() => setAdding(true)}><UserPlus className="size-4" />Add person</Button>
      </div>

      <section className="rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>{['Person', 'Team', 'Manager', 'Roles', 'Slack', 'Open items'].map((h) => <th key={h} className="px-4 py-2 text-left font-medium first:px-5">{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={cn('cursor-pointer border-t hover:bg-accent/50', !r.active && 'opacity-60')} tabIndex={0} onClick={() => setEditId(r.id)} onKeyDown={(e) => e.key === 'Enter' && setEditId(r.id)}>
                <td className="px-5 py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8"><AvatarFallback>{initials(r.name)}</AvatarFallback></Avatar>
                    <div className="min-w-0"><div className="truncate font-medium">{r.name}{r.id === meId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}</div><div className="truncate text-xs text-muted-foreground">{r.title ? `${r.title} · ` : ''}{r.email}</div></div>
                  </div>
                </td>
                <td className="px-4 text-muted-foreground"><div>{r.team ?? '—'}</div>{r.costCenter && <div className="text-[11px]">CC {r.costCenter}</div>}</td>
                <td className="px-4">{r.managerName ?? <span className="text-muted-foreground">—</span>}{r.managerName && r.managerSource === 'slack' && <span className="ml-1.5 text-[11px] text-muted-foreground">via Slack</span>}</td>
                <td className="px-4">
                  <div className="flex flex-wrap gap-1">
                    <RolePill tone={r.active ? 'engineer' : 'off'}>{r.active ? 'Engineer' : 'Inactive'}</RolePill>
                    {r.active && (r.isManager || r.reports > 0) && <RolePill tone="manager">Manager{r.reports > 0 ? ` · ${r.reports}` : ''}</RolePill>}
                    {r.active && r.isCompliance && <RolePill tone="compliance">Compliance</RolePill>}
                  </div>
                </td>
                <td className="px-4">{r.slackUserId ? <span className="text-xs text-muted-foreground">{r.slackUserId}</span> : <span className="text-xs text-st-triage">Not mapped</span>}</td>
                <td className="px-4 tabular-nums">{r.openItems || <span className="text-muted-foreground">0</span>}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">No people match. Try clearing the search or filters.</td></tr>}
          </tbody>
        </table>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">Showing {shown.length} of {rows.length} people</p>
      </section>

      <EditSheet key={editing?.id ?? 'none'} row={editing} meId={meId} onClose={() => setEditId(null)} />
      <AddDialog open={adding} onOpenChange={setAdding} options={rows.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }))} teams={teams} />
    </>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label htmlFor={htmlFor}>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

function RoleRow({ icon: Icon, title, desc, children }: { icon: typeof Users; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
      <div className="flex-1"><div className="text-sm font-medium">{title}</div><div className="text-xs text-muted-foreground">{desc}</div></div>
      {children}
    </div>
  );
}

function EditSheet({ row, meId, onClose }: { row: UserRow | null; meId: number; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState(() => row && ({
    name: row.name, title: row.title ?? '', team: row.team ?? '', managerId: row.managerId ? String(row.managerId) : '', slack: row.slackUserId ?? '',
    isManager: row.isManager, isCompliance: row.isCompliance, active: row.active,
  }));
  const isMe = row?.id === meId;
  const save = () => row && f && start(async () => {
    const r = await updatePerson(row.id, {
      name: f.name, title: f.title || null, team: f.team || null, managerId: f.managerId ? Number(f.managerId) : null, slackUserId: f.slack || null,
      isManager: f.isManager, isCompliance: f.isCompliance, active: f.active,
    });
    if (!r.ok) return void toast.error(r.error ?? 'Could not save');
    toast.success('Saved'); onClose(); router.refresh();
  });
  return (
    <Sheet open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[440px] overflow-y-auto sm:max-w-[440px]">
        {row && f && (
          <>
            <SheetHeader><SheetTitle className="text-xl">{row.name}</SheetTitle><SheetDescription>{row.email} · {row.openItems} open item{row.openItems === 1 ? '' : 's'}</SheetDescription></SheetHeader>
            <div className="space-y-5 px-4">
              <Field label="Full name" htmlFor="u-name"><Input id="u-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Job title" htmlFor="u-title"><Input id="u-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
                <Field label="Team" htmlFor="u-team"><Input id="u-team" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} /></Field>
              </div>
              <Field label="Reports to" htmlFor="u-mgr" hint="Escalations go to this person, then to their manager.">
                <select id="u-mgr" value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
                  <option value="">No manager</option>
                  {row.managerOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
              <Field label="Slack member ID" htmlFor="u-slack" hint="Leave blank to look it up by email on the next delivery."><Input id="u-slack" value={f.slack} onChange={(e) => setF({ ...f, slack: e.target.value })} placeholder="U01ABC23DE" /></Field>

              <div className="space-y-2">
                <div className="text-sm font-semibold">Roles</div>
                <RoleRow icon={Users} title="Engineer" desc="Everyone receives and confirms their own cleanup items.">
                  <Switch checked disabled aria-label="Engineer" />
                </RoleRow>
                <RoleRow icon={Network} title="Manager" desc={row.reports > 0 ? `Leads ${row.reports} ${row.reports === 1 ? 'person' : 'people'}, so this is always on.` : 'Sees their team’s items and gets escalations.'}>
                  <Switch checked={f.isManager || row.reports > 0} disabled={row.reports > 0} onCheckedChange={(v) => setF({ ...f, isManager: v })} aria-label="Manager" />
                </RoleRow>
                <RoleRow icon={ShieldCheck} title="Compliance" desc={isMe ? 'You cannot remove your own access.' : 'Sees the whole organization, imports reports and manages users.'}>
                  <Switch checked={f.isCompliance} disabled={isMe} onCheckedChange={(v) => setF({ ...f, isCompliance: v })} aria-label="Compliance" />
                </RoleRow>
              </div>

              <RoleRow icon={Users} title="Active" desc={isMe ? 'You cannot deactivate yourself.' : 'Inactive people stop receiving items and cannot sign in.'}>
                <Switch checked={f.active} disabled={isMe} onCheckedChange={(v) => setF({ ...f, active: v })} aria-label="Active" />
              </RoleRow>
            </div>
            <SheetFooter className="flex-row justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AddDialog({ open, onOpenChange, options, teams }: { open: boolean; onOpenChange: (o: boolean) => void; options: Array<{ id: number; name: string }>; teams: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const blank = { email: '', name: '', title: '', team: '', managerId: '', isManager: false, isCompliance: false };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const submit = () => start(async () => {
    const r = await createPerson({
      email: f.email, ...(f.name ? { name: f.name } : {}), title: f.title || null, team: f.team || null,
      managerId: f.managerId ? Number(f.managerId) : null, isManager: f.isManager, isCompliance: f.isCompliance,
    });
    if (!r.ok) return setError(r.error ?? 'Could not add');
    toast.success('Person added'); setF(blank); setError(null); onOpenChange(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="text-xl">Add person</DialogTitle><DialogDescription>They will receive cleanup items as soon as a report names them.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Email" htmlFor="a-email"><Input id="a-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@company.com" autoFocus /></Field>
          <Field label="Full name" htmlFor="a-name" hint="Defaults to a name derived from the email."><Input id="a-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Job title" htmlFor="a-title"><Input id="a-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Team" htmlFor="a-team"><Input id="a-team" list="a-teams" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} /><datalist id="a-teams">{teams.map((t) => <option key={t} value={t} />)}</datalist></Field>
          </div>
          <Field label="Reports to" htmlFor="a-mgr">
            <select id="a-mgr" value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })} className="h-9 w-full rounded-lg border bg-background px-2 text-sm">
              <option value="">No manager</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2"><Switch checked={f.isManager} onCheckedChange={(v) => setF({ ...f, isManager: v })} />Manager</label>
            <label className="flex items-center gap-2"><Switch checked={f.isCompliance} onCheckedChange={(v) => setF({ ...f, isCompliance: v })} />Compliance</label>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={pending || !f.email}>{pending ? 'Adding…' : 'Add person'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
