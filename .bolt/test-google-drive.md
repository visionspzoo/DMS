# Testing Google Drive Integration

## Prerequisites

Ensure the following secrets are configured in Supabase Edge Functions:

1. Navigate to: https://supabase.com/dashboard → Your Project → Settings → Edge Functions → Secrets
2. Add these secrets:

```
GOOGLE_CLIENT_ID=590248404309-vko9d1jhbqhtvchsa9ucig557o9agk2q.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
GOOGLE_REFRESH_TOKEN=1//045QR8YaGYFZlCgYIARAAGAQSNwF-L9IrC59grOCd-4mYcFNIX1SHFD4qjOA4sAsU5PMaezAfYjycdjq7k7jGEEN1MPlTr7QzLAA
GOOGLE_DRIVE_FOLDER_ID=https://drive.google.com/drive/folders/1SkZx4YX2jOXfrythk9ObIv5VxlfHqZsE
```

3. If you need OpenAI for OCR, also add:
```
OPENAI_API_KEY=your-openai-api-key
```

## Storage Bucket Setup

1. Go to: https://supabase.com/dashboard → Your Project → Storage
2. Create a bucket named `documents` if it doesn't exist
3. Set the bucket to **Public** (for `publicUrl` to work) or configure signed URLs

## Testing the Flow

### 1. Upload an Invoice

1. Log in to the application
2. Click "Upload Invoice" or navigate to the upload page
3. Select a PDF file
4. Fill in the required fields (department, etc.)
5. Click "Upload"

### 2. Check Console for Errors

Open browser DevTools (F12) → Console tab

Look for:
- ✅ "Uploading to storage..." - Storage upload started
- ✅ "Saving to database..." - Database insert
- ✅ "Uploading to Google Drive..." - Google Drive function called
- ❌ Any red errors - troubleshoot these

### 3. Verify Google Drive

1. Open: https://drive.google.com/drive/folders/1SkZx4YX2jOXfrythk9ObIv5VxlfHqZsE
2. Check if the file appears in the correct department folder
3. Verify the file name matches the uploaded PDF

### 4. Check Database

In Supabase Dashboard → Table Editor → `invoices`:
- `file_url` should contain the Supabase storage URL
- `google_drive_id` should be populated with the Google Drive file ID
- `invoice_number`, `supplier_name`, etc. should be filled after OCR completes

### 5. View Invoice Details

1. Click on the uploaded invoice in the list
2. The PDF should display in an embedded viewer
3. Check that OCR extracted data is visible
4. Verify the "History" tab shows audit logs

## Troubleshooting

### Google Drive Upload Fails

**Check Browser Console:**
- Error 401: Refresh token expired → regenerate the refresh token
- Error 403: No permissions → check Google Drive folder sharing
- Error 404: Folder not found → verify GOOGLE_DRIVE_FOLDER_ID

**Check Edge Function Logs:**
```bash
# In Supabase Dashboard → Edge Functions → upload-to-google-drive → Logs
```

Look for:
- "Failed to get Google access token" - refresh token issue
- "Google Drive upload failed: 4xx" - permissions issue
- "Failed to fetch file from URL" - storage bucket not public

### PDF Not Showing in Preview

- Ensure the `documents` storage bucket is public
- Check if `file_url` in the database is accessible (paste URL in browser)
- Verify CORS settings in Supabase Storage

### OCR Not Working

- Check if `OPENAI_API_KEY` is set in Edge Functions secrets
- Verify the OCR function is deployed: `supabase/functions/process-invoice-ocr`
- Check Edge Function logs for OCR errors

## Expected Flow

```
1. User uploads PDF
   ↓
2. PDF saved to Supabase Storage (`documents` bucket)
   ↓
3. Invoice record created in database with file_url
   ↓
4. Google Drive Edge Function called
   - Extracts folder ID from URL
   - Refreshes Google access token (cached)
   - Creates department folder (if needed)
   - Uploads file to Google Drive
   - Updates database with google_drive_id
   ↓
5. OCR Edge Function called (if configured)
   - Downloads PDF from storage
   - Sends to OpenAI Vision API
   - Extracts invoice data
   - Updates database with extracted fields
   ↓
6. User sees invoice in list with all data
```

## Success Indicators

✅ File appears in Google Drive folder
✅ `google_drive_id` is populated in database
✅ PDF displays correctly in invoice details
✅ OCR extracted data is visible (invoice number, amounts, etc.)
✅ No errors in browser console or Edge Function logs
