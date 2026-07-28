-- Fresh projects need PostGIS types in the extensions schema.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
