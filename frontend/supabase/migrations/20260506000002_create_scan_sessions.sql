-- ============================================================
-- Migration: scan_sessions + scan_session_items
-- Created: 2026-05-06
--
-- HOW TO RUN
-- ----------
-- Paste into Supabase SQL Editor → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scan_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type  text        NOT NULL CHECK (session_type IN ('STANDARD','RECEIVING','STOCKTAKE','PICKING')),
  reference     text,                        -- PO number (RECEIVING) or order ref (PICKING)
  operator      text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','discarded')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scan_session_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid        NOT NULL REFERENCES public.scan_sessions(id) ON DELETE CASCADE,
  sku           text        NOT NULL,
  scanned_qty   integer     NOT NULL DEFAULT 0,
  expected_qty  integer,                     -- RECEIVING mode: expected from PO
  movement_id   uuid,                        -- FK to stock_movements.id when confirmed
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scan_session_items_session_id_idx ON public.scan_session_items(session_id);
CREATE INDEX IF NOT EXISTS scan_session_items_sku_idx        ON public.scan_session_items(sku);
CREATE INDEX IF NOT EXISTS scan_sessions_status_idx          ON public.scan_sessions(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS scan_session_items_updated_at ON public.scan_session_items;
CREATE TRIGGER scan_session_items_updated_at
  BEFORE UPDATE ON public.scan_session_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.scan_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_session_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "scan_sessions_read"  ON public.scan_sessions      FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "scan_sessions_write" ON public.scan_sessions      FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "scan_items_read"     ON public.scan_session_items FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "scan_items_write"    ON public.scan_session_items FOR ALL    TO authenticated USING (true) WITH CHECK (true);
