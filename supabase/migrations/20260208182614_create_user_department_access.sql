/*
  # Utworzenie systemu uprawnień dostępu do działów

  ## Zmiany
  
  1. Nowa tabela `user_department_access`
     - `id` (uuid, primary key)
     - `user_id` (uuid, foreign key do profiles) - użytkownik otrzymujący uprawnienie
     - `department_id` (uuid, foreign key do departments) - dział do którego dajemy dostęp
     - `access_type` (text) - typ dostępu: 'view' (tylko podgląd) lub 'workflow' (dodawanie do obiegu)
     - `granted_by` (uuid, foreign key do profiles) - kto nadał uprawnienie
     - `created_at` (timestamp)
  
  2. Aktualizacja polityk RLS dla faktur
     - Usunięcie automatycznego dostępu administratora do wszystkich faktur
     - Dodanie sprawdzania uprawnień z user_department_access
     - Uwzględnienie zarówno uprawnień 'view' jak i 'workflow'
  
  3. Bezpieczeństwo
     - Tylko administratorzy mogą zarządzać uprawnieniami dostępu
     - Uprawnienia są sprawdzane przy każdym dostępie do faktur
     - Uprawnienia nie wpływają na standardowy obieg dokumentów
  
  ## Uwagi
  
  - Flaga is_admin nie daje już automatycznego dostępu do wszystkich faktur
  - Użytkownicy z uprawnieniem 'view' widzą faktury ale nie mogą ich zatwierdzać
  - Użytkownicy z uprawnieniem 'workflow' mogą dodawać faktury do obiegu danego działu
  - Standardowo użytkownicy mogą tylko dodawać faktury do swojego działu
*/

-- Utwórz tabelę user_department_access
CREATE TABLE IF NOT EXISTS user_department_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  access_type text NOT NULL CHECK (access_type IN ('view', 'workflow')),
  granted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, department_id, access_type)
);

-- Włącz RLS
ALTER TABLE user_department_access ENABLE ROW LEVEL SECURITY;

-- Polityki dla user_department_access
CREATE POLICY "Admins can view all access grants"
  ON user_department_access FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can create access grants"
  ON user_department_access FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can delete access grants"
  ON user_department_access FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Usuń starą politykę która dawała adminowi dostęp do wszystkich faktur
DROP POLICY IF EXISTS "Admins can view all invoices" ON invoices;

-- Utwórz nową politykę dla adminów (tylko faktury z ich działu lub działy do których mają dostęp)
CREATE POLICY "Admins can view invoices from accessible departments"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
      AND (
        -- Faktury z własnego działu
        profiles.department_id = invoices.department_id
        OR
        -- Faktury z działów do których mają uprawnienia view lub workflow
        EXISTS (
          SELECT 1 FROM user_department_access
          WHERE user_department_access.user_id = auth.uid()
          AND user_department_access.department_id = invoices.department_id
          AND user_department_access.access_type IN ('view', 'workflow')
        )
      )
    )
  );

-- Zaktualizuj istniejącą politykę dla wszystkich użytkowników żeby uwzględniała uprawnienia
DROP POLICY IF EXISTS "Users can view invoices from their department" ON invoices;

CREATE POLICY "Users can view invoices from their department or granted access"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    -- CEO widzi wszystko
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'CEO'
    )
    OR
    -- Użytkownik widzi faktury ze swojego działu
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.department_id = invoices.department_id
    )
    OR
    -- Użytkownik widzi faktury z działów do których ma uprawnienia view lub workflow
    EXISTS (
      SELECT 1 FROM user_department_access
      WHERE user_department_access.user_id = auth.uid()
      AND user_department_access.department_id = invoices.department_id
      AND user_department_access.access_type IN ('view', 'workflow')
    )
    OR
    -- Dyrektor widzi faktury z działów podległych
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN departments d ON d.id = invoices.department_id
      WHERE p.id = auth.uid()
      AND p.role = 'Dyrektor'
      AND (d.parent_department_id = p.department_id OR d.id = p.department_id)
    )
    OR
    -- Użytkownik który uploadował (dla draft)
    (invoices.uploaded_by = auth.uid() AND invoices.status = 'draft')
  );

-- Dodaj indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_user_department_access_user_id ON user_department_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_department_access_department_id ON user_department_access(department_id);
CREATE INDEX IF NOT EXISTS idx_user_department_access_type ON user_department_access(access_type);

COMMENT ON TABLE user_department_access IS 'Przechowuje uprawnienia użytkowników do działów - view (tylko podgląd) lub workflow (dodawanie do obiegu)';
COMMENT ON COLUMN user_department_access.access_type IS 'Typ dostępu: view - tylko podgląd faktur, workflow - możliwość dodawania faktur do obiegu działu';
