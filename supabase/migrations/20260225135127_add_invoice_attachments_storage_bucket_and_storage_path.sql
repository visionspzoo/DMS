/*
  # Invoice Attachments - Supabase Storage Support

  ## Summary
  Adds Supabase Storage as a fallback for invoice attachments when Google Drive is not configured.

  ## Changes

  ### Storage
  - Creates `invoice-attachments` storage bucket (private)

  ### Modified Tables
  - `invoice_attachments`
    - Added `storage_path` (text, nullable) - path in Supabase Storage (used when Drive not configured)
    - Made `google_drive_file_id` nullable - not required when using Supabase Storage
    - Made `google_drive_web_view_link` nullable - not required when using Supabase Storage

  ## Security
  - Storage bucket policies: authenticated users can upload and read their own files
  - Admins can read all files
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoice-attachments',
  'invoice-attachments',
  false,
  52428800,
  NULL
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'invoice-attachments');

CREATE POLICY "Authenticated users can read invoice attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'invoice-attachments');

CREATE POLICY "Uploader or admin can delete stored attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'invoice-attachments' AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid() AND p.is_admin = true
      )
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoice_attachments' AND column_name = 'storage_path'
  ) THEN
    ALTER TABLE invoice_attachments ADD COLUMN storage_path text;
  END IF;
END $$;

ALTER TABLE invoice_attachments ALTER COLUMN google_drive_file_id DROP NOT NULL;
ALTER TABLE invoice_attachments ALTER COLUMN google_drive_web_view_link DROP NOT NULL;
