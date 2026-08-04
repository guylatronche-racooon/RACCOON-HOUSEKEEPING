-- Raccoon Housekeeping V0.2
-- Migration non destructive à exécuter UNE SEULE FOIS dans Supabase SQL Editor.
-- Elle ne supprime aucune journée et ne modifie pas raccoon_days.

create table if not exists public.raccoon_settings (
  hotel_id uuid primary key references public.raccoon_hotels(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.raccoon_settings enable row level security;

drop policy if exists "raccoon settings readable by hotel members" on public.raccoon_settings;
create policy "raccoon settings readable by hotel members"
on public.raccoon_settings for select to authenticated
using (hotel_id = (select public.raccoon_current_hotel_id()));

drop policy if exists "raccoon settings insertable by hotel members" on public.raccoon_settings;
create policy "raccoon settings insertable by hotel members"
on public.raccoon_settings for insert to authenticated
with check (
  hotel_id = (select public.raccoon_current_hotel_id())
  and updated_by = (select auth.uid())
);

drop policy if exists "raccoon settings updatable by hotel members" on public.raccoon_settings;
create policy "raccoon settings updatable by hotel members"
on public.raccoon_settings for update to authenticated
using (hotel_id = (select public.raccoon_current_hotel_id()))
with check (
  hotel_id = (select public.raccoon_current_hotel_id())
  and updated_by = (select auth.uid())
);

grant select, insert, update on public.raccoon_settings to authenticated;

-- Initialise les réglages permanents à partir de la journée la plus récente.
-- Les salariés ajoutés, les modifications de fiches et les chambres HS sont donc repris.
insert into public.raccoon_settings (hotel_id, payload, updated_at, updated_by)
select
  h.id,
  jsonb_build_object(
    'schemaVersion', 2,
    'employees', coalesce(latest.payload -> 'employees', '[]'::jsonb),
    'rooms', coalesce(latest.payload -> 'rooms', '[]'::jsonb),
    'outOfServiceRooms', coalesce((
      select jsonb_agg(room ->> 'number')
      from jsonb_array_elements(coalesce(latest.payload -> 'rooms', '[]'::jsonb)) room
      where coalesce((room ->> 'outOfService')::boolean, false) = true
    ), '[]'::jsonb),
    'accounts', coalesce(latest.payload -> 'accounts', '[]'::jsonb),
    'blankMinutes', coalesce(latest.payload -> 'blankMinutes', '20'::jsonb),
    'stayoverMinutes', coalesce(latest.payload -> 'stayoverMinutes', '15'::jsonb),
    'defaultPauseMinutes', coalesce(latest.payload -> 'defaultPauseMinutes', '30'::jsonb),
    'alertSettings', coalesce(latest.payload -> 'alertSettings', '{"equity":true,"floors":true,"overrun":true}'::jsonb),
    'hotelName', coalesce(latest.payload -> 'hotelName', to_jsonb(h.name)),
    'groupName', coalesce(latest.payload -> 'groupName', '"Sowell Hôtels"'::jsonb),
    'hotelAddress', coalesce(latest.payload -> 'hotelAddress', '""'::jsonb),
    'hotelLogo', coalesce(latest.payload -> 'hotelLogo', '"/hotel-les-chevaliers.png"'::jsonb),
    'groupLogo', coalesce(latest.payload -> 'groupLogo', '"/sowell-hotels.png"'::jsonb),
    'predefinedInstructions', coalesce(latest.payload -> 'predefinedInstructions', '[]'::jsonb),
    'savedAt', to_jsonb(now()::text)
  ),
  now(),
  h.created_by
from public.raccoon_hotels h
left join lateral (
  select d.payload
  from public.raccoon_days d
  where d.hotel_id = h.id
  order by d.work_date desc, d.updated_at desc
  limit 1
) latest on true
where latest.payload is not null
on conflict (hotel_id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'raccoon_settings'
  ) then
    alter publication supabase_realtime add table public.raccoon_settings;
  end if;
end;
$$;
