-- A new panel takes the lowest free number: delete Panel 3, add one, and it is Panel 3 again (it was
-- Panel 4, because deleted panels still counted). A deleted panel keeps its number only while the
-- results show it, i.e. it has an interview that wasn't cancelled, so two rooms never share a name there.
-- sort_order follows the number, so the new Panel 3 sits between Panel 2 and Panel 4 on the board.

create or replace function public.add_panel() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_ind uuid;
  v_n int;
  v_id uuid;
begin
  v_uid := public.require_role('admin', 'queue_manager');
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
