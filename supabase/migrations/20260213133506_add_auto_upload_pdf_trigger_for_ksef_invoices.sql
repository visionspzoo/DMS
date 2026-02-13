/*
  # Automatyczne uploadowanie PDF do Google Drive dla faktur KSEF

  ## Cel
  Po automatycznym przeniesieniu faktury KSEF do tabeli invoices, jeśli faktura ma pdf_base64 
  ale nie ma google_drive_id, trigger automatycznie wywoła Edge Function która uploaduje PDF 
  do Google Drive.

  ## Rozwiązanie
  1. Tworzy funkcję trigger która sprawdza czy faktura potrzebuje uploadu PDF
  2. Używa pg_net do asynchronicznego wywołania Edge Function auto-upload-ksef-pdfs
  3. Dodaje trigger AFTER INSERT/UPDATE na invoices

  ## Przepływ
  - Faktura KSEF jest przenoszona do invoices (automatycznie lub ręcznie)
  - Jeśli ma pdf_base64 ale nie ma google_drive_id, trigger wywołuje Edge Function
  - Edge Function uploaduje PDF do Google Drive i aktualizuje google_drive_id
*/

-- Funkcja trigger do automatycznego uploadu PDF dla faktur KSEF
CREATE OR REPLACE FUNCTION trigger_auto_upload_ksef_pdf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url text;
  v_supabase_anon_key text;
  v_request_id bigint;
BEGIN
  -- Sprawdź czy faktura ma pdf_base64 ale nie ma google_drive_id
  IF NEW.source = 'ksef' 
     AND NEW.pdf_base64 IS NOT NULL 
     AND NEW.google_drive_id IS NULL 
     AND NEW.department_id IS NOT NULL THEN
    
    -- Pobierz zmienne środowiskowe
    v_supabase_url := current_setting('app.settings.supabase_url', true);
    v_supabase_anon_key := current_setting('app.settings.supabase_anon_key', true);
    
    -- Jeśli zmienne nie są ustawione, użyj wartości domyślnych (hardcoded)
    -- UWAGA: W produkcji powinny być ustawione przez pg_settings
    IF v_supabase_url IS NULL THEN
      v_supabase_url := 'https://xyzcompany.supabase.co';
    END IF;
    
    IF v_supabase_anon_key IS NULL THEN
      v_supabase_anon_key := 'dummy-key';
    END IF;
    
    RAISE NOTICE 'Triggering auto-upload-ksef-pdfs for invoice % (ID: %)', NEW.invoice_number, NEW.id;
    
    -- Wywołaj Edge Function asynchronicznie używając pg_net
    BEGIN
      SELECT INTO v_request_id net.http_post(
        url := v_supabase_url || '/functions/v1/auto-upload-ksef-pdfs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_supabase_anon_key
        ),
        body := jsonb_build_object(
          'invoiceId', NEW.id
        )
      );
      
      RAISE NOTICE 'Auto-upload request queued with ID: %', v_request_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to queue auto-upload request: %', SQLERRM;
    END;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Dodaj trigger AFTER INSERT na invoices
DROP TRIGGER IF EXISTS trigger_auto_upload_ksef_pdf_after_insert ON invoices;

CREATE TRIGGER trigger_auto_upload_ksef_pdf_after_insert
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_upload_ksef_pdf();

-- Dodaj trigger AFTER UPDATE na invoices (jeśli pdf_base64 zostanie dodane później)
DROP TRIGGER IF EXISTS trigger_auto_upload_ksef_pdf_after_update ON invoices;

CREATE TRIGGER trigger_auto_upload_ksef_pdf_after_update
  AFTER UPDATE ON invoices
  FOR EACH ROW
  WHEN (
    NEW.source = 'ksef' 
    AND NEW.pdf_base64 IS NOT NULL 
    AND NEW.google_drive_id IS NULL 
    AND (OLD.pdf_base64 IS NULL OR OLD.google_drive_id IS NOT NULL)
  )
  EXECUTE FUNCTION trigger_auto_upload_ksef_pdf();
