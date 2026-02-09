/*
  # Dodanie Workflow Akceptacji Faktur z Limitami

  1. Problem
    - Brak automatycznego przepływu faktur: Specjalista → Kierownik → Dyrektor
    - Limity nie są sprawdzane przy akceptacji przez Kierownika
    - Brak informacji kto aktualnie zatwierdza fakturę
    
  2. Nowe Kolumny
    - `current_approver_id` - kto aktualnie ma zatwierdzić fakturę
    - `approved_by_manager_at` - kiedy Kierownik zatwierdził
    - `approved_by_director_at` - kiedy Dyrektor zatwierdził
    
  3. Workflow
    - Specjalista wysyła fakturę → status 'waiting' → przypisana do Kierownika
    - Kierownik akceptuje:
      * Sprawdź limity działu (max_invoice_amount, max_monthly_amount)
      * Jeśli mieści się w limitach → status 'accepted' (auto-akceptacja)
      * Jeśli przekracza → status 'waiting' → przypisana do Dyrektora
    - Dyrektor akceptuje → status 'accepted'
    
  4. Limity
    - max_invoice_amount: limit na pojedynczą fakturę
    - max_monthly_amount: limit miesięczny dla działu
    - Oba limity są sprawdzane
*/

-- Dodaj kolumny do śledzenia workflow
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS current_approver_id uuid REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS approved_by_manager_at timestamptz,
ADD COLUMN IF NOT EXISTS approved_by_director_at timestamptz;

