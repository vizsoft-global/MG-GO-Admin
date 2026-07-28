-- Enable realtime on app_settings so driver app can react instantly to maintenance toggles.
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
