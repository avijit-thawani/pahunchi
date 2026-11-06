-- Where she was during a call, if she turned on location sharing. A trusted contact sees a call's
-- points only when they can see the call itself (same per-contact delay and "I'm safe" rule as
-- shared_calls()), so a delayed contact gets the whole trail at once, and then live updates.

create table public.call_locations (
  owner_id uuid not null default auth.uid(),
  call_id text not null,
  at timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m >= 0),
  created_at timestamptz not null default now(),
  primary key (owner_id, call_id, at),
  foreign key (owner_id, call_id) references public.calls (owner_id, id) on delete cascade
);
create index on public.call_locations (call_id);

alter table public.call_locations enable row level security;
create policy "owner reads" on public.call_locations for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "owner inserts" on public.call_locations for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owner deletes" on public.call_locations for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.call_locations from anon, authenticated;
grant select, delete on public.call_locations to authenticated;
grant insert (call_id, at, lat, lng, accuracy_m) on public.call_locations to authenticated;

-- The visibility test must stay identical to the one in shared_calls().
create function public.shared_call_path(p_call_id text)
returns table (at timestamptz, lat double precision, lng double precision, accuracy_m real)
language sql stable security definer set search_path = '' as $$
  select l.at, l.lat, l.lng, l.accuracy_m
  from public.call_locations l
  where l.call_id = p_call_id
    and exists (
      select 1 from public.calls c
      join public.trusted_contacts tc on tc.owner_id = c.owner_id and tc.contact_user_id = auth.uid()
      where c.owner_id = l.owner_id and c.id = l.call_id
        and (tc.delay_min = 0
             or (now() >= c.created_at + make_interval(mins => tc.delay_min)
                 and (c.safe_at is null or c.safe_at > c.created_at + make_interval(mins => tc.delay_min))))
    )
  order by l.at
  limit 5000
$$;
revoke execute on function public.shared_call_path(text) from public, anon;
grant execute on function public.shared_call_path(text) to authenticated;
