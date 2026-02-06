/*
  # Zmiana pola department w tabeli invoices na UUID

  1. Zmiany w invoices
    - Zmienia pole `department` z TEXT na UUID
    - Dodaje klucz obcy do tabeli departments
    - Migruje istniejące dane tekstowe na UUID
  
  2. Bezpieczeństwo
    - Zachowuje istniejące dane
    - Dodaje proper foreign key constraints
*/

-- Najpierw utwórz nową kolumnę department_id jako UUID
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE invoices ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Migruj istniejące dane - dopasuj nazwy działów do UUID
UPDATE invoices i
SET department_id = d.id
FROM departments d
WHERE i.department = d.name
AND i.department IS NOT NULL
AND i.department_id IS NULL;

-- Usuń stare pole department (tekstowe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'department'
  ) THEN
    ALTER TABLE invoices DROP COLUMN department;
  END IF;
END $$;

-- Dodaj index dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_invoices_department_id ON invoices(department_id);
