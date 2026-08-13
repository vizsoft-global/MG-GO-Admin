-- 20260827120000 added top-level Request & Complaint / Visit Bookings entries, but the
-- same ids already existed nested inside group children (labelled with the old copy),
-- so the sidebar rendered each entry twice. Drop the nested copies.

update public.menu_configs m
set config = (
      select jsonb_agg(
        case
          when jsonb_typeof(node->'children') = 'array' then
            jsonb_set(
              node,
              '{children}',
              coalesce(
                (
                  select jsonb_agg(child order by child_ord)
                  from jsonb_array_elements(node->'children') with ordinality as c(child, child_ord)
                  where child->>'id' not in ('requests', 'visit-bookings')
                ),
                '[]'::jsonb
              )
            )
          else node
        end
        order by node_ord
      )
      from jsonb_array_elements(m.config) with ordinality as n(node, node_ord)
    ),
    updated_at = now()
where jsonb_typeof(config) = 'array'
  and exists (
    select 1
    from jsonb_array_elements(config) as g(node)
    cross join lateral jsonb_array_elements(coalesce(g.node->'children', '[]'::jsonb)) as c(child)
    where c.child->>'id' in ('requests', 'visit-bookings')
  );
