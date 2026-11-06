-- "Delete all my data": removes her auth user. Her calls and her trusted contacts cascade away.
-- On other people's lists she becomes an un-joined entry again: they keep the name/email they
-- typed (their data), but lose the link to her account.

create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  update public.trusted_contacts set contact_user_id = null, joined_at = null where contact_user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
