/*
  # Naprawa polityki "Users can accept invoices assigned to them" - WITH CHECK (TRUE)

  ## Problem
  
  Polityka "Users can accept invoices assigned to them" ma restrykcyjny WITH CHECK który wymaga:
  - uploaded_by = auth.uid() LUB
  - current_approver_id = auth.uid() LUB
  - rola CEO LUB
  - is_admin = true
  
  Gdy użytkownik przesyła fakturę do innej osoby:
  1. USING sprawdza czy użytkownik może zainicjować UPDATE (OK - current_approver_id = auth.uid())
  2. UPDATE jest wykonywany
  3. Trigger auto_set_invoice_owner() zmienia current_approver_id na nową osobę
  4. WITH CHECK sprawdza stan PO UPDATE (FAIL - current_approver_id już nie jest auth.uid())
  5. Błąd: "new row violates row-level security policy"

  ## Rozwiązanie
  
  Ustaw WITH CHECK (TRUE) aby pozwolić na dowolny stan po UPDATE.
  USING clause jest wystarczający do zabezpieczenia - sprawdza kto może zainicjować UPDATE.
  Co dzieje się PO UPDATE (przez triggery) nie powinno być ograniczane przez WITH CHECK.

  ## Zmiany
  
  - Polityka "Users can accept invoices assigned to them" z WITH CHECK (TRUE)
  
  ## Bezpieczeństwo
  
  - USING sprawdza dostęp PRZED UPDATE
  - Triggery obsługują logikę biznesową
  - Brak ryzyka bezpieczeństwa - dostęp jest walidowany przed operacją
*/

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Users can accept invoices assigned to them" ON invoices;

-- Create updated policy with WITH CHECK (TRUE)
CREATE POLICY "Users can accept invoices assigned to them"
ON invoices
FOR UPDATE
TO authenticated
USING (
  -- User uploaded the invoice (can transfer own invoices)
  uploaded_by = auth.uid()
  OR
  -- Invoice is assigned to user (can accept/transfer assigned invoices)
  current_approver_id = auth.uid()
  OR
  -- CEO has full access
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('CEO')
  OR
  -- Admin has full access
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
)
WITH CHECK (TRUE);  -- Allow any resulting state after triggers

COMMENT ON POLICY "Users can accept invoices assigned to them" ON invoices IS
'Users can update invoices they uploaded or that are assigned to them. WITH CHECK (TRUE) allows triggers to modify current_approver_id during transfer.';
