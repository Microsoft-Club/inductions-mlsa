-- Admins can take someone out of a panel from the admin page: panelists often forget to leave when
-- they walk away, and the board then shows them as still sitting there. Removing someone who isn't
-- in a panel does nothing. Their own screen goes back to "Which panel are you sitting in?".
create function public.remove_from_panel(p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
  update public.profiles set current_panel_id = null where id = p_user_id and current_panel_id is not null;
  perform public.broadcast_board();
end $$;

revoke execute on function public.remove_from_panel(uuid) from public, anon;
grant execute on function public.remove_from_panel(uuid) to authenticated;
