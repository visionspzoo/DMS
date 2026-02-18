/*
  # Napraw unikalny indeks file_hash dla faktur KSEF

  ## Problem
  Indeks UNIQUE (file_hash, uploaded_by) blokuje transfer faktur KSEF z błędem 409 Conflict,
  gdy ten sam PDF (ten sam file_hash) był już wcześniej powiązany z tym samym uploader.
  Faktury KSEF mają zawsze ten sam PDF base64, więc przy ponownej próbie transferu
  lub gdy kilka faktur ma podobne PDFy - rzucany jest błąd unikalności.

  ## Rozwiązanie
  Zmień unikalny indeks żeby obejmował tylko faktury z source != 'ksef'.
  Faktury KSEF powinny być sprawdzane na podstawie ksef_reference_number,
  a nie file_hash.
*/

DROP INDEX IF EXISTS idx_invoices_file_hash_per_user;

CREATE UNIQUE INDEX idx_invoices_file_hash_per_user
  ON invoices (file_hash, uploaded_by)
  WHERE file_hash IS NOT NULL AND (source IS NULL OR source != 'ksef');
