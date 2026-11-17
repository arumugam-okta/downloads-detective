-- Profile data synced from Slack (department, cost center, ...) and when it last ran. Idempotent.
alter table dd_people add column if not exists department      text;
alter table dd_people add column if not exists division        text;
alter table dd_people add column if not exists organization    text;
alter table dd_people add column if not exists cost_center     text;
alter table dd_people add column if not exists employee_number text;
alter table dd_people add column if not exists employee_type   text;
alter table dd_people add column if not exists location        text;
alter table dd_people add column if not exists timezone        text;
-- "slack" when the manager link came from a sync, "manual" when someone set it by hand or via CSV.
alter table dd_people add column if not exists manager_source  text check (manager_source in ('slack','manual'));
alter table dd_people add column if not exists slack_synced_at timestamptz;
