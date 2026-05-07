-- ============================================================
-- Migration: barcode_registry
-- Created: 2026-05-06
--
-- PURPOSE
-- -------
-- Maps physical barcode values (printed on product stickers)
-- to your internal SKU codes.
--
-- HOW TO RUN
-- ----------
-- Paste this into the Supabase SQL Editor and click "Run".
-- (Dashboard → SQL Editor → New query → paste → Run)
--
-- HOW IT WORKS IN THE APP
-- -----------------------
-- When the Scanner page reads a barcode, the lookup API checks
-- this table first.  If it finds a match it uses that SKU.
-- If not, it falls back to treating the barcode itself as the SKU.
--
-- ADDING MAPPINGS
-- ---------------
-- Option 1 — Supabase UI:
--   Table Editor → barcode_registry → Insert row
--
-- Option 2 — SQL:
--   INSERT INTO barcode_registry (barcode, sku, label)
--   VALUES ('1234567890128', 'FWD100', 'Forward Widget 100g');
--
-- Option 3 — Bulk CSV import via Supabase Table Editor.
-- ============================================================

-- Create the table (safe to run multiple times)
CREATE TABLE IF NOT EXISTS public.barcode_registry (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode     text        NOT NULL,
  sku         text        NOT NULL,
  label       text,                          -- optional friendly product name
  unit        text,                          -- e.g. 'box', 'piece', 'kg'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Unique index so the same barcode can't map to two SKUs
CREATE UNIQUE INDEX IF NOT EXISTS barcode_registry_barcode_unique
  ON public.barcode_registry (barcode);

-- Index for fast SKU reverse-lookup
CREATE INDEX IF NOT EXISTS barcode_registry_sku_idx
  ON public.barcode_registry (sku);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS barcode_registry_updated_at ON public.barcode_registry;
CREATE TRIGGER barcode_registry_updated_at
  BEFORE UPDATE ON public.barcode_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Row-level security (recommended)
ALTER TABLE public.barcode_registry ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY IF NOT EXISTS "barcode_registry_read"
  ON public.barcode_registry FOR SELECT
  TO authenticated USING (true);

-- Allow authenticated users to insert/update (adjust as needed)
CREATE POLICY IF NOT EXISTS "barcode_registry_write"
  ON public.barcode_registry FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ── Sample data (delete or comment out before running in production) ──────
-- INSERT INTO public.barcode_registry (barcode, sku, label) VALUES
--   ('0000000000001', 'EXAMPLE-SKU-001', 'Example Product A'),
--   ('0000000000002', 'EXAMPLE-SKU-002', 'Example Product B')
-- ON CONFLICT (barcode) DO NOTHING;
