-- Explicit manager role. People who lead someone are managers anyway; this lets a manager be designated
-- before anyone reports to them. Idempotent, and a new file because the earlier migrations are already applied.
alter table dd_people add column if not exists is_manager boolean not null default false;
