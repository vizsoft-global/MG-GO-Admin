-- Realtime for tables that affect driver proximity / assignment context.
ALTER PUBLICATION supabase_realtime ADD TABLE public.zones;
ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_restaurants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
