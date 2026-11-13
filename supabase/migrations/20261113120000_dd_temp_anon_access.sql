-- Follow-up to 20261113000000_dd_init.sql (that file is already applied on OAP, so it must not be edited:
-- the platform tracks a checksum per migration file and skips one that changed).
--
-- TEMPORARY, for the first deployment test: let the anon and authenticated roles read and write dd_* tables,
-- so the app works with only the platform-injected IDDB_API_URL and IDDB_ANON_KEY.
--
-- WARNING: this means anyone who holds this tenant's anon key can read and change these tables directly through
-- the REST API, bypassing the app's own permission checks. This app never sends the key to a browser, but other
-- apps in the same tenant share the anon role. Remove this block (and revoke the grants) before real data goes in;
-- the replacement is the app's own resource role with explicit grants, or user-scoped policies.
--
-- Even here, dd_audit_events stays append-only: the trigger above rejects UPDATE and DELETE for every role.
do $$
declare
  t text;
  r text;
  s text := current_schema();
  tables text[] := array['dd_people','dd_report_imports','dd_cleanup_items','dd_item_files','dd_import_issues','dd_audit_events','dd_policy_settings'];
begin
  foreach r in array array[s || '_anon', s || '_authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant usage on schema %I to %I', s, r);
      execute format('grant usage, select on all sequences in schema %I to %I', s, r);
      foreach t in array tables loop
        execute format('grant select, insert, update, delete on %I to %I', t, r);
        -- one policy per role (the name is suffixed), so a second role never replaces the first
        execute format('drop policy if exists %I on %I', 'dd_temp_open_' || r, t);
        execute format('create policy %I on %I for all to %I using (true) with check (true)', 'dd_temp_open_' || r, t, r);
      end loop;
    end if;
  end loop;
end $$;
