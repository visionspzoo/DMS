/*
  # Uproszczenie mechanizmu auto-uploadu PDF

  ## Problem
  Poprzednia migracja tworzyła trigger który wywoływał HTTP request przez pg_net,
  co jest skomplikowane i wymaga konfiguracji zmiennych środowiskowych.

  ## Rozwiązanie
  1. Usuń trigger który wywołuje HTTP request
  2. Zamiast tego, Edge Function `auto-upload-ksef-pdfs` może być wywołana ręcznie
  3. Lub można ustawić cron job który będzie okresowo sprawdzał faktury

  ## Uwagi
  - Transfer-ksef-invoice już uploaduje PDF do Google Drive
  - Auto-upload jest potrzebny tylko dla automatycznie przeniesionych faktur
  - Można wywołać auto-upload-ksef-pdfs ręcznie z frontendu po fetchowaniu faktur
*/

-- Usuń triggery HTTP
DROP TRIGGER IF EXISTS trigger_auto_upload_ksef_pdf_after_insert ON invoices;
DROP TRIGGER IF EXISTS trigger_auto_upload_ksef_pdf_after_update ON invoices;

-- Usuń funkcję trigger
DROP FUNCTION IF EXISTS trigger_auto_upload_ksef_pdf();

-- Funkcja pomocnicza do ręcznego wywołania z SQL
-- Można ją wywołać ręcznie: SELECT upload_ksef_pdfs_to_drive();
CREATE OR REPLACE FUNCTION upload_ksef_pdfs_to_drive()
RETURNS TABLE(
  invoice_id uuid,
  invoice_number text,
  status text,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.id,
    i.invoice_number,
    'needs_upload'::text,
    'Invoice has PDF but no Google Drive ID'::text
  FROM invoices i
  WHERE i.source = 'ksef'
    AND i.pdf_base64 IS NOT NULL
    AND i.google_drive_id IS NULL
    AND i.department_id IS NOT NULL
  ORDER BY i.created_at DESC;
END;
$$;

COMMENT ON FUNCTION upload_ksef_pdfs_to_drive() IS 
'Lista faktur KSEF które mają PDF ale nie mają Google Drive ID. Wywołaj Edge Function auto-upload-ksef-pdfs aby je uploadować.';
