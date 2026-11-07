-- Show account emails next to names once two people are linked: she sees the Google email of each
-- contact who joined, and a contact sees the email of whoever added them.

drop function public.my_people();
create function public.my_people()
returns table (link_id uuid, owner_name text, owner_email text, joined_at timestamptz, added_back boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, public.display_name(c.owner_id), (select u.email from auth.users u where u.id = c.owner_id)::text,
         c.joined_at,
         exists (select 1 from public.trusted_contacts m
                 where m.owner_id = auth.uid() and m.contact_user_id = c.owner_id)
  from public.trusted_contacts c where c.contact_user_id = auth.uid() order by c.joined_at
$$;
revoke execute on function public.my_people() from public, anon;
grant execute on function public.my_people() to authenticated;

create function public.linked_contact_emails() returns table (id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select c.id, u.email::text
  from public.trusted_contacts c join auth.users u on u.id = c.contact_user_id
  where c.owner_id = auth.uid()
$$;
revoke execute on function public.linked_contact_emails() from public, anon;
grant execute on function public.linked_contact_emails() to authenticated;
