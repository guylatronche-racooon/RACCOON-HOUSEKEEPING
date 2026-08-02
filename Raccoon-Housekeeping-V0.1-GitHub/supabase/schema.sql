-- Raccoon Housekeeping V0.1
-- À exécuter une seule fois dans l’éditeur SQL Supabase.

create extension if not exists pgcrypto;

create table if not exists public.raccoon_hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.raccoon_members (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.raccoon_hotels(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  display_name text not null,
  role text not null check (role in (
    'Administrateur',
    'Adjoint(e) de direction',
    'Gouvernante',
    'Chef de réception',
    'Réception',
    'Responsable technique'
  )),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (hotel_id, email)
);

create unique index if not exists raccoon_members_user_id_idx
  on public.raccoon_members(user_id)
  where user_id is not null;
create index if not exists raccoon_members_hotel_id_idx
  on public.raccoon_members(hotel_id);

create table if not exists public.raccoon_days (
  hotel_id uuid not null references public.raccoon_hotels(id) on delete cascade,
  work_date date not null,
  payload jsonb not null,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  device_id text,
  primary key (hotel_id, work_date)
);

create index if not exists raccoon_days_updated_at_idx
  on public.raccoon_days(hotel_id, updated_at desc);

create or replace function public.raccoon_current_hotel_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select hotel_id
  from public.raccoon_members
  where user_id = (select auth.uid())
    and active = true
  limit 1;
$$;

create or replace function public.raccoon_is_admin(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.raccoon_members
    where hotel_id = p_hotel_id
      and user_id = (select auth.uid())
      and active = true
      and role = 'Administrateur'
  );
$$;

create or replace function public.raccoon_bootstrap_or_context(
  p_hotel_name text,
  p_display_name text
)
returns table (hotel_id uuid, role text, display_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_hotel_id uuid;
  v_role text;
  v_display_name text;
begin
  if v_user_id is null or v_email = '' then
    raise exception 'Authentification requise';
  end if;

  select m.hotel_id, m.role, m.display_name
    into v_hotel_id, v_role, v_display_name
  from public.raccoon_members m
  where m.user_id = v_user_id and m.active = true
  limit 1;

  if v_hotel_id is not null then
    return query select v_hotel_id, v_role, v_display_name;
    return;
  end if;

  update public.raccoon_members m
  set user_id = v_user_id, updated_at = now()
  where lower(m.email) = v_email
    and m.user_id is null
    and m.active = true
  returning m.hotel_id, m.role, m.display_name
    into v_hotel_id, v_role, v_display_name;

  if v_hotel_id is not null then
    return query select v_hotel_id, v_role, v_display_name;
    return;
  end if;

  if not exists (select 1 from public.raccoon_hotels) then
    insert into public.raccoon_hotels (name, created_by)
    values (coalesce(nullif(trim(p_hotel_name), ''), 'Mon hôtel'), v_user_id)
    returning id into v_hotel_id;

    insert into public.raccoon_members (
      hotel_id, user_id, email, display_name, role, active
    ) values (
      v_hotel_id,
      v_user_id,
      v_email,
      coalesce(nullif(trim(p_display_name), ''), split_part(v_email, '@', 1)),
      'Administrateur',
      true
    )
    returning raccoon_members.role, raccoon_members.display_name
      into v_role, v_display_name;

    return query select v_hotel_id, v_role, v_display_name;
  end if;
end;
$$;

create or replace function public.raccoon_admin_upsert_member(
  p_email text,
  p_display_name text,
  p_role text,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_hotel_id uuid := public.raccoon_current_hotel_id();
  v_member_id uuid;
  v_existing_user_id uuid;
  v_email text := lower(trim(p_email));
begin
  if v_hotel_id is null or not public.raccoon_is_admin(v_hotel_id) then
    raise exception 'Droits administrateur requis';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'Adresse e-mail invalide';
  end if;
  if p_role not in (
    'Administrateur', 'Adjoint(e) de direction', 'Gouvernante',
    'Chef de réception', 'Réception', 'Responsable technique'
  ) then
    raise exception 'Rôle invalide';
  end if;

  select u.id into v_existing_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  insert into public.raccoon_members (
    hotel_id, user_id, email, display_name, role, active
  ) values (
    v_hotel_id,
    v_existing_user_id,
    v_email,
    coalesce(nullif(trim(p_display_name), ''), split_part(v_email, '@', 1)),
    p_role,
    p_active
  )
  on conflict (hotel_id, email) do update set
    user_id = coalesce(excluded.user_id, raccoon_members.user_id),
    display_name = excluded.display_name,
    role = excluded.role,
    active = excluded.active,
    updated_at = now()
  returning id into v_member_id;

  return v_member_id;
end;
$$;

alter table public.raccoon_hotels enable row level security;
alter table public.raccoon_members enable row level security;
alter table public.raccoon_days enable row level security;

drop policy if exists "raccoon hotels readable by members" on public.raccoon_hotels;
create policy "raccoon hotels readable by members"
on public.raccoon_hotels for select to authenticated
using (id = (select public.raccoon_current_hotel_id()));

drop policy if exists "raccoon members readable by hotel members" on public.raccoon_members;
create policy "raccoon members readable by hotel members"
on public.raccoon_members for select to authenticated
using (hotel_id = (select public.raccoon_current_hotel_id()));

drop policy if exists "raccoon days readable by hotel members" on public.raccoon_days;
create policy "raccoon days readable by hotel members"
on public.raccoon_days for select to authenticated
using (hotel_id = (select public.raccoon_current_hotel_id()));

drop policy if exists "raccoon days insertable by hotel members" on public.raccoon_days;
create policy "raccoon days insertable by hotel members"
on public.raccoon_days for insert to authenticated
with check (
  hotel_id = (select public.raccoon_current_hotel_id())
  and updated_by = (select auth.uid())
);

drop policy if exists "raccoon days updatable by hotel members" on public.raccoon_days;
create policy "raccoon days updatable by hotel members"
on public.raccoon_days for update to authenticated
using (hotel_id = (select public.raccoon_current_hotel_id()))
with check (
  hotel_id = (select public.raccoon_current_hotel_id())
  and updated_by = (select auth.uid())
);

grant select on public.raccoon_hotels to authenticated;
grant select on public.raccoon_members to authenticated;
grant select, insert, update on public.raccoon_days to authenticated;
revoke all on function public.raccoon_bootstrap_or_context(text, text) from public;
revoke all on function public.raccoon_admin_upsert_member(text, text, text, boolean) from public;
grant execute on function public.raccoon_bootstrap_or_context(text, text) to authenticated;
grant execute on function public.raccoon_admin_upsert_member(text, text, text, boolean) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'raccoon_days'
  ) then
    alter publication supabase_realtime add table public.raccoon_days;
  end if;
end;
$$;
