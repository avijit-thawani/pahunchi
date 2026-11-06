-- "You're a trusted contact for X" -> one tap adds X as my contact, already linked (no invite needed:
-- X chose to trust me, so we know their account). Their email is not copied to me.

drop function public.my_people();
create function public.my_people()
returns table (link_id uuid, owner_name text, joined_at timestamptz, added_back boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, public.display_name(c.owner_id), c.joined_at,
         exists (select 1 from public.trusted_contacts m
                 where m.owner_id = auth.uid() and m.contact_user_id = c.owner_id)
  from public.trusted_contacts c where c.contact_user_id = auth.uid() order by c.joined_at
$$;
revoke execute on function public.my_people() from public, anon;
grant execute on function public.my_people() to authenticated;

create function public.add_back(link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare them uuid;
begin
  select owner_id into them from public.trusted_contacts where id = link_id and contact_user_id = auth.uid();
  if them is null then raise exception 'not found'; end if;
  if exists (select 1 from public.trusted_contacts where owner_id = auth.uid() and contact_user_id = them) then
    return;
  end if;
  insert into public.trusted_contacts (owner_id, name, contact_user_id, joined_at)
  values (auth.uid(), left(public.display_name(them), 80), them, now());
end $$;
revoke execute on function public.add_back(uuid) from public, anon;
grant execute on function public.add_back(uuid) to authenticated;
