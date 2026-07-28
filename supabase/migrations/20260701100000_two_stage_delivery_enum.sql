-- Expand delivery_status enum (must commit before using new values in indexes/RPCs).
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'in_transit';
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'cancelled';
