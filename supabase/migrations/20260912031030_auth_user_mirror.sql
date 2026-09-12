-- auth_user_mirror: keep public.users (global identity, no tenant columns) in sync with auth.users.
-- Sign-up (API admin lane) and the seed create auth users; this trigger mirrors them so memberships
-- can reference public.users and the bootstrap can read the display name through RLS.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, email, name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'name', ''))
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
