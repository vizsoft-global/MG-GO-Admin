-- RSup/11 Tower Intro: "Working hours" and "Contact" were hardcoded Figma
-- copy in the Flutter app because `visit_branches` had no columns for them.
-- Additive columns + seed for the existing Central Tower row so the intro
-- card becomes DB-backed like `name`/`address` already are.

ALTER TABLE public.visit_branches
  ADD COLUMN IF NOT EXISTS working_hours text,
  ADD COLUMN IF NOT EXISTS contact_phone text;

UPDATE public.visit_branches
SET address = COALESCE(address, 'Sheikh Zayed Rd, Kuwait'),
    working_hours = 'Sun - Thu, 9:00 AM - 5:00 PM',
    contact_phone = '+971 4 XXX XXXX',
    updated_at = now()
WHERE key = 'central_tower' AND working_hours IS NULL;
