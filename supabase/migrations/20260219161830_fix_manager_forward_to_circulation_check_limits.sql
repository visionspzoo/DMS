/*
  # Naprawa: Kierownik wysyła fakturę do obiegu - sprawdzanie limitów działu

  ## Problem
  Gdy Kierownik wysyłał fakturę z draft → waiting, funkcja handle_invoice_approval
  sprawdzała rolę z pola uploaded_by (a nie auth.uid()). Wskutek tego:
  - Blok dla Dyrektora (draft→waiting) nigdy nie odpala się dla Kierownika
  - Faktura zawsze trafia do waiting u Dyrektora, nawet gdy mieści się w limitach

  ## Rozwiązanie
  W bloku draft → waiting dodano obsługę roli Kierownik:
  - Sprawdzamy limity działu (check_department_limits)
  - Jeśli mieści się w limitach → auto-akceptacja (status = accepted)
  - Jeśli przekracza limity → faktura trafia do Dyrektora (status = waiting)

  ## Zmiany
  - handle_invoice_approval: blok draft→waiting teraz obsługuje zarówno Dyrektora jak i Kierownika
  - Poprawiono identyfikację osoby wysyłającej: używamy auth.uid() zamiast uploaded_by
*/

CREATE OR REPLACE FUNCTION handle_invoice_approval()
RETURNS trigger AS $$
DECLARE
    v_is_admin boolean;
    v_user_role text;
    v_approver_role text;
    v_approver_dept_id uuid;
    v_limits_check jsonb;
    v_director_id uuid;
    v_dept_name text;
    v_ceo_id uuid;
    v_invoice_amount numeric;
    v_sender_id uuid;
    v_sender_role text;
