-- Private bucket for call logs (server/log.ts), in the same project as accounts so "Delete all my
-- data" reaches both. No policies: only the service role (the Netlify function) can touch it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('phoney-logs', 'phoney-logs', false, 10000000)
on conflict (id) do nothing;
