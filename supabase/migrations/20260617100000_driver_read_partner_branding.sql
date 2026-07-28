-- Allow drivers to read partner name/logo for deliveries they own (list join).
CREATE POLICY drivers_read_partner_branding ON public.partners
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.deliveries d
      WHERE d.partner_id = partners.id
        AND d.driver_id = auth.uid()
    )
  );
