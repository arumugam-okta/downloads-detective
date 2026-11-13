'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Bell, CalendarDays, Check, ChevronsUpDown, FileText, History, LayoutDashboard, ListChecks, Moon, ScrollText, Search, Settings, ShieldCheck, Sun, Upload, Users } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { switchRole, switchUser } from '@/lib/actions';
import type { Role } from '@dd/shared';
import { cn } from '@/lib/utils';

export interface ShellProps {
  role: Role;
  roles: Role[];
  user: { name: string; email: string };
  scope: { value: string; label: string; options: Array<{ value: string; label: string; depth: number }>; trail: Array<{ label: string }>; show: boolean };
  range: { from: string; to: string; label: string };
  workspaceLabel: string;
  devUsers: Array<{ email: string; name: string; role: string }> | null;
  searchIndex: Array<{ kind: 'case' | 'person'; label: string; hint: string; href: string }>;
  children: React.ReactNode;
}

const NAV: Record<Role, Array<{ href: string; label: string; icon: typeof Users }>> = {
  engineer: [{ href: '/cleanup', label: 'My cleanup', icon: ListChecks }, { href: '/history', label: 'History', icon: History }],
  manager: [{ href: '/team', label: 'My team', icon: Users }, { href: '/items', label: 'Items', icon: ListChecks }, { href: '/reports', label: 'Reports', icon: LayoutDashboard }],
  compliance: [
    { href: '/overview', label: 'Overview', icon: LayoutDashboard }, { href: '/teams', label: 'Teams', icon: Users }, { href: '/items', label: 'Items', icon: ListChecks },
    { href: '/ingestion', label: 'Ingestion', icon: Upload }, { href: '/audit', label: 'Audit log', icon: ScrollText }, { href: '/settings', label: 'Settings', icon: Settings },
  ],
};
const ROLE_TITLE: Record<Role, string> = { engineer: 'Engineer', manager: 'Manager', compliance: 'Compliance' };
const ROLE_PAGE: Record<Role, string> = { engineer: 'My cleanup', manager: 'My team', compliance: 'Overview' };

function useParamLink() {
  const sp = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v === null ? next.delete(k) : next.set(k, v));
    return next.toString();
  };
}

