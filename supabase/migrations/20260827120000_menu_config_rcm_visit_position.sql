-- Place Request & Complaint and Visit Bookings directly after Deliveries in every
-- stored sidebar config. Without an explicit entry the merge appends them to the
-- Unorganised tail, which does not match the approved navigation order.

with expanded as (
  select
    m.id as config_id,
    t.ord,
    t.item
  from public.menu_configs m
  cross join lateral jsonb_array_elements(m.config) with ordinality as t(item, ord)
  where jsonb_typeof(m.config) = 'array'
),
targets as (
  select distinct config_id
  from expanded
  where item->>'id' = 'deliveries'
),
missing as (
  select t.config_id
  from targets t
  where not exists (
    select 1 from expanded e
    where e.config_id = t.config_id
      and e.item->>'id' in ('requests', 'visit-bookings')
  )
),
rebuilt as (
  select
    e.config_id,
    jsonb_agg(e.item order by e.sort_key) as config
  from (
    select config_id, item, ord::numeric as sort_key from expanded
    where config_id in (select config_id from missing)
    union all
    select
      config_id,
      jsonb_build_object(
        'id', 'requests',
        'type', 'item',
        'icon', 'Inbox',
        'label', 'Request & Complaint',
        'hidden', false
      ),
      ord + 0.1
    from expanded
    where config_id in (select config_id from missing)
      and item->>'id' = 'deliveries'
    union all
    select
      config_id,
      jsonb_build_object(
        'id', 'visit-bookings',
        'type', 'item',
        'icon', 'CalendarCheck',
        'label', 'Visit Bookings',
        'hidden', false
      ),
      ord + 0.2
    from expanded
    where config_id in (select config_id from missing)
      and item->>'id' = 'deliveries'
  ) e
  group by e.config_id
)
update public.menu_configs m
set config = r.config,
    updated_at = now()
from rebuilt r
where m.id = r.config_id;

-- Roles that already carry the entries only need the approved labels.
update public.menu_configs m
set config = (
      select jsonb_agg(
        case
          when item->>'id' = 'requests' then jsonb_set(item, '{label}', '"Request & Complaint"')
          when item->>'id' = 'visit-bookings' then jsonb_set(item, '{label}', '"Visit Bookings"')
          else item
        end
        order by ord
      )
      from jsonb_array_elements(m.config) with ordinality as t(item, ord)
    ),
    updated_at = now()
where jsonb_typeof(m.config) = 'array'
  and exists (
    select 1 from jsonb_array_elements(m.config) i
    where i->>'id' in ('requests', 'visit-bookings')
      and i->>'label' is distinct from case
        when i->>'id' = 'requests' then 'Request & Complaint'
        else 'Visit Bookings'
      end
  );
