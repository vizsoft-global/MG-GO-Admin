-- Optional letters-only validation for text custom fields (names vs free text / IDs)

ALTER TABLE public.custom_field_definitions
  ADD COLUMN IF NOT EXISTS letters_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.custom_field_definitions.letters_only IS
  'When true and field_type=text, values may contain letters, spaces, hyphen, apostrophe only.';
