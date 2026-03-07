/*
  # Add purchase_request_comments table

  ## Summary
  Creates a chat-style comments system for purchase requests, allowing all participants
  (submitter, approvers, admins) to discuss a request in a threaded conversation.

  ## New Tables
  - `purchase_request_comments`
    - `id` (uuid, PK)
    - `purchase_request_id` (uuid, FK → purchase_requests)
    - `user_id` (uuid, FK → profiles)
    - `content` (text) - comment body
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - SELECT: authenticated users who can see the purchase request (owner + approvers + admins)
  - INSERT: any authenticated user (they will only be able to insert on requests they can read)
  - DELETE: only the comment author can delete their own comments
*/

CREATE TABLE IF NOT EXISTS purchase_request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 2000),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prc_request_id ON purchase_request_comments(purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_prc_user_id ON purchase_request_comments(user_id);

ALTER TABLE purchase_request_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view comments on accessible requests"
  ON purchase_request_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_id
        AND (
          pr.user_id = auth.uid()
          OR pr.current_approver_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND (p.is_admin = true OR p.role IN ('Kierownik', 'Dyrektor'))
          )
        )
    )
  );

CREATE POLICY "Authenticated users can insert comments on accessible requests"
  ON purchase_request_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_id
        AND (
          pr.user_id = auth.uid()
          OR pr.current_approver_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
              AND (p.is_admin = true OR p.role IN ('Kierownik', 'Dyrektor'))
          )
        )
    )
  );

CREATE POLICY "Users can delete own comments"
  ON purchase_request_comments FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
