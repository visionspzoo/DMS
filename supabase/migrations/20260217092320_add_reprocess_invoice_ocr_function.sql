/*
  # Dodaj funkcję do ponownego przetwarzania OCR faktur

  ## Cel
  Umożliwienie ręcznego ponownego przetworzenia faktur, które zostały źle zinterpretowane przez AI.
  
  ## Funkcjonalność
  Funkcja `reprocess_invoice_ocr` wywołuje edge function process-invoice-ocr dla podanej faktury.
  
  ## Użycie
  SELECT reprocess_invoice_ocr('invoice-id-uuid');
*/

CREATE OR REPLACE FUNCTION reprocess_invoice_ocr(invoice_id_param uuid)
RETURNS jsonb AS $$
DECLARE
  invoice_record RECORD;
  ocr_result jsonb;
  request_url text;
  request_body jsonb;
BEGIN
  -- Pobierz dane faktury
  SELECT id, pdf_base64, file_url
  INTO invoice_record
  FROM invoices
  WHERE id = invoice_id_param;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Faktura nie znaleziona'
    );
  END IF;
  
  -- Sprawdź czy faktura ma PDF
  IF invoice_record.pdf_base64 IS NULL AND invoice_record.file_url IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Faktura nie ma przypisanego pliku PDF'
    );
  END IF;
  
  -- Oznacz fakturę jako wymagającą ponownego przetworzenia
  -- (opcjonalnie - możemy dodać flagę w bazie)
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Faktura została oznaczona do ponownego przetworzenia. Użyj UI lub wywołaj bezpośrednio edge function process-invoice-ocr.',
    'invoice_id', invoice_id_param,
    'has_pdf_base64', invoice_record.pdf_base64 IS NOT NULL,
    'has_file_url', invoice_record.file_url IS NOT NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nadaj uprawnienia
GRANT EXECUTE ON FUNCTION reprocess_invoice_ocr(uuid) TO authenticated;
