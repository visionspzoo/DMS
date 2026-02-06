# Google Drive Configuration

## Environment Variables to Configure in Supabase

These secrets need to be added to your Supabase project:

1. Go to Supabase Dashboard
2. Navigate to: Project Settings → Edge Functions → Secrets
3. Add the following secrets:

```
GOOGLE_CLIENT_ID=590248404309-vko9d1jhbqhtvchsa9ucig557o9agk2q.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=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
GOOGLE_REFRESH_TOKEN=1//045QR8YaGYFZlCgYIARAAGAQSNwF-L9IrC59grOCd-4mYcFNIX1SHFD4qjOA4sAsU5PMaezAfYjycdjq7k7jGEEN1MPlTr7QzLAA
GOOGLE_DRIVE_FOLDER_ID=https://drive.google.com/drive/folders/1SkZx4YX2jOXfrythk9ObIv5VxlfHqZsE
```

## How It Works

When invoices are uploaded, the system will:

1. Upload the file to Supabase Storage
2. Automatically send the file to Google Drive
3. Create department folders automatically (e.g., "Marketing", "IT")
4. Store the Google Drive file ID in the database

## Folder Structure

```
Main Folder (1SkZx4YX2jOXfrythk9ObIv5VxlfHqZsE)
├── Marketing/
│   └── invoice1.pdf
├── IT/
│   └── invoice2.pdf
└── Finance/
    └── invoice3.pdf
```

Folders for departments are created automatically when needed.

## Testing

After configuring the secrets:
1. Restart your Edge Function (if deployed)
2. Upload a test invoice
3. Check your Google Drive folder to verify the file appears

## Security Notes

- The refresh token does not expire unless revoked
- Only the application has access to these credentials
- Files are uploaded with the scope: `drive.file` (access only to files created by the app)
