-- Trusted contacts: she adds people; each gets a secret invite link. A contact is linked to her
-- account when they accept the link, or automatically when they sign up with the email she typed.

create table public.trusted_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (length(name) between 1 and 80),
  phone text check (length(phone) <= 40),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  delay_min int not null default 30 check (delay_min in (0, 30, 60, 180)),
  invite_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  contact_user_id uuid references auth.users on delete set null,
  joined_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.trusted_contacts (owner_id);
create index on public.trusted_contacts (contact_user_id);
create index on public.trusted_contacts (lower(email));

alter table public.trusted_contacts enable row level security;

-- Only she can see and manage her list; linking happens through the functions below, so clients
-- can never set contact_user_id / joined_at / invite_token themselves.
create policy "owner reads" on public.trusted_contacts for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "owner inserts" on public.trusted_contacts for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owner updates" on public.trusted_contacts for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner deletes" on public.trusted_contacts for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.trusted_contacts from anon, authenticated;
grant select, delete on public.trusted_contacts to authenticated;
grant insert (name, phone, email, delay_min) on public.trusted_contacts to authenticated;
grant update (name, phone, email, delay_min) on public.trusted_contacts to authenticated;

create function public.display_name(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1))
  from auth.users u where u.id = uid
$$;
revoke execute on function public.display_name(uuid) from public, anon, authenticated;

-- What the join page shows before (and after) signing in. The token itself is the secret.
create function public.invite_info(token text)
returns table (owner_name text, joined boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select public.display_name(c.owner_id), c.contact_user_id is not null,
         c.contact_user_id is not distinct from auth.uid() and auth.uid() is not null
  from public.trusted_contacts c where c.invite_token = token
$$;
grant execute on function public.invite_info(text) to anon, authenticated;

create function public.accept_invite(token text) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.trusted_contacts;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into c from public.trusted_contacts where invite_token = token for update;
  if not found then raise exception 'invite not found'; end if;
  if c.owner_id = auth.uid() then raise exception 'this is your own invite link'; end if;
  if c.contact_user_id is not null and c.contact_user_id <> auth.uid() then
    raise exception 'someone else already accepted this invite';
  end if;
  update public.trusted_contacts set contact_user_id = auth.uid(), joined_at = coalesce(joined_at, now())
  where id = c.id;
  return public.display_name(c.owner_id);
end $$;
revoke execute on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- People who added me, for the contact's side of the Contacts page.
create function public.my_people() returns table (owner_name text, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select public.display_name(c.owner_id), c.joined_at
  from public.trusted_contacts c where c.contact_user_id = auth.uid() order by c.joined_at
$$;
revoke execute on function public.my_people() from public, anon;
grant execute on function public.my_people() to authenticated;

-- Auto-link by email, only once the address is verified (Google sign-ins are verified at creation;
-- an unconfirmed email/password signup must not be able to claim someone's contact slot).
create function public.link_contacts_by_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.trusted_contacts
  set contact_user_id = new.id, joined_at = now()
  where contact_user_id is null and owner_id <> new.id and lower(email) = lower(new.email);
  return new;
end $$;
revoke execute on function public.link_contacts_by_email() from public, anon, authenticated;

create trigger link_contacts_on_signup
after insert or update of email_confirmed_at on auth.users
for each row when (new.email_confirmed_at is not null and new.email is not null)
execute function public.link_contacts_by_email();
