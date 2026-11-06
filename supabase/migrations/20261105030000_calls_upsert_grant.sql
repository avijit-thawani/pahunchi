-- PostgREST upserts write `SET id = excluded.id` on conflict, which needs UPDATE on id too.
-- RLS still limits updates to her own rows.
grant update (id) on public.calls to authenticated;
