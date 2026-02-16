/*
  # Przebudowanie funkcji check_director_can_approve z poprawnymi nazwami parametrów

  ## Problem
  Parametry funkcji kolidują z nazwami kolumn w zapytaniu SQL.

  ## Rozwiązanie
  1. Usunięcie starej funkcji
  2. Utworzenie nowej z prefiksami parametrów p_
*/

-- Usuń starą funkcję
DROP FUNCTION IF EXISTS check_director_can_approve(uuid, uuid, numeric);

-- Utwórz nową funkcję z poprawnymi nazwami parametrów
CREATE OR REPLACE FUNCTION check_director_can_approve(
    p_director_id uuid,
    p_invoice_id uuid,
    p_invoice_amount decimal
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
    WHERE id = p_director_id AND role = 'Dyrektor';
    
    -- Jeśli brak limitów (NULL), zawsze wymaga CEO
    IF v_monthly_limit IS NULL OR v_single_limit IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Sprawdź limit pojedynczej faktury
    IF p_invoice_amount > v_single_limit THEN
        RETURN FALSE;
    END IF;
    
    -- Pobierz datę faktury
    SELECT issue_date INTO v_invoice_date
    FROM invoices
    WHERE id = p_invoice_id;
    
    -- Oblicz sumę faktur zatwierdzonych przez tego Dyrektora w bieżącym miesiącu
    -- (nie wliczając bieżącej faktury)
    SELECT COALESCE(SUM(i.pln_gross_amount), 0)
    INTO v_current_month_total
    FROM invoices i
    JOIN audit_logs al ON al.invoice_id = i.id
    WHERE al.user_id = p_director_id
    AND al.action = 'approved'
    AND DATE_TRUNC('month', i.issue_date) = DATE_TRUNC('month', v_invoice_date)
    AND i.id != p_invoice_id;
    
    -- Sprawdź czy dodanie tej faktury przekroczy limit miesięczny
    IF (v_current_month_total + p_invoice_amount) > v_monthly_limit THEN
        RETURN FALSE;
    END IF;
    
    -- Wszystkie limity OK
    RETURN TRUE;
END;
$$;

-- Zaktualizuj trigger function aby używała nowych nazw parametrów
CREATE OR REPLACE FUNCTION auto_approve_director_within_limits()
RETURNS trigger AS $$
DECLARE
    v_director_role text;
    v_invoice_amount decimal;
    v_can_approve boolean;
    v_ceo_id uuid;
BEGIN
    -- Sprawdź tylko gdy status zmienia się na 'accepted' przez Dyrektora
    IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
        -- Sprawdź czy akceptujący to Dyrektor
        SELECT role INTO v_director_role
        FROM profiles
        WHERE id = OLD.current_approver_id;
        
        IF v_director_role = 'Dyrektor' THEN
            -- Pobierz kwotę faktury w PLN
            v_invoice_amount := COALESCE(NEW.pln_gross_amount, NEW.gross_amount);
            
            -- Sprawdź czy Dyrektor może zatwierdzić bez CEO
            v_can_approve := check_director_can_approve(
                OLD.current_approver_id,
                NEW.id,
                v_invoice_amount
            );
            
            IF v_can_approve THEN
                -- Dyrektor może zatwierdzić - zakończ workflow
                NEW.current_approver_id := NULL;
                
                -- Dodaj log
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    OLD.current_approver_id,
                    'approved_by_director_within_limits',
                    jsonb_build_object(
                        'invoice_amount', v_invoice_amount,
                        'within_limits', true
                    ),
                    'Faktura zatwierdzona przez Dyrektora w ramach przysługujących limitów'
                );
            ELSE
                -- Limity przekroczone - przekaż do CEO
                SELECT id INTO v_ceo_id
                FROM profiles
                WHERE role = 'CEO'
                LIMIT 1;
                
                NEW.status := 'waiting';
                NEW.current_approver_id := v_ceo_id;
                
                -- Dodaj log
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    OLD.current_approver_id,
                    'forwarded_to_ceo_limits_exceeded',
                    jsonb_build_object(
                        'invoice_amount', v_invoice_amount,
                        'limits_exceeded', true
                    ),
                    'Faktura przekazana do CEO - przekroczenie limitów Dyrektora'
                );
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
