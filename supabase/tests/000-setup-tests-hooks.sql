-- pgTAP helpers shared by every test file. This file runs first (000-) and is NOT wrapped
-- in a transaction, so the helpers stay installed for the files that follow.
create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

-- Wipes all app data inside the calling test's transaction and creates a fresh active induction.
create or replace function tests.reset_app() returns uuid
language plpgsql as $$
begin
  truncate public.inductions, public.profiles cascade;
  return public.create_induction('Test Induction');
end $$;

-- An account = auth user + profile row (mirrors createAccount() in _shared/accounts.ts).
create or replace function tests.create_user(p_username text, p_role text) returns uuid
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_username || '@tests.local', now(), now());
  insert into public.profiles (id, username, display_name, role)
  values (v_id, p_username, initcap(replace(p_username, '_', ' ')), p_role::public.app_role);
  return v_id;
end $$;

create or replace function tests.user_id(p_username text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where username = p_username
$$;

-- Switches the rest of the transaction to that user (role authenticated + JWT sub).
create or replace function tests.login_as(p_username text) returns void
language plpgsql as $$
declare
  v_id uuid := tests.user_id(p_username);
begin
  if v_id is null then
    raise exception 'tests.login_as: unknown user %', p_username;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end $$;

create or replace function tests.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function tests.as_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function tests.add_candidate(p_number int, p_name text default null, p_reg text default null)
returns uuid language sql security definer set search_path = '' as $$
  insert into public.candidates (induction_id, number, reg_number, full_name, email, phone, submitted_at)
  values (public.active_induction_id(), p_number,
          coalesce(p_reg, 'T' || lpad(p_number::text, 6, '0')),
          coalesce(p_name, 'Candidate ' || p_number),
          'c' || p_number || '@example.test',
          '0300' || lpad(p_number::text, 7, '0'),
          timestamptz '2026-09-01 10:00:00+05' + make_interval(mins => p_number))
  returning id
$$;

create or replace function tests.candidate_id(p_number int) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.candidates where induction_id = public.active_induction_id() and number = p_number
$$;

create or replace function tests.panel_id(p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.panels
   where induction_id = public.active_induction_id() and name = p_name and deleted_at is null
$$;

-- Seats someone in a panel without logging in as them. Send in lines people up for a panel nobody
-- is sitting in, so tests that send people in seat someone there first.
create or replace function tests.seat(p_username text, p_panel text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set current_panel_id = tests.panel_id(p_panel) where username = p_username
$$;

create or replace function tests.status(p_number int) returns text
language sql stable security definer set search_path = '' as $$
  select status::text from public.candidates where induction_id = public.active_induction_id() and number = p_number
$$;

create or replace function tests.interview_id(p_number int) returns uuid
language sql stable security definer set search_path = '' as $$
  select i.id
    from public.interviews i
    join public.candidates c on c.id = i.candidate_id
   where c.induction_id = public.active_induction_id() and c.number = p_number
   order by i.started_at desc
   limit 1
$$;

-- Candidate numbers in queue order for one lane (null = the waiting pool).
create or replace function tests.lane(p_panel_name text default null) returns int[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c.number order by q.position), '{}')
    from public.queue_entries q
    join public.candidates c on c.id = q.candidate_id
    left join public.panels p on p.id = q.panel_id
   where q.induction_id = public.active_induction_id()
     and case when p_panel_name is null then q.panel_id is null
              else p.name = p_panel_name and p.deleted_at is null end
$$;

create or replace function tests.lanes_are_contiguous() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1
      from (select position,
                   row_number() over (partition by panel_id order by position) as rn
              from public.queue_entries
             where induction_id = public.active_induction_id()) x
     where x.position <> x.rn)
$$;

create or replace function tests.display_key() returns text
language sql stable security definer set search_path = '' as $$
  select display_key from public.inductions where is_active
$$;

-- One CSV row in the shape the frontend sends to import_candidates.
create or replace function tests.import_row(p_reg text, p_name text, p_submitted_at text, p_email text default '')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'reg_number', p_reg, 'full_name', p_name, 'submitted_at', p_submitted_at,
    'email', p_email, 'account_email', '', 'phone', '03001234567',
    'department', 'Computer Science', 'batch', 'B36',
    'preferences', jsonb_build_array('Dev Team', 'L&Ds', 'Logikal', 'Marketing'),
    'answers', jsonb_build_object('general',
      jsonb_build_array(jsonb_build_object('q', 'Why MLSA?', 'a', 'Because ' || p_name))))
$$;

-- One candidate's row from a results_table() stashed with set_config('tests.results', ...).
create or replace function tests.result_for(p_number int) returns jsonb
language sql stable as $$
  select r from jsonb_array_elements(current_setting('tests.results')::jsonb) as r
   where (r ->> 'number')::int = p_number
$$;

grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select ok(true, 'test helpers installed');
select * from finish();
