/*
  # Naprawienie błędu niejednoznacznej kolumny w check_director_can_approve

  ## Problem
  Kolumna "invoice_id" jest niejednoznaczna - może odnosić się do parametru funkcji lub kolumny w tabeli.

  ## Rozwiązanie
  Użycie aliasu tabeli (i.id) zamiast samej nazwy kolumny (invoice_id)
*/

-- Napraw funkcję sprawdzającą limity Dyrektora
CREATE OR REPLACE FUNCTION check_director_can_approve(
    director_id uuid,
    invoice_id uuid,
    invoice_amount decimal
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_monthly_limit decimal;
    v_single_limit decimal;
    v_current_month_total decimal;
    v_invoice_date date;
BEGIN
    -- Pobierz limity Dyrektora
    SELECT monthly_invoice_limit, single_invoice_limit
    INTO v_monthly_limit, v_single_limit
    FROM profiles
    WHERE id = director_id AND role = 'Dyrektor';
    
    -- Jeśli brak limitów (NULL), zawsze wymaga CEO
    IF v_monthly_limit IS NULL OR v_single_limit IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Sprawdź limit pojedynczej faktury
    IF invoice_amount > v_single_limit THEN
        RETURN FALSE;
    END IF;
    
    -- Pobierz datę faktury
    SELECT issue_date INTO v_invoice_date
    FROM invoices
    WHERE id = invoice_id;
    
    -- Oblicz sumę faktur zatwierdzonych przez tego Dyrektora w bieżącym miesiącu
    -- (nie wliczając bieżącej faktury)
    -- Użyj i.id zamiast invoice_id aby uniknąć niejednoznaczności
    SELECT COALESCE(SUM(i.pln_gross_amount), 0)
    INTO v_current_month_total
    FROM invoices i
    JOIN audit_logs al ON al.invoice_id = i.id
    WHERE al.user_id = director_id
    AND al.action = 'approved'
    AND DATE_TRUNC('month', i.issue_date) = DATE_TRUNC('month', v_invoice_date)
    AND i.id != invoice_id;  -- Użyj parametru funkcji
    
    -- Sprawdź czy dodanie tej faktury przekroczy limit miesięczny
    IF (v_current_month_total + invoice_amount) > v_monthly_limit THEN
        RETURN FALSE;
    END IF;
    
    -- Wszystkie limity OK
    RETURN TRUE;
END;
$$;
