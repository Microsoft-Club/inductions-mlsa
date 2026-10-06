-- Only admins add or delete panels. The queue manager could add panels and delete the extra ones;
-- now the board's panels change only when an admin changes them.

create or replace function public.add_panel() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_ind uuid;
  v_n int;
  v_id uuid;
begin
  v_uid := public.require_role('admin');
  v_ind := public.require_active_induction();
  perform public.lock_queue(v_ind);
  -- Each panel holds at most one number, so 1..(panels + 1) always has a free one.
  select min(n) into v_n
    from generate_series(1, (select count(*)::int + 1 from public.panels where induction_id = v_ind)) as n
   where not exists (
     select 1 from public.panels p
      where p.induction_id = v_ind and p.name = 'Panel ' || n
        and (p.deleted_at is null
             or exists (select 1 from public.interviews i where i.panel_id = p.id and i.status <> 'cancelled')));
  insert into public.panels (induction_id, name, is_default, sort_order, created_by)
  values (v_ind, 'Panel ' || v_n, false, v_n, v_uid)
  returning id into v_id;
  perform public.broadcast_board();
  return v_id;
end $$;

create or replace function public.delete_panel(p_panel_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ind uuid;
  v_p public.panels;
  v_base int;
begin
  perform public.require_role('admin');
  v_ind := public.require_active_induction();
  perform public.lock_queue(v_ind);
  select * into v_p from public.panels
   where id = p_panel_id and induction_id = v_ind and deleted_at is null for update;
  if not found then
    raise exception 'Panel not found';
  end if;
  if exists (select 1 from public.interviews where panel_id = v_p.id and status = 'in_progress') then
    raise exception '% has an interview in progress', v_p.name;
  end if;

  -- Its lane (positions 1..k) goes to the end of the pool in the same order.
  v_base := public.lane_next_position(v_ind, null) - 1;
  update public.queue_entries
     set panel_id = null, position = v_base + position
   where induction_id = v_ind and panel_id = v_p.id;

  update public.panels set deleted_at = clock_timestamp() where id = v_p.id;
  update public.profiles set current_panel_id = null where current_panel_id = v_p.id;
  perform public.broadcast_board();
end $$;
