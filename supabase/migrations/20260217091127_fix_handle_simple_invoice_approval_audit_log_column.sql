/*
  # Naprawa funkcji handle_simple_invoice_approval - zmiana kolumny details na description
  
  ## Problem
  Funkcja handle_simple_invoice_approval() używa kolumny "details", ale tabela audit_logs ma kolumnę "description".
  
  ## Rozwiązanie
  Zaktualizuj funkcję aby używała właściwej kolumny "description".
*/

CREATE OR REPLACE FUNCTION handle_simple_invoice_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_approver_role text;
  v_director_limit numeric;
  v_current_month_total numeric;
  v_ceo_id uuid;
BEGIN
  -- Tylko przy zmianie waiting → accepted
  IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
    -- Pobierz rolę akceptującego
    SELECT role INTO v_approver_role
    FROM profiles
    WHERE id = auth.uid();

    -- Dyrektor musi sprawdzić osobiste limity (suma wszystkich działów)
    IF v_approver_role = 'dyrektor' THEN
      -- Pobierz osobisty limit dyrektora
      SELECT director_approval_limit INTO v_director_limit
      FROM profiles
      WHERE id = auth.uid();

      -- Jeśli jest limit, sprawdź czy nie został przekroczony
      IF v_director_limit IS NOT NULL THEN
        -- Oblicz sumę zaakceptowanych faktur we wszystkich działach dyrektora w tym miesiącu
        SELECT COALESCE(SUM(pln_gross_amount), 0) INTO v_current_month_total
        FROM invoices
        WHERE status IN ('accepted', 'paid')
          AND current_approver_id = auth.uid()
          AND department_id IN (
            SELECT id FROM departments WHERE director_id = auth.uid()
          )
          AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE);

        -- Jeśli przekroczy limit, przekaż do CEO
        IF (v_current_month_total + NEW.pln_gross_amount) > v_director_limit THEN
          SELECT id INTO v_ceo_id FROM profiles WHERE role = 'ceo' LIMIT 1;
          
          IF v_ceo_id IS NOT NULL THEN
            -- Przekaż do CEO zamiast akceptować
            NEW.status := 'waiting';
            NEW.current_approver_id := v_ceo_id;
            
            INSERT INTO audit_logs (invoice_id, user_id, action, description)
            VALUES (
              NEW.id,
              auth.uid(),
              'forwarded_to_ceo',
              'Faktura przekazana do CEO - przekroczono limity dyrektora'
            );
            
            RETURN NEW;
          END IF;
        END IF;
      END IF;

      -- W limitach lub brak CEO - zaakceptuj
      NEW.current_approver_id := NULL;
      NEW.approved_by_director_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
