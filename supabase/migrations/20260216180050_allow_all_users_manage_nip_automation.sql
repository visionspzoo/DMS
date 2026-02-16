/*
  # Zezwól wszystkim użytkownikom zarządzać automatyzacjami NIP

  1. Problem
    - Obecnie tylko administratorzy mogą tworzyć i zarządzać regułami automatyzacji NIP
    - Użytkownicy nie mogą tworzyć własnych reguł automatyzacji dla faktur

  2. Rozwiązanie
    - Zezwól wszystkim uwierzytelnionym użytkownikom na tworzenie i zarządzanie własnymi regułami
    - Użytkownicy mogą edytować i usuwać tylko swoje własne reguły
    - Administratorzy mogą zarządzać wszystkimi regułami
    - Wszyscy mogą czytać aktywne reguły

  3. Zmiany
    - Zaktualizowane polityki RLS dla nip_automation_rules
    - Zaktualizowane polityki RLS dla nip_automation_rule_tags
    - Użytkownicy mogą czytać, tworzyć, edytować i usuwać swoje reguły
*/

-- Usuń stare polityki dla nip_automation_rules
DROP POLICY IF EXISTS "Authenticated users can read active automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Admins can insert automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Admins can update automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Admins can delete automation rules" ON nip_automation_rules;

-- Nowe polityki - wszyscy mogą czytać aktywne reguły
CREATE POLICY "Users can read active automation rules"
  ON nip_automation_rules FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Wszyscy użytkownicy mogą tworzyć reguły
CREATE POLICY "Users can create automation rules"
  ON nip_automation_rules FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Użytkownicy mogą edytować swoje reguły, admini wszystkie
CREATE POLICY "Users can update own automation rules"
  ON nip_automation_rules FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid() 
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    created_by = auth.uid() 
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Użytkownicy mogą usuwać swoje reguły, admini wszystkie
CREATE POLICY "Users can delete own automation rules"
  ON nip_automation_rules FOR DELETE
  TO authenticated
  USING (
    created_by = auth.uid() 
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Usuń stare polityki dla nip_automation_rule_tags
DROP POLICY IF EXISTS "Authenticated users can read automation rule tags" ON nip_automation_rule_tags;
DROP POLICY IF EXISTS "Admins can insert automation rule tags" ON nip_automation_rule_tags;
DROP POLICY IF EXISTS "Admins can delete automation rule tags" ON nip_automation_rule_tags;

-- Nowe polityki dla tagów - wszyscy mogą czytać tagi aktywnych reguł
CREATE POLICY "Users can read automation rule tags"
  ON nip_automation_rule_tags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nip_automation_rules nar
      WHERE nar.id = nip_automation_rule_tags.rule_id
      AND nar.is_active = true
    )
  );

-- Użytkownicy mogą dodawać tagi do swoich reguł, admini do wszystkich
CREATE POLICY "Users can create tags for own rules"
  ON nip_automation_rule_tags FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM nip_automation_rules
      WHERE id = rule_id 
      AND (
        created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      )
    )
  );

-- Użytkownicy mogą usuwać tagi ze swoich reguł, admini ze wszystkich
CREATE POLICY "Users can delete tags from own rules"
  ON nip_automation_rule_tags FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nip_automation_rules
      WHERE id = rule_id 
      AND (
        created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      )
    )
  );