BEGIN
    -- Sprawdź czy użytkownik to admin lub CEO
    SELECT is_admin, role
    INTO v_is_admin, v_user_role
    FROM profiles
    WHERE id = auth.uid();

    -- ADMINI I CEO POMIJANI - mogą wszystko robić bez ograniczeń
    IF v_is_admin = true OR v_user_role = 'CEO' THEN
        RETURN NEW;
    END IF;

    -- ==========================================
    -- OBSŁUGA: zmiana draft → waiting
    -- ==========================================
    IF NEW.status = 'waiting' AND OLD.status = 'draft' THEN
        -- Użyj auth.uid() jako osoby wysyłającej fakturę
        v_sender_id := auth.uid();

        SELECT role, department_id
        INTO v_sender_role, v_approver_dept_id
        FROM profiles
        WHERE id = v_sender_id;

        -- Pobierz kwotę faktury w PLN
        v_invoice_amount := COALESCE(NEW.pln_gross_amount, NEW.gross_amount);

        -- ----------------------------------------
        -- Dyrektor wysyła fakturę
        -- ----------------------------------------
        IF v_sender_role = 'Dyrektor' THEN
            v_limits_check := check_director_limits(
                v_sender_id,
                v_invoice_amount,
                COALESCE(NEW.issue_date, NEW.created_at::date),
                NEW.id
            );

            IF (v_limits_check->>'within_limits')::boolean = true THEN
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                NEW.approved_by_director_at := now();

                INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
                VALUES (
                    NEW.id, v_sender_id, 'approved_by_director_within_limits',
                    jsonb_build_object('status', 'draft'),
                    jsonb_build_object('status', 'accepted', 'limits_check', v_limits_check),
                    format('Faktura zatwierdzona przez Dyrektora w ramach limitów (%s PLN)', v_invoice_amount::text)
                );

                RETURN NEW;
            END IF;

            -- Przekracza limity - przekaż do CEO
            SELECT id INTO v_ceo_id FROM profiles WHERE role = 'CEO' LIMIT 1;

            IF v_ceo_id IS NOT NULL THEN
                NEW.current_approver_id := v_ceo_id;

                INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
                VALUES (
                    NEW.id, v_sender_id, 'forwarded_to_ceo',
                    jsonb_build_object('status', 'draft'),
                    jsonb_build_object('status', 'waiting', 'current_approver_id', v_ceo_id, 'limits_check', v_limits_check),
                    format('Faktura przekazana do CEO - przekroczono limity dyrektora (%s PLN)', v_invoice_amount::text)
                );
            ELSE
                -- Brak CEO - akceptuj
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                NEW.approved_by_director_at := now();

                INSERT INTO audit_logs (invoice_id, user_id, action, description)
                VALUES (
                    NEW.id, v_sender_id, 'approved_by_director_no_ceo',
                    format('Faktura zaakceptowana przez Dyrektora (brak CEO w systemie) - %s PLN', v_invoice_amount::text)
                );
            END IF;

        -- ----------------------------------------
        -- Kierownik wysyła fakturę
        -- ----------------------------------------
        ELSIF v_sender_role = 'Kierownik' THEN
            -- Sprawdź limity działu
            v_limits_check := check_department_limits(
                NEW.department_id,
                v_invoice_amount,
                COALESCE(NEW.issue_date, NEW.created_at),
                NEW.id
            );

            IF (v_limits_check->>'within_limits')::boolean = true THEN
                -- Mieści się w limitach - auto-akceptacja
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                NEW.approved_by_manager_at := now();

                INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                VALUES (
                    NEW.id, v_sender_id, 'auto_accepted_within_limits',
                    jsonb_build_object('status', 'accepted', 'message', v_limits_check->>'message'),
                    format('Faktura automatycznie zaakceptowana przez Kierownika - mieści się w limitach działu (%s PLN)', v_invoice_amount::text)
                );
            ELSE
                -- Przekracza limity - przekaż do Dyrektora
                SELECT director_id, name INTO v_director_id, v_dept_name
                FROM departments
                WHERE id = NEW.department_id;

                IF v_director_id IS NULL THEN
                    SELECT p.id INTO v_director_id
                    FROM profiles p
                    WHERE p.department_id = NEW.department_id AND p.role = 'Dyrektor'
                    LIMIT 1;
                END IF;

                IF v_director_id IS NOT NULL THEN
                    NEW.current_approver_id := v_director_id;

                    INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
                    VALUES (
                        NEW.id, v_sender_id, 'forwarded_to_director',
                        jsonb_build_object('status', 'draft'),
                        jsonb_build_object('status', 'waiting', 'current_approver_id', v_director_id,
                            'reason', v_limits_check->>'reason', 'message', v_limits_check->>'message'),
                        format('Faktura przekazana do Dyrektora - %s', v_limits_check->>'message')
                    );
                ELSE
                    -- Brak Dyrektora - akceptuj mimo przekroczenia
                    NEW.status := 'accepted';
                    NEW.current_approver_id := NULL;
                    NEW.approved_by_manager_at := now();

                    INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                    VALUES (
                        NEW.id, v_sender_id, 'accepted_without_director',
                        jsonb_build_object('reason', v_limits_check->>'reason', 'message', v_limits_check->>'message'),
                        format('Faktura zaakceptowana przez Kierownika mimo przekroczenia limitów (brak Dyrektora) - %s', v_limits_check->>'message')
                    );
                END IF;
            END IF;
        END IF;
    END IF;

    -- ==========================================
    -- OBSŁUGA: Akceptacja waiting → accepted
    -- ==========================================
    IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
        -- Pobierz ID i rolę aktualnego approver'a (poprzedni current_approver_id)
        v_director_id := OLD.current_approver_id;

        SELECT role
        INTO v_approver_role
        FROM profiles
        WHERE id = v_director_id;

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

            IF (v_limits_check->>'within_limits')::boolean = false THEN
                -- Znajdź Dyrektora działu
                SELECT director_id, name INTO v_director_id, v_dept_name
                FROM departments
                WHERE id = NEW.department_id;

                IF v_director_id IS NULL THEN
                    SELECT p.id INTO v_director_id
                    FROM profiles p
                    WHERE p.department_id = NEW.department_id AND p.role = 'Dyrektor'
                    LIMIT 1;
                END IF;

                IF v_director_id IS NOT NULL THEN
                    NEW.status := 'waiting';
                    NEW.current_approver_id := v_director_id;

                    INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
                    VALUES (
                        NEW.id, auth.uid(), 'forwarded_to_director',
                        jsonb_build_object('status', 'waiting', 'current_approver_id', OLD.current_approver_id),
                        jsonb_build_object('status', 'waiting', 'current_approver_id', v_director_id,
                            'reason', v_limits_check->>'reason', 'message', v_limits_check->>'message'),
                        format('Faktura przekazana do Dyrektora - %s', v_limits_check->>'message')
                    );
                ELSE
                    NEW.current_approver_id := NULL;

                    INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                    VALUES (
                        NEW.id, auth.uid(), 'accepted_without_director',
                        jsonb_build_object('reason', v_limits_check->>'reason', 'message', v_limits_check->>'message'),
                        format('Faktura zaakceptowana przez Kierownika mimo przekroczenia limitów (brak Dyrektora) - %s', v_limits_check->>'message')
                    );
                END IF;
            ELSE
                NEW.current_approver_id := NULL;

                INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                VALUES (
                    NEW.id, auth.uid(), 'auto_accepted_within_limits',
                    jsonb_build_object('status', 'accepted', 'message', v_limits_check->>'message'),
                    'Faktura automatycznie zaakceptowana - mieści się w limitach działu'
                );
            END IF;

        -- Dyrektor akceptuje fakturę (z poziomu waiting)
        ELSIF v_approver_role = 'Dyrektor' THEN
            NEW.approved_by_director_at := now();
            NEW.current_approver_id := NULL;

            INSERT INTO audit_logs (invoice_id, user_id, action, description)
            VALUES (
                NEW.id, v_director_id, 'approved_by_director',
                'Faktura zaakceptowana przez Dyrektora'
            );

        -- CEO akceptuje
        ELSIF v_approver_role = 'CEO' THEN
            NEW.current_approver_id := NULL;

            INSERT INTO audit_logs (invoice_id, user_id, action, description)
            VALUES (
                NEW.id, v_director_id, 'approved_by_ceo',
                'Faktura zaakceptowana przez CEO'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION handle_invoice_approval IS
'Obsługuje workflow akceptacji faktury:
- Kierownik: draft → waiting → sprawdza limity działu → auto-accept lub do Dyrektora
- Dyrektor: draft → waiting → sprawdza limity dyrektora → auto-accept lub do CEO
- Kierownik: waiting → accepted → sprawdza limity działu → auto-accept lub do Dyrektora
- Dyrektor: waiting → accepted → finalizuje akceptację
- CEO: waiting → accepted → finalizuje akceptację
- Admini i CEO są całkowicie pomijani';
