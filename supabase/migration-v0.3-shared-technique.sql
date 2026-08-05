-- Raccotel V0.3 — registre technique commun Housekeeping / Technique
-- Migration non destructive. Les signalements déjà présents dans raccoon_days
-- sont repris dans le registre commun avant l'activation du temps réel.

alter table public.raccotel_technique_interventions
  add column if not exists hotel_id uuid,
  add column if not exists origin_key text,
  add column if not exists workflow_status text not null default 'reported',
  add column if not exists reported_for_date date not null default ((now() at time zone 'Europe/Paris')::date),
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid,
  add column if not exists updated_from text not null default 'technique';

update public.raccotel_technique_interventions i
set
  hotel_id = coalesce(i.hotel_id, (select h.id from public.raccoon_hotels h order by h.created_at limit 1)),
  workflow_status = case when i.status = 'repaired' then 'repaired' else coalesce(nullif(i.workflow_status, ''), 'reported') end,
  created_by = coalesce(i.created_by, (select h.created_by from public.raccoon_hotels h order by h.created_at limit 1)),
  updated_by = coalesce(i.updated_by, i.created_by, (select h.created_by from public.raccoon_hotels h order by h.created_at limit 1))
where i.hotel_id is null
   or i.created_by is null
   or i.updated_by is null
   or i.workflow_status is null
   or i.workflow_status = '';

do $$
begin
  if exists (select 1 from public.raccotel_technique_interventions where hotel_id is null) then
    raise exception 'Impossible de rattacher les interventions à un hôtel';
  end if;
end;
$$;

