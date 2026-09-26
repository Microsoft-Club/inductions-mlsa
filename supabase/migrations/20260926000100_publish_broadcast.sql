-- Publishing or unpublishing results changes what panelists may do (evaluations lock), so the
-- staff board is told, the same way every other state change is. Grants are unchanged.
create or replace function public.set_results_published(p_published boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
  update public.inductions set results_published = coalesce(p_published, false) where is_active;
  if not found then
    raise exception 'No active induction';
  end if;
  perform public.broadcast_board();
end $$;
