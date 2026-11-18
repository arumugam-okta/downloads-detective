-- Escalation can now go up several levels, so each item records which levels were told (1 = direct manager, 2 = their
-- manager, ...). Backfilled from the two timestamps it replaces; those columns stay in place, unused. Idempotent.
alter table dd_cleanup_items add column if not exists escalations_sent int[] not null default '{}';
-- When the last escalation went out, so a late run walks up one level at a time rather than telling everyone at once.
alter table dd_cleanup_items add column if not exists escalated_at timestamptz;

update dd_cleanup_items
set escalations_sent = array_remove(array[
  case when breach_notified_at   is not null then 1 end,
  case when director_notified_at is not null then 2 end
], null)
where escalations_sent = '{}' and (breach_notified_at is not null or director_notified_at is not null);

update dd_cleanup_items
set escalated_at = greatest(breach_notified_at, director_notified_at)
where escalated_at is null and (breach_notified_at is not null or director_notified_at is not null);