alter table public.raccotel_technique_interventions
  alter column hotel_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_interventions_hotel_id_fkey'
      and conrelid = 'public.raccotel_technique_interventions'::regclass
  ) then
    alter table public.raccotel_technique_interventions
      add constraint raccotel_technique_interventions_hotel_id_fkey
      foreign key (hotel_id) references public.raccoon_hotels(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_interventions_created_by_fkey'
      and conrelid = 'public.raccotel_technique_interventions'::regclass
  ) then
    alter table public.raccotel_technique_interventions
      add constraint raccotel_technique_interventions_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_interventions_updated_by_fkey'
      and conrelid = 'public.raccotel_technique_interventions'::regclass
  ) then
    alter table public.raccotel_technique_interventions
      add constraint raccotel_technique_interventions_updated_by_fkey
      foreign key (updated_by) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_interventions_status_check'
      and conrelid = 'public.raccotel_technique_interventions'::regclass
  ) then
    alter table public.raccotel_technique_interventions
      add constraint raccotel_technique_interventions_status_check
      check (status in ('open', 'repaired'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_interventions_workflow_status_check'
      and conrelid = 'public.raccotel_technique_interventions'::regclass
  ) then
    alter table public.raccotel_technique_interventions
      add constraint raccotel_technique_interventions_workflow_status_check
      check (workflow_status in ('detected', 'reported', 'in_progress', 'repaired', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_interventions_updated_from_check'
      and conrelid = 'public.raccotel_technique_interventions'::regclass
  ) then
    alter table public.raccotel_technique_interventions
      add constraint raccotel_technique_interventions_updated_from_check
      check (updated_from in ('housekeeping', 'technique', 'migration'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_interventions_status_consistency_check'
      and conrelid = 'public.raccotel_technique_interventions'::regclass
  ) then
    alter table public.raccotel_technique_interventions
      add constraint raccotel_technique_interventions_status_consistency_check
      check (
        (status = 'open' and workflow_status in ('detected', 'reported', 'in_progress'))
        or (status = 'repaired' and workflow_status in ('repaired', 'cancelled'))
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_interventions_hotel_origin_key_key'
      and conrelid = 'public.raccotel_technique_interventions'::regclass
  ) then
    alter table public.raccotel_technique_interventions
      add constraint raccotel_technique_interventions_hotel_origin_key_key
      unique (hotel_id, origin_key);
  end if;
end;
$$;

create index if not exists raccotel_technique_interventions_hotel_status_created_idx
  on public.raccotel_technique_interventions (hotel_id, status, created_at desc);
create index if not exists raccotel_technique_interventions_hotel_location_idx
  on public.raccotel_technique_interventions (hotel_id, location_type, location);
create index if not exists raccotel_technique_interventions_created_by_idx
  on public.raccotel_technique_interventions (created_by);
create index if not exists raccotel_technique_interventions_updated_by_idx
  on public.raccotel_technique_interventions (updated_by);

alter table public.raccotel_technique_activity
  add column if not exists hotel_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists source_app text not null default 'technique',
  add column if not exists from_status text,
  add column if not exists to_status text;

update public.raccotel_technique_activity a
set hotel_id = coalesce(
  a.hotel_id,
  (select i.hotel_id from public.raccotel_technique_interventions i where i.id = a.intervention_id),
  (select h.id from public.raccoon_hotels h order by h.created_at limit 1)
)
where a.hotel_id is null;

do $$
begin
  if exists (select 1 from public.raccotel_technique_activity where hotel_id is null) then
    raise exception 'Impossible de rattacher l’historique technique à un hôtel';
  end if;
end;
$$;

alter table public.raccotel_technique_activity
  alter column hotel_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_activity_hotel_id_fkey'
      and conrelid = 'public.raccotel_technique_activity'::regclass
  ) then
    alter table public.raccotel_technique_activity
      add constraint raccotel_technique_activity_hotel_id_fkey
      foreign key (hotel_id) references public.raccoon_hotels(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_activity_intervention_id_fkey'
      and conrelid = 'public.raccotel_technique_activity'::regclass
  ) then
    alter table public.raccotel_technique_activity
      add constraint raccotel_technique_activity_intervention_id_fkey
      foreign key (intervention_id) references public.raccotel_technique_interventions(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_activity_actor_user_id_fkey'
      and conrelid = 'public.raccotel_technique_activity'::regclass
  ) then
    alter table public.raccotel_technique_activity
      add constraint raccotel_technique_activity_actor_user_id_fkey
      foreign key (actor_user_id) references auth.users(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'raccotel_technique_activity_source_app_check'
      and conrelid = 'public.raccotel_technique_activity'::regclass
  ) then
    alter table public.raccotel_technique_activity
      add constraint raccotel_technique_activity_source_app_check
      check (source_app in ('housekeeping', 'technique', 'migration'));
  end if;
end;
$$;

create index if not exists raccotel_technique_activity_hotel_created_idx
  on public.raccotel_technique_activity (hotel_id, created_at desc);
create index if not exists raccotel_technique_activity_intervention_idx
  on public.raccotel_technique_activity (intervention_id, created_at desc);
create index if not exists raccotel_technique_activity_actor_user_idx
  on public.raccotel_technique_activity (actor_user_id);

-- Garde la compatibilité pendant le déploiement coordonné : si une ancienne
-- version ne modifie que le statut historique, le statut métier partagé reste
-- cohérent, et inversement.
create or replace function public.raccotel_sync_intervention_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.workflow_status is distinct from old.workflow_status then
    new.status := case
      when new.workflow_status in ('repaired', 'cancelled') then 'repaired'
      else 'open'
    end;
  elsif new.status is distinct from old.status then
    new.workflow_status := case
      when new.status = 'repaired' then 'repaired'
      when old.workflow_status in ('repaired', 'cancelled') then 'reported'
      else old.workflow_status
    end;
  end if;

  if new.workflow_status in ('repaired', 'cancelled') then
    new.repaired_at := coalesce(new.repaired_at, now()::text);
  elsif tg_op = 'INSERT'
     or new.workflow_status is distinct from old.workflow_status
     or new.status is distinct from old.status then
    new.repaired_at := null;
  end if;

  return new;
end;
$$;

revoke all on function public.raccotel_sync_intervention_status() from public, anon, authenticated;

drop trigger if exists raccotel_technique_intervention_status_sync on public.raccotel_technique_interventions;
create trigger raccotel_technique_intervention_status_sync
before insert or update on public.raccotel_technique_interventions
for each row execute function public.raccotel_sync_intervention_status();

create or replace function public.raccotel_log_intervention_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_action text;
  v_detail text;
  v_from_status text;
  v_to_status text;
begin
  select m.display_name
    into v_actor
  from public.raccoon_members m
  where m.hotel_id = new.hotel_id
    and m.user_id = coalesce(new.updated_by, new.created_by)
  limit 1;

  v_actor := coalesce(nullif(v_actor, ''), nullif(new.assignee, ''), nullif(new.reporter, ''), 'Système');

  if tg_op = 'INSERT' then
    v_action := 'signalement';
    v_detail := new.title || case when new.urgency = 'urgent' then ' · Urgent' else ' · Non urgent' end;
    v_to_status := new.workflow_status;
  elsif new.workflow_status is distinct from old.workflow_status then
    v_action := case
      when new.workflow_status = 'repaired' then 'réparation'
      when new.workflow_status = 'cancelled' then 'annulation'
      when old.workflow_status = 'repaired' then 'réouverture'
      else 'statut'
    end;
    v_detail := 'Statut : ' || new.workflow_status
      || case
        when new.assignee is distinct from old.assignee and new.assignee is not null
          then ' · Attribuée à ' || new.assignee
        else ''
      end;
    v_from_status := old.workflow_status;
    v_to_status := new.workflow_status;
  elsif new.assignee is distinct from old.assignee then
    v_action := 'attribution';
    v_detail := case when new.assignee is null then 'Attribution retirée' else 'Tâche attribuée à ' || new.assignee end;
  elsif new.comment is distinct from old.comment
     or new.description is distinct from old.description
     or new.material is distinct from old.material
     or new.minutes is distinct from old.minutes
     or new.scheduled_for is distinct from old.scheduled_for
     or new.photo_key is distinct from old.photo_key then
    v_action := 'mise à jour';
    v_detail := case
      when new.photo_key is distinct from old.photo_key then 'Photo du signalement mise à jour'
      else coalesce(nullif(new.comment, ''), 'Intervention mise à jour')
    end;
  else
    return new;
  end if;

  insert into public.raccotel_technique_activity (
    intervention_id,
    hotel_id,
    action,
    detail,
    location,
    actor,
    actor_user_id,
    source_app,
    from_status,
    to_status,
    created_at
  ) values (
    new.id,
    new.hotel_id,
    v_action,
    v_detail,
    new.location,
    v_actor,
    coalesce(new.updated_by, new.created_by),
    new.updated_from,
    v_from_status,
    v_to_status,
    now()::text
  );

  return new;
end;
$$;

revoke all on function public.raccotel_log_intervention_change() from public, anon, authenticated;

drop trigger if exists raccotel_technique_intervention_history on public.raccotel_technique_interventions;
create trigger raccotel_technique_intervention_history
after insert or update on public.raccotel_technique_interventions
for each row execute function public.raccotel_log_intervention_change();

-- Reprise des problèmes techniques déjà saisis dans les journées Housekeeping.
with source_rows as (
  select
    d.hotel_id,
    d.work_date,
    d.updated_at,
    d.updated_by,
    room->>'number' as location,
    'room'::text as location_type,
    coalesce(nullif(trim(room->>'floorComment'), ''), nullif(trim(room->>'receptionComment'), ''), 'Problème technique') as issue_text,
    room->>'technicalStatus' as legacy_status,
    nullif(room->>'technicalPhotoName', '') as photo_name
  from public.raccoon_days d
  cross join lateral jsonb_array_elements(coalesce(d.payload->'rooms', '[]'::jsonb)) room
  where room->>'technicalStatus' is not null
     or room->>'alert' = 'Problème technique'

  union all

  select
    d.hotel_id,
    d.work_date,
    d.updated_at,
    d.updated_by,
    area->>'name' as location,
    'common_area'::text as location_type,
    coalesce(nullif(trim(area->>'comment'), ''), 'Problème technique') as issue_text,
    'Détecté'::text as legacy_status,
    nullif(area->>'technicalPhotoName', '') as photo_name
  from public.raccoon_days d
  cross join lateral jsonb_array_elements(coalesce(d.payload->'commonAreas', '[]'::jsonb)) area
  where area->>'action' = 'Problème technique'
)
insert into public.raccotel_technique_interventions (
  hotel_id,
  origin_key,
  location,
  location_type,
  category,
  title,
  description,
  urgency,
  status,
  workflow_status,
  reporter,
  source,
  photo_name,
  reported_for_date,
  created_by,
  updated_by,
  updated_from,
  created_at,
  updated_at,
  repaired_at
)
select
  s.hotel_id,
  'housekeeping:' || s.work_date::text || ':' || s.location_type || ':' || s.location,
  s.location,
  s.location_type,
  'Autre',
  s.issue_text,
  s.issue_text,
  'non_urgent',
  case when s.legacy_status = 'Réparé' then 'repaired' else 'open' end,
  case
    when s.legacy_status = 'Réparé' then 'repaired'
    when s.legacy_status = 'En cours' then 'in_progress'
    when s.legacy_status = 'Signalé' then 'reported'
    else 'detected'
  end,
  'Housekeeping',
  'housekeeping',
  s.photo_name,
  s.work_date,
  s.updated_by,
  s.updated_by,
  'migration',
  (s.work_date::timestamp + time '09:00')::text,
  s.updated_at::text,
  case when s.legacy_status = 'Réparé' then s.updated_at::text else null end
from source_rows s
where nullif(trim(s.location), '') is not null
on conflict (hotel_id, origin_key) do update set
  description = excluded.description,
  title = excluded.title,
  status = excluded.status,
  workflow_status = excluded.workflow_status,
  photo_name = coalesce(excluded.photo_name, public.raccotel_technique_interventions.photo_name),
  updated_by = coalesce(excluded.updated_by, public.raccotel_technique_interventions.updated_by),
  updated_from = 'migration',
  updated_at = excluded.updated_at,
  repaired_at = excluded.repaired_at;

alter table public.raccotel_technique_interventions enable row level security;
alter table public.raccotel_technique_activity enable row level security;

drop policy if exists "raccotel interventions readable by hotel members" on public.raccotel_technique_interventions;
create policy "raccotel interventions readable by hotel members"
on public.raccotel_technique_interventions for select to authenticated
using (hotel_id = (select public.raccoon_current_hotel_id()));

drop policy if exists "raccotel interventions insertable by hotel members" on public.raccotel_technique_interventions;
create policy "raccotel interventions insertable by hotel members"
on public.raccotel_technique_interventions for insert to authenticated
with check (
  hotel_id = (select public.raccoon_current_hotel_id())
  and created_by = (select auth.uid())
  and updated_by = (select auth.uid())
);

drop policy if exists "raccotel interventions updatable by hotel members" on public.raccotel_technique_interventions;
create policy "raccotel interventions updatable by hotel members"
on public.raccotel_technique_interventions for update to authenticated
using (hotel_id = (select public.raccoon_current_hotel_id()))
with check (
  hotel_id = (select public.raccoon_current_hotel_id())
  and updated_by = (select auth.uid())
);

drop policy if exists "raccotel activity readable by hotel members" on public.raccotel_technique_activity;
create policy "raccotel activity readable by hotel members"
on public.raccotel_technique_activity for select to authenticated
using (hotel_id = (select public.raccoon_current_hotel_id()));

drop policy if exists "raccotel activity insertable by hotel members" on public.raccotel_technique_activity;

revoke all on public.raccotel_technique_interventions from public, anon, authenticated;
revoke all on public.raccotel_technique_activity from public, anon, authenticated;
grant select, insert on public.raccotel_technique_interventions to authenticated;
grant update (
  title,
  description,
  urgency,
  status,
  workflow_status,
  assignee,
  material,
  minutes,
  comment,
  photo_key,
  photo_name,
  photo_type,
  scheduled_for,
  updated_by,
  updated_from,
  updated_at,
  repaired_at
) on public.raccotel_technique_interventions to authenticated;
grant select on public.raccotel_technique_activity to authenticated;
revoke all on sequence public.raccotel_technique_interventions_id_seq from public, anon, authenticated;
revoke all on sequence public.raccotel_technique_activity_id_seq from public, anon, authenticated;
grant usage, select on sequence public.raccotel_technique_interventions_id_seq to authenticated;

-- Le bucket reste privé. Housekeeping peut y déposer et lire uniquement les
-- fichiers rangés sous le dossier de son propre hôtel.
drop policy if exists "raccotel hotel members can read technical files" on storage.objects;
create policy "raccotel hotel members can read technical files"
on storage.objects for select to authenticated
using (
  bucket_id = 'raccotel-technique'
  and (storage.foldername(name))[1] = (select public.raccoon_current_hotel_id())::text
);

drop policy if exists "raccotel hotel members can upload technical files" on storage.objects;
create policy "raccotel hotel members can upload technical files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'raccotel-technique'
  and (storage.foldername(name))[1] = (select public.raccoon_current_hotel_id())::text
  and (storage.foldername(name))[2] = 'interventions'
  and owner_id = (select auth.uid()::text)
);

revoke all on function public.raccoon_current_hotel_id() from public, anon;
grant execute on function public.raccoon_current_hotel_id() to authenticated, service_role;
revoke all on function public.raccoon_is_admin(uuid) from public, anon;
grant execute on function public.raccoon_is_admin(uuid) to authenticated, service_role;
revoke all on function public.raccoon_admin_upsert_member(text, text, text, boolean) from public, anon;
grant execute on function public.raccoon_admin_upsert_member(text, text, text, boolean) to authenticated, service_role;
revoke all on function public.raccoon_bootstrap_or_context(text, text) from public, anon;
grant execute on function public.raccoon_bootstrap_or_context(text, text) to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'raccotel_technique_interventions'
  ) then
    alter publication supabase_realtime add table public.raccotel_technique_interventions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'raccotel_technique_activity'
  ) then
    alter publication supabase_realtime add table public.raccotel_technique_activity;
  end if;
end;
$$;
