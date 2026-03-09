/*
  # Fix handle_simple_invoice_approval - replace non-existent column

  ## Problem
  The `handle_simple_invoice_approval` trigger function references
  `director_approval_limit` column on the `profiles` table, which does not exist.
  Directors actually have `monthly_invoice_limit` and `single_invoice_limit` columns.

  ## Changes
  - Rewrites `handle_simple_invoice_approval` to use `monthly_invoice_limit`
    and `single_invoice_limit` instead of `director_approval_limit`
  - Logic: if invoice amount exceeds single_invoice_limit OR monthly total
    exceeds monthly_invoice_limit → forward to CEO
  - If no limits set, pass through (frontend handles limit check via RPC)
*/

CREATE OR REPLACE FUNCTION handle_simple_invoice_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin boolean;
  v_approver_role text;
  v_single_limit numeric;
  v_monthly_limit numeric;
  v_current_month_total numeric;
  v_ceo_id uuid;
BEGIN
  SELECT is_admin, role
  INTO v_is_admin, v_approver_role
  FROM profiles
  WHERE id = auth.uid();

  IF v_is_admin = true OR v_approver_role = 'CEO' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
    IF v_approver_role = 'Dyrektor' THEN
      SELECT monthly_invoice_limit, single_invoice_limit
      INTO v_monthly_limit, v_single_limit
      FROM profiles
      WHERE id = auth.uid();

      IF v_single_limit IS NOT NULL AND COALESCE(NEW.pln_gross_amount, NEW.gross_amount, 0) > v_single_limit THEN
        SELECT id INTO v_ceo_id FROM profiles WHERE role = 'CEO' LIMIT 1;

        IF v_ceo_id IS NOT NULL THEN
          NEW.status := 'waiting';
          NEW.current_approver_id := v_ceo_id;

          INSERT INTO audit_logs (invoice_id, user_id, action, description)
          VALUES (
            NEW.id,
            auth.uid(),
            'forwarded_to_ceo',
            format('Faktura przekazana do CEO - przekroczono limit pojedynczej faktury dyrektora (%s PLN > %s PLN)',
              COALESCE(NEW.pln_gross_amount, NEW.gross_amount, 0)::text, v_single_limit::text)
          );

          RETURN NEW;
        END IF;
      END IF;

      IF v_monthly_limit IS NOT NULL THEN
        SELECT COALESCE(SUM(COALESCE(pln_gross_amount, gross_amount, 0)), 0)
        INTO v_current_month_total
        FROM invoices
        WHERE status IN ('accepted', 'paid')
          AND department_id IN (SELECT id FROM departments WHERE director_id = auth.uid())
          AND EXTRACT(MONTH FROM COALESCE(issue_date, created_at)) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM COALESCE(issue_date, created_at)) = EXTRACT(YEAR FROM CURRENT_DATE)
          AND id != NEW.id;

        IF (v_current_month_total + COALESCE(NEW.pln_gross_amount, NEW.gross_amount, 0)) > v_monthly_limit THEN
          SELECT id INTO v_ceo_id FROM profiles WHERE role = 'CEO' LIMIT 1;

          IF v_ceo_id IS NOT NULL THEN
            NEW.status := 'waiting';
            NEW.current_approver_id := v_ceo_id;

            INSERT INTO audit_logs (invoice_id, user_id, action, description)
            VALUES (
              NEW.id,
              auth.uid(),
              'forwarded_to_ceo',
              format('Faktura przekazana do CEO - przekroczono limit miesięczny dyrektora (%s PLN + %s PLN > %s PLN)',
                v_current_month_total::text,
                COALESCE(NEW.pln_gross_amount, NEW.gross_amount, 0)::text,
                v_monthly_limit::text)
            );

            RETURN NEW;
          END IF;
        END IF;
      END IF;

      NEW.current_approver_id := NULL;
      NEW.approved_by_director_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
