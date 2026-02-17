/*
  # Naprawa Format Strings w check_director_limits
  
  ## Problem
  Funkcja używa %.2f w format() ale PostgreSQL wymaga %s dla wszystkich typów.
  
  ## Rozwiązanie
  Zamień %.2f na %s i użyj CAST do formatowania liczb.
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
    
    -- Oblicz sumę zatwierdzonych faktur w tym miesiącu
    SELECT COALESCE(SUM(pln_gross_amount), 0)
    INTO v_monthly_total
    FROM invoices
    WHERE uploaded_by = p_director_id
    AND status = 'accepted'
    AND DATE_TRUNC('month', COALESCE(issue_date, created_at)) = DATE_TRUNC('month', p_invoice_date)
    AND (p_invoice_id IS NULL OR id != p_invoice_id);
    
    -- Sprawdź limit miesięczny
    IF (v_monthly_total + p_invoice_amount) > v_monthly_limit THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'monthly_limit_exceeded',
            'message', format('Przekroczono limit miesięczny (%s PLN + %s PLN > %s PLN)', 
                            v_monthly_total::text, p_invoice_amount::text, v_monthly_limit::text),
            'monthly_total', v_monthly_total,
            'invoice_amount', p_invoice_amount,
            'monthly_limit', v_monthly_limit
        );
    END IF;
    
    -- Wszystko OK - faktura mieści się w limitach
    RETURN jsonb_build_object(
        'within_limits', true,
        'message', format('Faktura mieści się w limitach dyrektora (%s PLN, suma miesięczna: %s PLN)', 
                        p_invoice_amount::text, (v_monthly_total + p_invoice_amount)::text),
        'monthly_total', v_monthly_total,
        'invoice_amount', p_invoice_amount,
        'single_limit', v_single_limit,
        'monthly_limit', v_monthly_limit
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
