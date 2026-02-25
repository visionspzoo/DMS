/*
  # Faktury gościnne – wykluczenie z limitów dyrektora

  ## Opis
  Dyrektorzy mogą być dodawani jako członkowie obiegu cudzego działu (np. dyrektorzy do zarządu).
  Gdy dyrektor przetwarza fakturę przypisaną do działu, którego NIE jest formalnym dyrektorem
  (tzn. departments.director_id != dyrektor), ta faktura powinna przejść przez normalny
  proces akceptacji (np. do CEO), a NIE wliczać się do jego limitów miesięcznych.

  ## Zmiany
  1. Nowa kolumna `invoices.is_guest_department_invoice` (bool) – ustawiana na TRUE gdy
     uploaderem jest ktoś, kto jest TYLKO członkiem działu (department_members), ale NIE
     jest formalnym dyrektorem tego działu (departments.director_id).
  2. Aktualizacja `check_director_limits` – wyklucza faktury z działów gościnnych
     z sumy miesięcznej dyrektora.
  3. Nowa funkcja `get_director_member_departments` – zwraca działy, gdzie dany
     użytkownik jest członkiem obiegu (department_members), ale nie jest formalnym dyrektorem.
  4. Trigger `set_guest_department_flag` – automatycznie ustawia flagę przy INSERT.

  ## Nowe kolumny
  - `invoices.is_guest_department_invoice` – TRUE jeśli faktura pochodzi z działu gdzie
    uploader jest tylko gościem obiegu, a nie formalnym dyrektorem.

  ## Bezpieczeństwo
  Brak nowych tabel – bez zmian w RLS.
*/

-- 1. Dodaj kolumnę flagi do invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'is_guest_department_invoice'
  ) THEN
    ALTER TABLE invoices ADD COLUMN is_guest_department_invoice boolean DEFAULT false;
  END IF;
END $$;

-- 2. Funkcja pomocnicza – lista działów gdzie user jest TYLKO członkiem (nie formalnym dyrektorem)
CREATE OR REPLACE FUNCTION get_director_member_departments(p_user_id uuid)
RETURNS TABLE(department_id uuid) AS $$
BEGIN
  RETURN QUERY
  SELECT dm.department_id
  FROM department_members dm
  LEFT JOIN departments d ON d.id = dm.department_id AND d.director_id = p_user_id
  WHERE dm.user_id = p_user_id
    AND d.id IS NULL; -- nie jest formalnym dyrektorem tego działu
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- 3. Trigger – ustawia flagę is_guest_department_invoice przy INSERT
CREATE OR REPLACE FUNCTION set_guest_department_flag()
RETURNS trigger AS $$
DECLARE
  v_is_formal_director boolean;
BEGIN
  -- Sprawdź czy uploader jest formalnym dyrektorem tego działu
  SELECT EXISTS(
    SELECT 1 FROM departments
    WHERE id = NEW.department_id
      AND director_id = NEW.uploaded_by
  ) INTO v_is_formal_director;

  -- Jeśli department_id ustawione i uploader NIE jest formalnym dyrektorem tego działu,
  -- ale jest członkiem obiegu → oznacz jako gościnną
  IF NEW.department_id IS NOT NULL AND NOT v_is_formal_director THEN
    -- Sprawdź czy jest w department_members tego działu
    IF EXISTS (
      SELECT 1 FROM department_members
      WHERE department_id = NEW.department_id
        AND user_id = NEW.uploaded_by
    ) THEN
      NEW.is_guest_department_invoice := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_set_guest_department_flag ON invoices;
CREATE TRIGGER trg_set_guest_department_flag
  BEFORE INSERT OR UPDATE OF department_id, uploaded_by
  ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION set_guest_department_flag();

-- 4. Zaktualizuj check_director_limits – wyklucz faktury gościnne z sumy
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
BEGIN
    SELECT
        single_invoice_limit,
        monthly_invoice_limit
    INTO v_single_limit, v_monthly_limit
    FROM profiles
    WHERE id = p_director_id;

    IF v_single_limit IS NULL OR v_monthly_limit IS NULL THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'no_limits_set',
            'message', 'Dyrektor nie ma ustawionych limitów - wymaga akceptacji CEO'
        );
    END IF;

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

    -- Sumuj faktury z działów gdzie dyrektor jest FORMALNYM dyrektorem (director_id)
    -- WYKLUCZ faktury gościnne (is_guest_department_invoice = true)
    SELECT COALESCE(SUM(i.pln_gross_amount), 0)
    INTO v_monthly_total
    FROM invoices i
    INNER JOIN departments d ON i.department_id = d.id
    WHERE d.director_id = p_director_id
    AND i.status = 'accepted'
    AND COALESCE(i.is_guest_department_invoice, false) = false
    AND DATE_TRUNC('month', COALESCE(i.issue_date, i.created_at)) = DATE_TRUNC('month', p_invoice_date)
    AND (p_invoice_id IS NULL OR i.id != p_invoice_id);

    IF (v_monthly_total + p_invoice_amount) > v_monthly_limit THEN
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

    SELECT COUNT(*) INTO v_department_count
    FROM departments
    WHERE director_id = p_director_id;

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

COMMENT ON COLUMN invoices.is_guest_department_invoice IS
'TRUE gdy uploader jest członkiem obiegu (department_members) tego działu, ale nie jest jego formalnym dyrektorem (departments.director_id). Takie faktury NIE wliczają się do limitów miesięcznych dyrektora.';

COMMENT ON FUNCTION get_director_member_departments IS
'Zwraca listę działów, gdzie dany użytkownik jest członkiem obiegu (department_members), ale NIE jest formalnym dyrektorem (departments.director_id).';

COMMENT ON FUNCTION set_guest_department_flag IS
'Trigger ustawiający is_guest_department_invoice=true gdy uploader jest gościem obiegu w danym dziale.';

COMMENT ON FUNCTION check_director_limits IS
'Sprawdza limity dyrektora sumując faktury ze WSZYSTKICH formalnych działów dyrektora (director_id). Wyklucza faktury gościnne (is_guest_department_invoice=true).';
