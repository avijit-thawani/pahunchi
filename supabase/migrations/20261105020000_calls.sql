-- Calls made while signed in, so trusted contacts can see them. Visibility per contact follows
-- their delay: delay 0 sees the call at once; otherwise only after `delay_min` minutes from when the
-- server first heard of the call (created_at, not the phone's clock), and only if she hadn't tapped
-- "I'm safe" by then. Enforced in shared_calls(); contacts have no direct access to the table.

create table public.calls (
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null check (length(id) <= 64),
  persona_name text not null check (length(persona_name) <= 80),
  language text check (length(language) <= 20),
  started_at timestamptz not null,
  ended_at timestamptz,
  safe_at timestamptz,
  turns jsonb not null default '[]' check (pg_column_size(turns) < 500000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create index on public.calls (owner_id, created_at desc);

alter table public.calls enable row level security;
create policy "owner reads" on public.calls for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "owner inserts" on public.calls for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owner updates" on public.calls for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner deletes" on public.calls for delete to authenticated
  using (owner_id = (select auth.uid()));

revoke all on public.calls from anon, authenticated;
grant select, delete on public.calls to authenticated;
grant insert (id, persona_name, language, started_at, ended_at, safe_at, turns) on public.calls to authenticated;
grant update (persona_name, language, started_at, ended_at, safe_at, turns) on public.calls to authenticated;

create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger calls_touch before update on public.calls for each row execute function public.touch_updated_at();

create function public.shared_calls()
returns table (
  owner_name text, id text, persona_name text, started_at timestamptz, ended_at timestamptz,
  safe_at timestamptz, turns jsonb, delay_min int, visible_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select owner_name, id, persona_name, started_at, ended_at, safe_at, turns, delay_min, visible_at from (
    -- one row per call even if she linked the same person twice; the shortest delay wins
    select distinct on (c.owner_id, c.id)
           public.display_name(c.owner_id) as owner_name, c.id, c.persona_name, c.started_at, c.ended_at,
           c.safe_at, c.turns, tc.delay_min, c.created_at + make_interval(mins => tc.delay_min) as visible_at,
           c.created_at
    from public.calls c
    join public.trusted_contacts tc on tc.owner_id = c.owner_id and tc.contact_user_id = auth.uid()
    where tc.delay_min = 0
       or (now() >= c.created_at + make_interval(mins => tc.delay_min)
           and (c.safe_at is null or c.safe_at > c.created_at + make_interval(mins => tc.delay_min)))
    order by c.owner_id, c.id, tc.delay_min
  ) s
  order by created_at desc
  limit 50
$$;
revoke execute on function public.shared_calls() from public, anon;
grant execute on function public.shared_calls() to authenticated;
