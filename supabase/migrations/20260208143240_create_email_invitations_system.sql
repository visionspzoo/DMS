/*
  # Email Invitations System

  1. New Tables
    - `email_templates`
      - `id` (uuid, primary key)
      - `name` (text) - Template name/identifier
      - `subject` (text) - Email subject
      - `body` (text) - Email body with placeholders
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `user_invitations`
      - `id` (uuid, primary key)
      - `email` (text) - Invited user email
      - `invited_by` (uuid) - User who sent invitation
      - `role` (text) - Assigned role
      - `department_id` (uuid, nullable) - Assigned department
      - `status` (text) - pending, accepted, expired
      - `invitation_token` (text) - Unique invitation token
      - `expires_at` (timestamptz) - Expiration date
      - `created_at` (timestamptz)
      - `accepted_at` (timestamptz, nullable)

  2. Security
    - Enable RLS on both tables
    - Only admins can manage templates
    - Admins and directors can send invitations
    - Users can view their own sent invitations
*/

-- Email Templates Table
CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all templates"
  ON email_templates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can insert templates"
  ON email_templates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update templates"
  ON email_templates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- User Invitations Table
CREATE TABLE IF NOT EXISTS user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  invited_by uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('specialist', 'manager', 'director', 'ceo')),
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  invitation_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  created_at timestamptz DEFAULT now(),
  accepted_at timestamptz
);

ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and directors can view invitations"
  ON user_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.is_admin = true OR profiles.role = 'director')
    )
    OR invited_by = auth.uid()
  );

CREATE POLICY "Admins and directors can send invitations"
  ON user_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.is_admin = true OR profiles.role = 'director')
    )
  );

CREATE POLICY "Admins and directors can update invitations"
  ON user_invitations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.is_admin = true OR profiles.role = 'director')
    )
    OR invited_by = auth.uid()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.is_admin = true OR profiles.role = 'director')
    )
    OR invited_by = auth.uid()
  );

-- Insert default invitation email template
INSERT INTO email_templates (name, subject, body)
VALUES (
  'user_invitation',
  'Zaproszenie do systemu DMS - {{company_name}}',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; }
    .info-box { background: white; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; margin-top: 30px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Witamy w systemie DMS!</h1>
    </div>
    <div class="content">
      <p>Witaj,</p>
      
      <p><strong>{{invited_by_name}}</strong> zaprasza Cię do dołączenia do systemu zarządzania dokumentami (DMS) w firmie <strong>{{company_name}}</strong>.</p>
      
      <div class="info-box">
        <strong>Szczegóły Twojego konta:</strong><br>
        Email: <strong>{{email}}</strong><br>
        Rola: <strong>{{role}}</strong><br>
        {{#department}}Dział: <strong>{{department}}</strong><br>{{/department}}
      </div>
      
      <p>Aby aktywować swoje konto, kliknij poniższy przycisk:</p>
      
      <center>
        <a href="{{invitation_link}}" class="button">Aktywuj konto</a>
      </center>
      
      <p style="color: #666; font-size: 14px;">Lub skopiuj i wklej poniższy link do przeglądarki:<br>
      <code style="background: #e0e0e0; padding: 5px; display: inline-block; margin-top: 5px;">{{invitation_link}}</code></p>
      
      <p><strong>Ważne informacje:</strong></p>
      <ul>
        <li>To zaproszenie wygasa za <strong>7 dni</strong></li>
        <li>Po aktywacji będziesz mógł ustawić własne hasło</li>
        <li>System służy do zarządzania fakturami, umowami i dokumentami</li>
      </ul>
      
      <div class="footer">
        <p>Jeśli nie oczekiwałeś tego zaproszenia, zignoruj tę wiadomość.</p>
        <p>&copy; 2025 {{company_name}} - System DMS</p>
      </div>
    </div>
  </div>
</body>
</html>'
) ON CONFLICT (name) DO NOTHING;

-- Function to automatically expire invitations
CREATE OR REPLACE FUNCTION expire_old_invitations()
RETURNS void AS $$
BEGIN
  UPDATE user_invitations
  SET status = 'expired'
  WHERE status = 'pending'
  AND expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(invitation_token);
CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status ON user_invitations(status);
