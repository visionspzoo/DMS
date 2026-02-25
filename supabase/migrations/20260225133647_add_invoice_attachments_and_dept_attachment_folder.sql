/*
  # Invoice Attachments System

  ## Summary
  Adds support for file attachments on invoices, uploaded to Google Drive.

  ## Changes

  ### Modified Tables
  - `departments`
    - Added `google_drive_attachments_folder_id` (text, nullable) - folder ID for department attachments

  ### New Tables
  - `invoice_attachments`
    - `id` (uuid, PK)
    - `invoice_id` (uuid, FK -> invoices) - associated invoice
    - `uploaded_by` (uuid, FK -> profiles) - user who uploaded
    - `file_name` (text) - original file name
    - `google_drive_file_id` (text) - Google Drive file ID
    - `google_drive_web_view_link` (text) - public view URL
    - `google_drive_folder_id` (text) - folder containing the file
    - `mime_type` (text) - file MIME type
    - `file_size` (bigint) - file size in bytes
    - `created_at` (timestamptz)

  ## Security
  - RLS enabled on `invoice_attachments`
  - Authenticated users who can view the invoice can view its attachments
  - Only uploader or admin can delete attachment records
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'google_drive_attachments_folder_id'
  ) THEN
    ALTER TABLE departments ADD COLUMN google_drive_attachments_folder_id text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoice_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES profiles(id),
  file_name text NOT NULL,
  google_drive_file_id text NOT NULL,
  google_drive_web_view_link text NOT NULL,
  google_drive_folder_id text,
  mime_type text,
  file_size bigint,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE invoice_attachments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_invoice_attachments_invoice_id ON invoice_attachments(invoice_id);

CREATE POLICY "Authenticated users can view attachments for accessible invoices"
  ON invoice_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id = invoice_attachments.invoice_id
    )
  );

CREATE POLICY "Authenticated users can insert attachments"
  ON invoice_attachments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Uploader or admin can delete attachments"
  ON invoice_attachments FOR DELETE
  TO authenticated
  USING (
    auth.uid() = uploaded_by OR
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );
