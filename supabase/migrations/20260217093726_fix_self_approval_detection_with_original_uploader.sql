/*
  # Naprawa Wykrywania Samo-Zatwierdzania - Dodanie Original Uploader

  ## Problem
  System sprawdza samo-zatwierdzenie porównując `uploaded_by` z `current_approver_id`.
  Jednak `uploaded_by` jest automatycznie zmieniany przez system (np. na dyrektora działu),
  co powoduje fałszywe wykrycie samo-zatwierdzenia.
  
  Przykład:
  - Użytkownik A (Kierownik) tworzy fakturę → uploaded_by = A
  - System automatycznie zmienia uploaded_by na B (Dyrektor działu)
  - Dyrektor B próbuje zaakceptować → system wykrywa uploaded_by = current_approver_id
  - Faktura trafia do CEO mimo że B nie stworzył faktury osobiście

  ## Rozwiązanie
  1. Dodaj kolumnę `original_uploader_id` - NIGDY nie zmieniana, zawsze pierwotny twórca
  2. Zaktualizuj logikę samo-zatwierdzenia aby sprawdzała `original_uploader_id`
  3. Dyrektor może zatwierdzać faktury w swoim dziale, jeśli nie on sam je stworzył
  
  ## Zmiany
  1. Nowa kolumna: `original_uploader_id` (niezmieniana)
  2. Trigger: `set_original_uploader` - ustawia przy tworzeniu faktury
  3. Aktualizacja: `prevent_self_approval()` - sprawdza original_uploader_id
  4. Backfill: uzupełnienie danych dla istniejących faktur
*/

-- Dodaj kolumnę original_uploader_id
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS original_uploader_id uuid REFERENCES profiles(id);

COMMENT ON COLUMN invoices.original_uploader_id IS 'Pierwotny twórca faktury (nigdy nie zmieniana, w przeciwieństwie do uploaded_by która może być zmieniana przez workflow)';

-- Backfill: uzupełnij original_uploader_id dla istniejących faktur
UPDATE invoices
SET original_uploader_id = uploaded_by
WHERE original_uploader_id IS NULL;

-- Trigger do automatycznego ustawiania original_uploader_id przy tworzeniu
CREATE OR REPLACE FUNCTION set_original_uploader()
RETURNS trigger AS $$
BEGIN
    -- Ustaw original_uploader_id tylko przy tworzeniu (INSERT)
    IF TG_OP = 'INSERT' THEN
        NEW.original_uploader_id := NEW.uploaded_by;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS set_original_uploader_trigger ON invoices;
CREATE TRIGGER set_original_uploader_trigger
    BEFORE INSERT ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION set_original_uploader();

-- Zaktualizuj funkcję prevent_self_approval() aby sprawdzała original_uploader_id
CREATE OR REPLACE FUNCTION prevent_self_approval()
RETURNS trigger AS $$
DECLARE
    v_uploader_role text;
    v_original_uploader_role text;
    v_department_id uuid;
    v_next_approver_id uuid;
    v_ceo_id uuid;
BEGIN
    -- Sprawdź tylko jeśli status zmienia się na 'waiting'
    IF NEW.status = 'waiting' AND OLD.status != 'waiting' THEN
        -- KRYTYCZNA ZMIANA: Sprawdź czy current_approver_id == ORIGINAL_UPLOADER_ID
        -- (nie uploaded_by, który może być zmieniony przez system)
        IF NEW.current_approver_id = NEW.original_uploader_id THEN
            -- Pobierz rolę oryginalnego uploadera
            SELECT role, department_id 
            INTO v_original_uploader_role, v_department_id
            FROM profiles
            WHERE id = NEW.original_uploader_id;
            
            -- Znajdź CEO
            SELECT id INTO v_ceo_id
            FROM profiles
            WHERE role = 'CEO'
            LIMIT 1;
            
            -- Jeśli ORYGINALNY uploader jest Dyrektorem lub wyższym, automatycznie zaakceptuj
            -- i przekaż do CEO (lub zakończ jeśli uploader to CEO)
            IF v_original_uploader_role IN ('Dyrektor', 'CEO') THEN
                IF v_original_uploader_role = 'CEO' OR v_ceo_id = NEW.original_uploader_id THEN
                    -- CEO nie może zatwierdzać własnych faktur - oznacz jako zaakceptowaną
                    NEW.status := 'accepted';
                    NEW.current_approver_id := NULL;
                ELSE
                    -- Dyrektor - przekaż do CEO
                    NEW.status := 'waiting';
                    NEW.current_approver_id := v_ceo_id;
                END IF;
                
            ELSIF v_original_uploader_role = 'Kierownik' THEN
                -- Kierownik - przekaż do Dyrektora
                SELECT director_id INTO v_next_approver_id
                FROM departments
                WHERE id = COALESCE(NEW.department_id, v_department_id);
                
                -- Jeśli nie ma dyrektora w dziale, szukaj w profilach
                IF v_next_approver_id IS NULL THEN
                    SELECT id INTO v_next_approver_id
                    FROM profiles
                    WHERE department_id = COALESCE(NEW.department_id, v_department_id)
                    AND role = 'Dyrektor'
                    LIMIT 1;
                END IF;
                
                -- Jeśli nadal nie ma dyrektora, przekaż do CEO
                IF v_next_approver_id IS NULL THEN
                    v_next_approver_id := v_ceo_id;
                END IF;
                
                NEW.status := 'waiting';
                NEW.current_approver_id := v_next_approver_id;
                
            ELSE
                -- Dla Specjalisty lub innych ról - użyj standardowej funkcji
                v_next_approver_id := get_next_approver_in_department(
                    COALESCE(NEW.department_id, v_department_id),
                    v_original_uploader_role
                );
                
                NEW.status := 'waiting';
                NEW.current_approver_id := v_next_approver_id;
            END IF;
            
            -- Zaloguj automatyczne zatwierdzenie/przekierowanie
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                new_values,
                description
            ) VALUES (
                NEW.id,
                NEW.original_uploader_id,
                'auto_reassigned',
                jsonb_build_object(
                    'old_status', OLD.status,
                    'new_status', NEW.status,
                    'reason', 'self_approval_detected',
                    'uploader_role', v_original_uploader_role,
                    'old_approver_id', OLD.current_approver_id,
                    'new_approver_id', NEW.current_approver_id
                ),
                format('Faktura automatycznie przekierowana - wykryto próbę samo-zatwierdzenia (%s → %s)', 
                    v_original_uploader_role, 
                    CASE 
                        WHEN NEW.current_approver_id IS NULL THEN 'zatwierdzona'
                        ELSE 'przekazana dalej'
                    END)
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_invoices_original_uploader 
ON invoices(original_uploader_id) 
WHERE original_uploader_id IS NOT NULL;
