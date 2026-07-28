-- Backfill restaurant_id on legacy deliveries where the merchant can be inferred
-- unambiguously (same rules as driver_create_pickup snapshot).

UPDATE public.deliveries AS d
SET restaurant_id = inferred.restaurant_id
FROM (
  SELECT
    d2.id AS delivery_id,
    (MIN(dr.restaurant_id::text))::uuid AS restaurant_id
  FROM public.deliveries d2
  INNER JOIN public.drivers drv ON drv.id = d2.driver_id
  INNER JOIN public.driver_restaurants dr ON dr.driver_id = d2.driver_id
  INNER JOIN public.restaurants r ON r.id = dr.restaurant_id
  WHERE d2.restaurant_id IS NULL
    AND drv.partner_id IS NOT NULL
    AND r.partner_id = drv.partner_id
    AND r.status = 'published'
    AND r.is_active = true
  GROUP BY d2.id
  HAVING COUNT(DISTINCT dr.restaurant_id) = 1
) AS inferred
WHERE d.id = inferred.delivery_id
  AND d.restaurant_id IS NULL;

UPDATE public.deliveries AS d
SET restaurant_id = inferred.restaurant_id
FROM (
  SELECT
    d2.id AS delivery_id,
    (MIN(r.id::text))::uuid AS restaurant_id
  FROM public.deliveries d2
  INNER JOIN public.drivers drv ON drv.id = d2.driver_id
  INNER JOIN public.restaurants r ON r.partner_id = drv.partner_id
  WHERE d2.restaurant_id IS NULL
    AND drv.partner_id IS NOT NULL
    AND r.is_active = true
  GROUP BY d2.id
  HAVING COUNT(DISTINCT r.id) = 1
) AS inferred
WHERE d.id = inferred.delivery_id
  AND d.restaurant_id IS NULL;
