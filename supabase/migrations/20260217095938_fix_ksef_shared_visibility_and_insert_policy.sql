/*
  # Napraw Współdzieloną Widoczność Faktur KSEF i Politykę INSERT
  
  ## Problem 1: Lista nieprzypisanych faktur KSEF jest osobna dla każdego użytkownika
  Aktualnie: każdy użytkownik widzi tylko faktury które sam pobrał (fetched_by = auth.uid())
  Powinno być: wszyscy użytkownicy z dostępem do KSEF widzą WSZYSTKIE nieprzypisane faktury
  
  ## Problem 2: Kierownik nie może przenieść faktury z KSEF do invoices
  Błąd: "new row violates row-level security policy for table invoices"
  Przyczyna: polityka INSERT wymaga uploaded_by = auth.uid(), ale funkcja transfer używa SERVICE_ROLE
  
  ## Rozwiązanie
  1. Zmień politykę SELECT dla ksef_invoices - nieprzypisane faktury są współdzielone
  2. Dodaj politykę INSERT dla invoices pozwalającą na utworzenie faktury z source='ksef'
  
  ## Uprawnienia do widoczności nieprzypisanych faktur KSEF
  - Admini (is_admin = true) - wszystkie faktury
  - CEO - wszystkie faktury  
  - Użytkownicy z can_access_ksef_config = true - nieprzypisane faktury
  - Dyrektorzy - nieprzypisane faktury
  - Kierownicy - nieprzypisane faktury
  - Specjaliści - tylko faktury które sami pobrali
*/

-- ============================================================================
-- KSEF_INVOICES: Współdzielona widoczność nieprzypisanych faktur
-- ============================================================================

-- Usuń starą politykę SELECT
DROP POLICY IF EXISTS "Users can view KSEF invoices based on role and department" ON ksef_invoices;