-- Dodaj indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_invoices_current_approver ON invoices(current_approver_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_approver ON invoices(status, current_approver_id);

-- Funkcja sprawdzająca czy faktura mieści się w limitach działu
CREATE OR REPLACE FUNCTION check_department_limits(
    p_department_id uuid,
    p_invoice_amount numeric,
    p_invoice_date timestamptz,
    p_exclude_invoice_id uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_max_invoice_amount numeric;
    v_max_monthly_amount numeric;
    v_current_month_total numeric;
    v_result jsonb;
BEGIN
    -- Pobierz limity działu
    SELECT 
        max_invoice_amount,
        max_monthly_amount
    INTO 
        v_max_invoice_amount,
        v_max_monthly_amount
    FROM departments
    WHERE id = p_department_id;
    
    -- Sprawdź limit na pojedynczą fakturę
    IF v_max_invoice_amount IS NOT NULL AND p_invoice_amount > v_max_invoice_amount THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'single_invoice_limit',
            'limit_value', v_max_invoice_amount,
            'invoice_value', p_invoice_amount,
            'message', format('Faktura (%s PLN) przekracza limit pojedynczej faktury (%s PLN)', 
                            ROUND(p_invoice_amount, 2), ROUND(v_max_invoice_amount, 2))
        );
    END IF;
    
    -- Sprawdź limit miesięczny
    IF v_max_monthly_amount IS NOT NULL THEN
        -- Oblicz sumę faktur w tym miesiącu
        SELECT COALESCE(SUM(COALESCE(pln_gross_amount, gross_amount)), 0)
        INTO v_current_month_total
        FROM invoices
        WHERE department_id = p_department_id
        AND status IN ('accepted', 'paid')
        AND DATE_TRUNC('month', COALESCE(issue_date, created_at)) = DATE_TRUNC('month', p_invoice_date)
        AND (p_exclude_invoice_id IS NULL OR id != p_exclude_invoice_id);
        
        -- Sprawdź czy po dodaniu nowej faktury przekroczymy limit
        IF (v_current_month_total + p_invoice_amount) > v_max_monthly_amount THEN
            RETURN jsonb_build_object(
                'within_limits', false,
                'reason', 'monthly_limit',
                'limit_value', v_max_monthly_amount,
                'current_total', v_current_month_total,
                'invoice_value', p_invoice_amount,
                'new_total', v_current_month_total + p_invoice_amount,
                'message', format('Suma miesięczna (%s PLN + %s PLN = %s PLN) przekroczy limit działu (%s PLN)', 
                                ROUND(v_current_month_total, 2), 
                                ROUND(p_invoice_amount, 2),
                                ROUND(v_current_month_total + p_invoice_amount, 2), 
                                ROUND(v_max_monthly_amount, 2))
            );
        END IF;
    END IF;
    
    -- Faktury mieszczą się w limitach
    RETURN jsonb_build_object(
        'within_limits', true,
        'message', 'Faktura mieści się w limitach działu'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Zaktualizuj funkcję auto-przypisywania faktury do akceptującego
CREATE OR REPLACE FUNCTION auto_assign_invoice_to_approver()
RETURNS trigger AS $$
DECLARE
    v_uploader_role text;
    v_uploader_dept_id uuid;
    v_next_approver_id uuid;
BEGIN
    -- Pobierz rolę i dział uploadującego
    SELECT role, department_id 
    INTO v_uploader_role, v_uploader_dept_id
    FROM profiles
    WHERE id = NEW.uploaded_by;
    
    -- Jeśli status to 'waiting' i brak current_approver_id, przypisz następnego akceptującego
    IF NEW.status = 'waiting' AND NEW.current_approver_id IS NULL THEN
        v_next_approver_id := get_next_approver_in_department(
            COALESCE(NEW.department_id, v_uploader_dept_id), 
            v_uploader_role
        );
        
        IF v_next_approver_id IS NOT NULL THEN
            NEW.current_approver_id := v_next_approver_id;
            
            -- Loguj przypisanie
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                new_values,
                description
            ) VALUES (
                NEW.id,
                NEW.uploaded_by,
                'assigned_to_approver',
                jsonb_build_object(
                    'current_approver_id', v_next_approver_id,
                    'uploader_role', v_uploader_role
                ),
                format('Faktura przypisana do akceptującego (rola uploadera: %s)', v_uploader_role)
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nowa funkcja obsługująca akceptację faktury przez Kierownika/Dyrektora
CREATE OR REPLACE FUNCTION handle_invoice_approval()
RETURNS trigger AS $$
DECLARE
    v_approver_role text;
    v_approver_dept_id uuid;
    v_limits_check jsonb;
    v_director_id uuid;
    v_dept_name text;
BEGIN
    -- Tylko gdy status zmienia się na 'accepted'
    IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
        -- Pobierz rolę akceptującego
        SELECT role, department_id 
        INTO v_approver_role, v_approver_dept_id
        FROM profiles
        WHERE id = auth.uid();
        
        -- Kierownik akceptuje fakturę
        IF v_approver_role = 'Kierownik' THEN
            NEW.approved_by_manager_at := now();
            
            -- Sprawdź limity działu
            v_limits_check := check_department_limits(
                NEW.department_id,
                COALESCE(NEW.pln_gross_amount, NEW.gross_amount),
                COALESCE(NEW.issue_date, NEW.created_at),
                NEW.id
            );
            
            -- Jeśli przekracza limity, przekaż do Dyrektora
            IF (v_limits_check->>'within_limits')::boolean = false THEN
                -- Znajdź Dyrektora działu
                SELECT director_id, name
                INTO v_director_id, v_dept_name
                FROM departments
                WHERE id = NEW.department_id;
                
                -- Jeśli nie ma dyrektora w tabeli departments, szukaj w profiles
                IF v_director_id IS NULL THEN
                    SELECT p.id
                    INTO v_director_id
                    FROM profiles p
                    WHERE p.department_id = NEW.department_id
                    AND p.role = 'Dyrektor'
                    LIMIT 1;
                END IF;
                
                -- Jeśli znaleziono Dyrektora, przekaż do niego
                IF v_director_id IS NOT NULL THEN
                    NEW.status := 'waiting';
                    NEW.current_approver_id := v_director_id;
                    
                    -- Loguj przekazanie do Dyrektora
                    INSERT INTO audit_logs (
                        invoice_id,
                        user_id,
                        action,
                        old_values,
                        new_values,
                        description
                    ) VALUES (
                        NEW.id,
                        auth.uid(),
                        'forwarded_to_director',
                        jsonb_build_object(
                            'status', 'accepted',
                            'current_approver_id', auth.uid()
                        ),
                        jsonb_build_object(
                            'status', 'waiting',
                            'current_approver_id', v_director_id,
                            'reason', v_limits_check->>'reason',
                            'message', v_limits_check->>'message'
                        ),
                        format('Faktura przekazana do Dyrektora - %s', v_limits_check->>'message')
                    );
                    
                    RAISE NOTICE 'Invoice % forwarded to Director - %', 
                        NEW.invoice_number, v_limits_check->>'message';
                ELSE
                    -- Brak Dyrektora - akceptuj mimo przekroczenia limitu
                    RAISE NOTICE 'Invoice % exceeds limits but no Director found - accepting', 
                        NEW.invoice_number;
                        
                    -- Loguj akceptację mimo przekroczenia
                    INSERT INTO audit_logs (
                        invoice_id,
                        user_id,
                        action,
                        new_values,
                        description
                    ) VALUES (
                        NEW.id,
                        auth.uid(),
                        'accepted_without_director',
                        jsonb_build_object(
                            'reason', v_limits_check->>'reason',
                            'message', v_limits_check->>'message'
                        ),
                        format('Faktura zaakceptowana przez Kierownika mimo przekroczenia limitów (brak Dyrektora) - %s', 
                               v_limits_check->>'message')
                    );
                END IF;
            ELSE
                -- Faktury mieści się w limitach - auto-akceptacja
                NEW.current_approver_id := NULL;
                
                -- Loguj auto-akceptację
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    auth.uid(),
                    'auto_accepted_within_limits',
                    jsonb_build_object(
                        'status', 'accepted',
                        'message', v_limits_check->>'message'
                    ),
                    'Faktura automatycznie zaakceptowana - mieści się w limitach działu'
                );
                
                RAISE NOTICE 'Invoice % auto-accepted - within department limits', NEW.invoice_number;
            END IF;
        
        -- Dyrektor akceptuje fakturę
        ELSIF v_approver_role = 'Dyrektor' THEN
            NEW.approved_by_director_at := now();
            NEW.current_approver_id := NULL;
            
            -- Loguj akceptację przez Dyrektora
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                new_values,
                description
            ) VALUES (
                NEW.id,
                auth.uid(),
                'approved_by_director',
                jsonb_build_object('status', 'accepted'),
                'Faktura zaakceptowana przez Dyrektora'
            );
            
            RAISE NOTICE 'Invoice % approved by Director', NEW.invoice_number;
        
        -- CEO lub Admin akceptuje
        ELSIF v_approver_role IN ('CEO', 'Admin') THEN
            NEW.current_approver_id := NULL;
            
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                new_values,
                description
            ) VALUES (
                NEW.id,
                auth.uid(),
                'approved_by_ceo_or_admin',
                jsonb_build_object('status', 'accepted', 'approver_role', v_approver_role),
                format('Faktura zaakceptowana przez %s', v_approver_role)
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Usuń stary trigger limitu miesięcznego (zastąpimy nowym)
DROP TRIGGER IF EXISTS invoice_limit_check_trigger ON invoices;

-- Dodaj nowy trigger obsługujący akceptację
DROP TRIGGER IF EXISTS invoice_approval_workflow_trigger ON invoices;
CREATE TRIGGER invoice_approval_workflow_trigger
    BEFORE UPDATE OF status ON invoices
    FOR EACH ROW
    WHEN (NEW.status = 'accepted' AND OLD.status = 'waiting')
    EXECUTE FUNCTION handle_invoice_approval();

-- Komentarze wyjaśniające
COMMENT ON COLUMN invoices.current_approver_id IS 
'ID użytkownika który aktualnie ma zatwierdzić fakturę (Kierownik lub Dyrektor)';

COMMENT ON COLUMN invoices.approved_by_manager_at IS 
'Data i czas zatwierdzenia przez Kierownika';

COMMENT ON COLUMN invoices.approved_by_director_at IS 
'Data i czas zatwierdzenia przez Dyrektora';

COMMENT ON FUNCTION check_department_limits IS 
'Sprawdza czy faktura mieści się w limitach działu (max_invoice_amount i max_monthly_amount)';

COMMENT ON FUNCTION handle_invoice_approval IS 
'Obsługuje workflow akceptacji faktury:
- Kierownik akceptuje → sprawdza limity → auto-accept lub przekazuje do Dyrektora
- Dyrektor akceptuje → finalna akceptacja';
