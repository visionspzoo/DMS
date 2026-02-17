/*
  # Naprawa Limitów Dyrektora - Suma z Wszystkich Działów

  ## Problem
  Obecna funkcja liczy tylko faktury gdzie uploaded_by = director_id.
  To jest błędne, bo dyrektor może zarządzać wieloma działami (IT, Marketing, Ecommerce).
  
  ## Rozwiązanie
  Limity dyrektora powinny sumować faktury z WSZYSTKICH działów, którymi zarządza.
  
  ## Logika
  1. Znajdź wszystkie działy gdzie director_id = p_director_id
  2. Zsumuj zaakceptowane faktury z tych wszystkich działów
  3. Sprawdź limity na podstawie tej łącznej sumy
  
  ## Przykład
  Jeśli dyrektor zarządza:
  - Dział IT (faktury za 50,000 PLN)
  - Dział Marketing (faktury za 30,000 PLN)
  - Dział Ecommerce (faktury za 20,000 PLN)
  
  Suma miesięczna = 100,000 PLN (nie tylko faktury które sam stworzył)
*/

CREATE OR REPLACE FUNCTION check_director_limits(
    p_director_id uuid,
    p_invoice_amount numeric,
    p_invoice_date date,
    p_invoice_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_single_limit numeric;
    v_monthly_limit numeric;
    v_monthly_total numeric;
    v_department_count int;
    v_result jsonb;
BEGIN
    -- Pobierz limity dyrektora
    SELECT 
        single_invoice_limit,
        monthly_invoice_limit
    INTO v_single_limit, v_monthly_limit
    FROM profiles
    WHERE id = p_director_id;
    
    -- Jeśli dyrektor nie ma ustawionych limitów, nie może automatycznie akceptować
    IF v_single_limit IS NULL OR v_monthly_limit IS NULL THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'no_limits_set',
            'message', 'Dyrektor nie ma ustawionych limitów - wymaga akceptacji CEO'
        );
    END IF;
    
    -- Sprawdź limit pojedynczej faktury
    IF p_invoice_amount > v_single_limit THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'single_invoice_limit_exceeded',
            'message', format('Przekroczono limit pojedynczej faktury (%s PLN > %s PLN)', 
                            p_invoice_amount::text, v_single_limit::text),
            'invoice_amount', p_invoice_amount,
            'single_limit', v_single_limit
        );
    END IF;
    
    -- Oblicz sumę zatwierdzonych faktur w tym miesiącu ze WSZYSTKICH działów dyrektora
    SELECT COALESCE(SUM(i.pln_gross_amount), 0)
    INTO v_monthly_total
    FROM invoices i
    INNER JOIN departments d ON i.department_id = d.id
    WHERE d.director_id = p_director_id
    AND i.status = 'accepted'
    AND DATE_TRUNC('month', COALESCE(i.issue_date, i.created_at)) = DATE_TRUNC('month', p_invoice_date)
    AND (p_invoice_id IS NULL OR i.id != p_invoice_id);
    
    -- Sprawdź limit miesięczny
    IF (v_monthly_total + p_invoice_amount) > v_monthly_limit THEN
        -- Policz ile działów zarządza dyrektor (dla info)
        SELECT COUNT(*) INTO v_department_count
        FROM departments
        WHERE director_id = p_director_id;
        
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'monthly_limit_exceeded',
            'message', format('Przekroczono limit miesięczny (%s PLN + %s PLN > %s PLN) dla %s działów', 
                            v_monthly_total::text, p_invoice_amount::text, v_monthly_limit::text, v_department_count::text),
            'monthly_total', v_monthly_total,
            'invoice_amount', p_invoice_amount,
            'monthly_limit', v_monthly_limit,
            'departments_count', v_department_count
        );
    END IF;
    
    -- Policz ile działów zarządza dyrektor (dla info w sukcessie)
    SELECT COUNT(*) INTO v_department_count
    FROM departments
    WHERE director_id = p_director_id;
    
    -- Wszystko OK - faktura mieści się w limitach
    RETURN jsonb_build_object(
        'within_limits', true,
        'message', format('Faktura mieści się w limitach dyrektora (%s PLN, suma miesięczna: %s PLN z %s działów)', 
                        p_invoice_amount::text, (v_monthly_total + p_invoice_amount)::text, v_department_count::text),
        'monthly_total', v_monthly_total,
        'invoice_amount', p_invoice_amount,
        'single_limit', v_single_limit,
        'monthly_limit', v_monthly_limit,
        'departments_count', v_department_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_director_limits IS 
'Sprawdza limity dyrektora sumując faktury ze WSZYSTKICH działów, którymi zarządza.
Nie liczy tylko faktur stworzonych przez dyrektora, ale wszystkie zaakceptowane faktury z jego działów.';