function ScopeSwitcher({ scope }: { scope: ShellProps['scope'] }) {
  const router = useRouter();
  const path = usePathname();
  const build = useParamLink();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-44 justify-start gap-2 font-normal"><Users className="size-4" /><span className="truncate">{scope.label}</span></Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <div className="px-3 pt-3 pb-1 text-sm font-semibold">Switch scope</div>
          <CommandInput placeholder="Search hierarchy…" />
          <CommandList>
            <CommandEmpty>No unit found.</CommandEmpty>
            <CommandGroup>
              {scope.options.map((o) => (
                <CommandItem key={o.value} value={o.label} onSelect={() => { setOpen(false); router.push(`${path}?${build({ scope: o.depth === 0 ? null : o.value })}`); }}>
                  <span style={{ paddingLeft: o.depth * 12 }} className="flex-1">{o.label}</span>
                  {o.value === scope.value && <Check className="size-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function DateRange({ range }: { range: ShellProps['range'] }) {
  const router = useRouter();
  const path = usePathname();
  const build = useParamLink();
  const [open, setOpen] = useState(false);
  const toD = (s: string) => new Date(`${s}T12:00:00`);
  const [sel, setSel] = useState<{ from?: Date; to?: Date }>({ from: toD(range.from), to: toD(range.to) });
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const go = (from: Date, to: Date) => { setOpen(false); router.push(`${path}?${build({ from: iso(from), to: iso(to) })}`); };
  const preset = (days: number) => { const to = new Date(); const from = new Date(to.getTime() - (days - 1) * 86_400_000); go(from, to); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2 font-normal"><CalendarDays className="size-4" />{range.label}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex gap-2 border-b p-2">
          {[7, 14, 28, 90].map((d) => <Button key={d} size="sm" variant="ghost" onClick={() => preset(d)}>Last {d}d</Button>)}
        </div>
        <Calendar mode="range" numberOfMonths={2} selected={sel.from ? { from: sel.from, to: sel.to } : undefined} onSelect={(r) => setSel({ from: r?.from, to: r?.to })} />
        <div className="flex justify-end gap-2 border-t p-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={!sel.from || !sel.to} onClick={() => sel.from && sel.to && go(sel.from, sel.to)}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GlobalSearch({ index }: { index: ShellProps['searchIndex'] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setOpen((o) => !o); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <Button variant="outline" className="w-60 justify-start gap-2 font-normal text-muted-foreground" onClick={() => setOpen(true)}>
        <Search className="size-4" /><span className="flex-1 text-left">Search cases, people…</span>
        <kbd className="rounded border px-1 text-[10px]">⌘K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search cases, engineers and files">
        <Command>
          <CommandInput placeholder="Search cases, engineers and files" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading="Results">
              {index.map((r) => (
                <CommandItem key={r.href + r.label} value={`${r.label} ${r.hint}`} onSelect={() => { setOpen(false); router.push(r.href); }}>
                  {r.kind === 'case' ? <FileText className="size-4" /> : <Users className="size-4" />}
                  <span>{r.label}</span><span className="ml-auto text-xs text-muted-foreground">{r.hint}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
      {mounted && resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

function UserMenu({ p }: { p: ShellProps }) {
  const [, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2">{ROLE_TITLE[p.role]}<ChevronsUpDown className="size-3.5 opacity-60" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal"><div className="text-sm font-semibold">{p.user.name}</div><div className="text-xs text-muted-foreground">{p.user.email}</div></DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">View as</DropdownMenuLabel>
        {p.roles.map((r) => (
          <DropdownMenuItem key={r} onSelect={() => start(() => switchRole(r))}>
            <span className="flex-1">{ROLE_TITLE[r]} · {ROLE_PAGE[r]}</span>{r === p.role && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        {p.devUsers && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Sign in as (dev only)</DropdownMenuLabel>
            {p.devUsers.map((u) => (
              <DropdownMenuItem key={u.email} onSelect={() => start(() => switchUser(u.email))}>
                <span className="flex-1">{u.name}</span><span className="text-xs text-muted-foreground">{u.role}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Shell(p: ShellProps) {
  const path = usePathname();
  const sp = useSearchParams();
  const keep = useMemo(() => { const n = new URLSearchParams(); for (const k of ['scope', 'from', 'to']) { const v = sp.get(k); if (v) n.set(k, v); } const s = n.toString(); return s ? `?${s}` : ''; }, [sp]);
  const crumbs = p.role === 'engineer' ? ['Personal workspace'] : p.scope.trail.map((t) => t.label);
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="gap-4 p-4">
          <Link href="/" className="flex items-center gap-2.5 font-semibold leading-tight"><ShieldCheck className="size-7 text-primary" /><span>Downloads<br />Detective</span></Link>
          <div className="rounded-lg border px-3 py-2"><div className="text-sm font-medium">Acme engineering</div><div className="text-xs text-muted-foreground">{p.workspaceLabel}</div></div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] tracking-wide uppercase">Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV[p.role].map((n) => (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton asChild isActive={path === n.href || path.startsWith(`${n.href}/`)}>
                      <Link href={`${n.href}${n.href === '/cleanup' || n.href === '/history' ? '' : keep}`}><n.icon /><span>{n.label}</span></Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="gap-3 p-3">
          <div className="rounded-lg border p-3 text-sm"><ShieldCheck className="mb-1 size-4 text-muted-foreground" /><div className="font-medium">Keep customer data safe</div><div className="text-xs text-muted-foreground">View cleanup policy ↗</div></div>
          <div className="border-t px-1 pt-3 text-sm"><div className="font-medium">{p.user.name}</div><div className="text-xs text-muted-foreground">{ROLE_TITLE[p.role]} · Switch role</div></div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        <header className="flex h-16 items-center gap-3 border-b bg-card px-6">
          <nav className="flex-1 truncate text-sm text-muted-foreground" aria-label="Breadcrumb">
            {crumbs.map((c, i) => <span key={i}>{i > 0 && <span className="mx-1.5">/</span>}<span className={cn(i === crumbs.length - 1 && 'text-foreground')}>{c}</span></span>)}
          </nav>
          {p.scope.show && <ScopeSwitcher scope={p.scope} />}
          <DateRange range={p.range} />
          <GlobalSearch index={p.searchIndex} />
          <ThemeToggle />
          <Button variant="ghost" size="icon" aria-label="Notifications"><Bell className="size-4" /></Button>
          <UserMenu p={p} />
        </header>
        <main className="mx-auto w-full max-w-[1200px] space-y-6 px-8 py-8">{p.children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
