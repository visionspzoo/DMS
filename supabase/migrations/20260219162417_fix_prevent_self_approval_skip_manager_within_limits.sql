/*
  # Naprawa prevent_self_approval - Pomiń Kierowników mieszczących się w limitach

  ## Problem
  Funkcja prevent_self_approval() odpalała się dla Kierowników wysyłających
  własne faktury do obiegu (draft → waiting), mimo że handle_invoice_approval()
  (trigger z0) już ustawił status na 'accepted' jeśli faktura mieściła się w limitach.

  WHEN clause triggerów PostgreSQL jest ewaluowany PRZED wywołaniem funkcji,
  na wartościach NEW zmodyfikowanych przez poprzednie triggery - ale w praktyce
  dla triggerów w tej samej partii, WHEN jest sprawdzany na wartościach
  PRZED modyfikacją przez poprzedni trigger z0.

  W rezultacie z1 (prevent_self_approval) odpalał się nawet gdy z0 już zmienił
  status na 'accepted', nadpisując tę zmianę i przekazując fakturę do Dyrektora.

  ## Rozwiązanie
  W prevent_self_approval dodano obsługę Kierownika:
  - Jeśli Kierownik wysyła własną fakturę I faktura mieści się w limitach działu
    → pomiń (handle_invoice_approval obsłuży auto-akceptację)
  - Jeśli Kierownik wysyła własną fakturę I faktura PRZEKRACZA limity
    → przekaż do Dyrektora (standardowe zachowanie)

  ## Zmiany
  - prevent_self_approval: dodano check limitów dla Kierownika przed przekazaniem
*/

CREATE OR REPLACE FUNCTION prevent_self_approval()
RETURNS trigger AS $$
DECLARE
    v_is_admin boolean;
    v_user_role text;
    v_original_uploader_role text;
    v_department_id uuid;
    v_next_approver_id uuid;
    v_ceo_id uuid;
    v_limits_check jsonb;
    v_invoice_amount numeric;
BEGIN
    SELECT is_admin, role
    INTO v_is_admin, v_user_role
    FROM profiles
    WHERE id = auth.uid();

    IF v_is_admin = true OR v_user_role = 'CEO' THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'waiting' AND OLD.status != 'waiting' THEN
        IF NEW.current_approver_id = NEW.original_uploader_id THEN
            SELECT role, department_id
            INTO v_original_uploader_role, v_department_id
            FROM profiles
            WHERE id = NEW.original_uploader_id;

            IF v_original_uploader_role = 'Dyrektor' THEN
                RETURN NEW;
            END IF;

            SELECT id INTO v_ceo_id
            FROM profiles
            WHERE role = 'CEO'
            LIMIT 1;

            IF v_original_uploader_role = 'CEO' OR v_ceo_id = NEW.original_uploader_id THEN
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;

            ELSIF v_original_uploader_role = 'Kierownik' THEN
                v_invoice_amount := COALESCE(NEW.pln_gross_amount, NEW.gross_amount);

                v_limits_check := check_department_limits(
                    COALESCE(NEW.department_id, v_department_id),
                    v_invoice_amount,
                    COALESCE(NEW.issue_date, NEW.created_at),
                    NEW.id
                );

                IF (v_limits_check->>'within_limits')::boolean = true THEN
                    NEW.status := 'accepted';
                    NEW.current_approver_id := NULL;
                    NEW.approved_by_manager_at := now();

                    INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                    VALUES (
                        NEW.id, NEW.original_uploader_id, 'auto_accepted_within_limits',
                        jsonb_build_object('status', 'accepted', 'message', v_limits_check->>'message'),
                        format('Faktura automatycznie zaakceptowana przez Kierownika - mieści się w limitach działu (%s PLN)', v_invoice_amount::text)
                    );

                    RETURN NEW;
                ELSE
                    SELECT director_id INTO v_next_approver_id
                    FROM departments
                    WHERE id = COALESCE(NEW.department_id, v_department_id);

                    IF v_next_approver_id IS NULL THEN
                        SELECT id INTO v_next_approver_id
                        FROM profiles
                        WHERE department_id = COALESCE(NEW.department_id, v_department_id)
                        AND role = 'Dyrektor'
                        LIMIT 1;
                    END IF;

                    IF v_next_approver_id IS NULL THEN
                        v_next_approver_id := v_ceo_id;
                    END IF;

                    NEW.status := 'waiting';
                    NEW.current_approver_id := v_next_approver_id;

                    INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                    VALUES (
                        NEW.id, NEW.original_uploader_id, 'auto_reassigned',
                        jsonb_build_object(
                            'old_status', OLD.status,
                            'new_status', NEW.status,
                            'reason', 'self_approval_detected_exceeds_limits',
                            'uploader_role', v_original_uploader_role,
                            'old_approver_id', OLD.current_approver_id,
                            'new_approver_id', NEW.current_approver_id
                        ),
                        format('Faktura przekazana do Dyrektora - przekroczono limity działu (%s PLN)', v_invoice_amount::text)
                    );

                    RETURN NEW;
                END IF;

            ELSE
                v_next_approver_id := get_next_approver_in_department(
                    COALESCE(NEW.department_id, v_department_id),
                    v_original_uploader_role
                );

                NEW.status := 'waiting';
                NEW.current_approver_id := v_next_approver_id;

                INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                VALUES (
                    NEW.id, NEW.original_uploader_id, 'auto_reassigned',
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
                        CASE WHEN NEW.current_approver_id IS NULL THEN 'zatwierdzona' ELSE 'przekazana dalej' END)
                );
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION prevent_self_approval IS
'Zapobiega samo-zatwierdzaniu faktur.
- Kierownik w limitach → auto-akceptacja (status=accepted)
- Kierownik powyżej limitów → przekazanie do Dyrektora
- Dyrektor → pominięty (obsługuje handle_invoice_approval)
- CEO/Admin → pominięci';