-- Stwórz nową politykę z współdzieloną widocznością dla nieprzypisanych faktur
CREATE POLICY "Users can view KSEF invoices based on role and department"
    ON ksef_invoices FOR SELECT
    TO authenticated
    USING (
        -- Admini widzą wszystko
        (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
        OR
        -- CEO widzi wszystko
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
        OR
        -- NIEPRZYPISANE faktury (współdzielone dla użytkowników z dostępem do KSEF)
        (
            transferred_to_department_id IS NULL 
            AND transferred_to_invoice_id IS NULL
            AND (
                -- Użytkownicy z dostępem do konfiguracji KSEF
                (SELECT can_access_ksef_config FROM profiles WHERE id = auth.uid()) = true
                OR
                -- Dyrektorzy mają dostęp do nieprzypisanych faktur
                (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
                OR
                -- Kierownicy mają dostęp do nieprzypisanych faktur
                (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
                OR
                -- Specjaliści widzą tylko te które sami pobrali
                (
                    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
                    AND fetched_by = auth.uid()
                )
            )
        )
        OR
        -- PRZYPISANE faktury - dotychczasowa logika
        (
            (transferred_to_department_id IS NOT NULL OR transferred_to_invoice_id IS NOT NULL)
            AND (
                -- Dyrektor widzi faktury przypisane do jego działów
                (
                    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
                    AND (
                        transferred_to_department_id IN (
                            SELECT id FROM departments WHERE director_id = auth.uid()
                        )
                        OR transferred_to_department_id IN (
                            WITH RECURSIVE dept_tree AS (
                                SELECT d.id FROM departments d
                                WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
                                UNION ALL
                                SELECT d.id FROM departments d
                                JOIN dept_tree dt ON d.parent_department_id = dt.id
                            )
                            SELECT id FROM dept_tree
                        )
                        OR fetched_by = auth.uid()
                    )
                )
                OR
                -- Kierownik widzi faktury przypisane do jego działu
                (
                    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
                    AND (
                        transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
                        OR fetched_by = auth.uid()
                    )
                )
                OR
                -- Specjalista widzi tylko te które sam pobrał
                (
                    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
                    AND fetched_by = auth.uid()
                )
            )
        )
    );

COMMENT ON POLICY "Users can view KSEF invoices based on role and department" ON ksef_invoices IS
'Współdzielona widoczność faktur KSEF:
- Admini i CEO: wszystkie faktury
- Nieprzypisane faktury: widoczne dla Dyrektorów, Kierowników i użytkowników z can_access_ksef_config
- Specjaliści: tylko własne nieprzypisane + własne przypisane
- Przypisane faktury: widoczne dla odpowiednich działów';

-- ============================================================================
-- INVOICES: Pozwól na INSERT dla faktur z KSEF (przez Service Role)
-- ============================================================================

-- Ta polityka już istnieje, ale upewnijmy się że dopuszcza faktury z source='ksef'
-- Faktury z KSEF są dodawane przez SERVICE_ROLE (funkcja transfer-ksef-invoice)
-- więc nie potrzebujemy dodatkowej polityki INSERT - SERVICE_ROLE omija RLS

-- Jednak dodajmy politykę pozwalającą kierownikom/dyrektorom na tworzenie faktur
-- dla przypadków gdy będą chcieli ręcznie dodać fakturę

DROP POLICY IF EXISTS "Managers and directors can create invoices for department" ON invoices;
CREATE POLICY "Managers and directors can create invoices for department"
    ON invoices FOR INSERT
    TO authenticated
    WITH CHECK (
        -- Kierownik może dodać fakturę do swojego działu
        (
            (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
            AND department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        )
        OR
        -- Dyrektor może dodać fakturę do działów którymi zarządza
        (
            (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
            AND department_id IN (
                SELECT id FROM departments 
                WHERE director_id = auth.uid()
            )
        )
    );

COMMENT ON POLICY "Managers and directors can create invoices for department" ON invoices IS
'Pozwala kierownikom i dyrektorom na tworzenie faktur dla swoich działów.
Używane gdy faktury są przenoszone z KSEF lub tworzone ręcznie.';

-- ============================================================================
-- TEST: Sprawdź widoczność faktur KSEF dla różnych ról
-- ============================================================================

CREATE OR REPLACE FUNCTION test_ksef_visibility(p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb AS $$
DECLARE
    v_profile record;
    v_unassigned_count integer;
    v_assigned_count integer;
    v_result jsonb;
BEGIN
    -- Pobierz profil użytkownika
    SELECT 
        id, full_name, email, role, is_admin, can_access_ksef_config
    INTO v_profile
    FROM profiles
    WHERE id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'error', 'User not found',
            'user_id', p_user_id
        );
    END IF;
    
    -- Policz nieprzypisane faktury które użytkownik widzi
    SELECT COUNT(*)
    INTO v_unassigned_count
    FROM ksef_invoices
    WHERE transferred_to_department_id IS NULL
      AND transferred_to_invoice_id IS NULL
      AND (
          v_profile.is_admin = true
          OR v_profile.role = 'CEO'
          OR v_profile.can_access_ksef_config = true
          OR v_profile.role IN ('Dyrektor', 'Kierownik')
          OR (v_profile.role = 'Specjalista' AND fetched_by = p_user_id)
      );
    
    -- Policz przypisane faktury które użytkownik widzi
    SELECT COUNT(*)
    INTO v_assigned_count
    FROM ksef_invoices
    WHERE (transferred_to_department_id IS NOT NULL OR transferred_to_invoice_id IS NOT NULL)
      AND (
          v_profile.is_admin = true
          OR v_profile.role = 'CEO'
          OR fetched_by = p_user_id
          OR (
              v_profile.role = 'Dyrektor'
              AND transferred_to_department_id IN (
                  SELECT id FROM departments WHERE director_id = p_user_id
              )
          )
          OR (
              v_profile.role = 'Kierownik'
              AND transferred_to_department_id = v_profile.department_id
          )
      );
    
    -- Zbuduj wynik
    v_result := jsonb_build_object(
        'user_id', v_profile.id,
        'full_name', v_profile.full_name,
        'email', v_profile.email,
        'role', v_profile.role,
        'is_admin', v_profile.is_admin,
        'can_access_ksef_config', v_profile.can_access_ksef_config,
        'ksef_invoices', jsonb_build_object(
            'unassigned_visible', v_unassigned_count,
            'assigned_visible', v_assigned_count,
            'total_visible', v_unassigned_count + v_assigned_count,
            'shared_unassigned', v_profile.role IN ('Dyrektor', 'Kierownik') 
                                 OR v_profile.can_access_ksef_config = true
                                 OR v_profile.is_admin = true
                                 OR v_profile.role = 'CEO'
        )
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION test_ksef_visibility IS
'Testuje widoczność faktur KSEF dla użytkownika.
Użycie: SELECT test_ksef_visibility() - dla bieżącego użytkownika
        SELECT test_ksef_visibility(''user-uuid'') - dla konkretnego użytkownika';
