/*
  # Naprawa: null invoice_number powoduje błąd w notyfikacjach

  ## Problem
  Funkcja notify_invoice_status_change() buduje message przez konkatenację z NEW.invoice_number.
  Gdy invoice_number jest NULL (faktura nieprzetworzona przez OCR), wynik konkatenacji jest NULL,
  co powoduje naruszenie NOT NULL constraint w tabeli notifications i rollback całej transakcji.
  
  To blokowało auto-akceptację faktur przez Kierownika - trigger z0 ustawiał status = accepted,
  ale notify_invoice_status_change rzucał błąd i całość była cofana do waiting.

  ## Rozwiązanie
  Użycie COALESCE dla invoice_number - fallback na 'bez numeru' gdy NULL.
*/

CREATE OR REPLACE FUNCTION notify_invoice_status_change()
RETURNS trigger AS $$
DECLARE
  v_notification_title text;
  v_notification_message text;
  v_recipient_id uuid;
  v_invoice_ref text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN

    v_invoice_ref := COALESCE(NEW.invoice_number, '(bez numeru)');

    CASE NEW.status
    WHEN 'pending' THEN
      v_notification_title := 'Faktura oczekuje na akceptację';
      v_notification_message := 'Faktura ' || v_invoice_ref || ' wymaga Twojej akceptacji';
      SELECT manager_id INTO v_recipient_id FROM departments WHERE id = NEW.department_id;

    WHEN 'waiting' THEN
      v_notification_title := 'Faktura oczekuje na akceptację';
      v_notification_message := 'Faktura ' || v_invoice_ref || ' wymaga Twojej akceptacji';
      v_recipient_id := NEW.current_approver_id;

    WHEN 'accepted' THEN
      v_notification_title := 'Faktura zaakceptowana';
      v_notification_message := 'Twoja faktura ' || v_invoice_ref || ' została zaakceptowana';
      v_recipient_id := NEW.uploaded_by;

    WHEN 'rejected' THEN
      v_notification_title := 'Faktura odrzucona';
      v_notification_message := 'Twoja faktura ' || v_invoice_ref || ' została odrzucona';
      v_recipient_id := NEW.uploaded_by;

    ELSE
      RETURN NEW;
    END CASE;

    IF v_recipient_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, message, invoice_id)
      VALUES (v_recipient_id, 'status_change', v_notification_title, v_notification_message, NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
