-- Downloads Detective schema.
--
-- Table names are deliberately unqualified (no "public." prefix): they land in whichever schema the migration
-- runs against, which on OAP is the tenant schema. Every statement is idempotent, so re-applying is safe.
-- Prefixed dd_ to stay clear of the platform's auth_* / scim_* tables.

create sequence if not exists dd_item_ref_seq start 1;

create table if not exists dd_people (
  id            serial primary key,
  email         text not null unique check (email = lower(email)),
  name          text not null,
  title         text,
  team          text,
  manager_id    int references dd_people(id),
  slack_user_id text,
  is_compliance boolean not null default false,
  active        boolean not null default true
);
create index if not exists dd_people_manager_idx on dd_people (manager_id);

create table if not exists dd_report_imports (
  id             serial primary key,
  filename       text not null,
  source         text not null,
  received_at    timestamptz not null default now(),
  rows_total     int not null default 0,
  duplicate_rows int not null default 0,
  items_created  int not null default 0,
  items_updated  int not null default 0,
  failures       int not null default 0
);

-- State is stored; "overdue" is derived (open or acknowledged, and now() > due_at).
create table if not exists dd_cleanup_items (
  id                   serial primary key,
  ref                  text not null unique default ('DD-' || lpad(nextval('dd_item_ref_seq')::text, 4, '0')),
  engineer_id          int not null references dd_people(id),
  case_number          text not null,
  case_subject         text,
  case_closed_at       timestamptz not null,
  due_at               timestamptz not null,
  state                text not null default 'open' check (state in ('open','acknowledged','closed','triage','failed')),
  error                text,
  created_import_id    int references dd_report_imports(id),
  created_at           timestamptz not null default now(),
  acknowledged_at      timestamptz,
  reminders_sent       int[] not null default '{}',
  breach_notified_at   timestamptz,
  director_notified_at timestamptz,
  attestation_kind     text check (attestation_kind in ('deleted','approved_location','not_applicable')),
  attestation_notes    text,
  attested_at          timestamptz,
  reviewed_by          int references dd_people(id),
  reviewed_at          timestamptz,
  slack_channel        text,
  slack_ts             text,
  unique (engineer_id, case_number),
  -- A closed item must carry its evidence.
  check (state <> 'closed' or (attestation_kind is not null and attested_at is not null))
);
create index if not exists dd_items_engineer_idx on dd_cleanup_items (engineer_id);
create index if not exists dd_items_open_due_idx on dd_cleanup_items (due_at) where state in ('open','acknowledged');

create table if not exists dd_item_files (
  fingerprint   text primary key,
  item_id       int not null references dd_cleanup_items(id) on delete cascade,
  filename      text not null,
  downloaded_on timestamptz not null
);
create index if not exists dd_item_files_item_idx on dd_item_files (item_id);

-- Rows that need a human: no Slack user (triage) or a delivery/validation failure (failed).
create table if not exists dd_import_issues (
  id            serial primary key,
  import_id     int not null references dd_report_imports(id),
  item_id       int references dd_cleanup_items(id),
  row_no        int,
  downloaded_by text not null,
  issue         text not null,
  kind          text not null check (kind in ('triage','failed')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists dd_import_issues_open_idx on dd_import_issues (id) where resolved_at is null;

create table if not exists dd_audit_events (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    int references dd_people(id),
  actor_label text not null,
  action      text not null,
  item_id     int references dd_cleanup_items(id),
  import_id   int references dd_report_imports(id),
  detail      text
);
create index if not exists dd_audit_at_idx on dd_audit_events (at desc);
create index if not exists dd_audit_item_idx on dd_audit_events (item_id);

-- Append-only for every role, the table owner included.
create or replace function dd_audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'dd_audit_events is append-only';
end $$;
drop trigger if exists dd_audit_no_change on dd_audit_events;
create trigger dd_audit_no_change before update or delete on dd_audit_events
  for each row execute function dd_audit_immutable();

-- Versioned policy: a change adds a row; existing due dates are never recomputed.
create table if not exists dd_policy_settings (
  key        text not null,
  version    int not null,
  value      jsonb not null,
  changed_by int references dd_people(id),
  at         timestamptz not null default now(),
  primary key (key, version)
);

-- Row-level security: on, with no policy for anon/authenticated, so the browser keys see nothing.
-- Only the server-side service key (which the OAP gateway maps to <schema>_service) reads or writes.
-- The policy below is created only if that role exists, so the same file also runs on a plain Postgres.
do $$
declare
  t text;
  svc text := current_schema() || '_service';
begin
  foreach t in array array['dd_people','dd_report_imports','dd_cleanup_items','dd_item_files','dd_import_issues','dd_audit_events','dd_policy_settings']
  loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = svc) then
      execute format('drop policy if exists dd_service_all on %I', t);
      execute format('create policy dd_service_all on %I for all to %I using (true) with check (true)', t, svc);
    end if;
  end loop;
end $$;
