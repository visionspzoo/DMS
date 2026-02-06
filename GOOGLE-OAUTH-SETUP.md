# Google OAuth Setup for Email Integration

This guide explains how to configure Google OAuth for automatic email invoice import.

## Prerequisites

- A Google Cloud Platform account
- Access to Google Cloud Console
- Admin access to Google Workspace (if using Workspace accounts)

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your project ID

## Step 2: Enable Gmail API

1. In the Google Cloud Console, go to **APIs & Services** > **Library**
2. Search for "Gmail API"
3. Click on "Gmail API" and click **Enable**

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **Internal** (for Workspace) or **External** (for regular Gmail)
3. Fill in the required information:
   - App name: `Aura DMS`
   - User support email: Your email
   - Developer contact information: Your email
4. Click **Save and Continue**
5. On the Scopes page, click **Add or Remove Scopes**
6. Add these scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
7. Click **Update** and **Save and Continue**
8. Review and click **Back to Dashboard**

## Step 4: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Web application** as the application type
4. Configure:
   - Name: `Aura DMS Web Client`
   - Authorized JavaScript origins:
     - `http://localhost:5173` (for development)
     - `https://your-production-domain.com` (for production)
   - Authorized redirect URIs:
     - `http://localhost:5173/` (for development)
     - `https://your-production-domain.com/` (for production)
5. Click **Create**
6. Copy the **Client ID** and **Client Secret**

## Step 5: Configure Environment Variables

### Frontend (.env file)

Add the Google Client ID to your `.env` file:

```env
VITE_GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
```

### Backend (Supabase Edge Functions)

The Google Client ID and Client Secret need to be configured as Supabase secrets:

1. Go to your Supabase project dashboard
2. Navigate to **Project Settings** > **Edge Functions**
3. Add the following secrets:
   - `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID
   - `GOOGLE_CLIENT_SECRET`: Your Google OAuth Client Secret

Alternatively, you can use the Supabase CLI:

```bash
supabase secrets set GOOGLE_CLIENT_ID=your_client_id_here
supabase secrets set GOOGLE_CLIENT_SECRET=your_client_secret_here
```

## Step 6: Test the Integration

1. Log in to the application
2. Navigate to **Konfiguracja** (Configuration)
3. Click **Połącz z Google** (Connect with Google)
4. Authorize the application to access your Gmail
5. The application will redirect back with your connected email
6. Click **Synchronizuj** to test fetching invoices from your email

## How It Works

1. **OAuth Flow**: User clicks "Connect with Google" and authorizes the app
2. **Token Exchange**: The app exchanges the authorization code for access and refresh tokens
3. **Token Storage**: Tokens are securely stored in the database
4. **Auto-Refresh**: Access tokens are automatically refreshed when they expire
5. **Email Sync**: The app uses the Gmail API to fetch messages with PDF attachments
6. **OCR Verification**: Each PDF is verified to be an invoice using OCR before import
7. **Duplicate Prevention**: Messages are tracked to prevent duplicate imports

## Security Notes

- Tokens are stored encrypted in the database
- Only users can access their own tokens (RLS policies)
- The application only requests read-only access to Gmail
- Refresh tokens allow long-term access without re-authentication

## Troubleshooting

### "Access blocked: This app's request is invalid"
- Make sure your redirect URI exactly matches what's configured in Google Cloud Console
- Check that the domain is listed in Authorized JavaScript origins

### "Error 400: redirect_uri_mismatch"
- The redirect URI in your code doesn't match Google Cloud Console configuration
- Make sure to include the trailing slash if needed

### Tokens expire immediately
- Check that the token expiry time is calculated correctly
- Verify that the refresh token is being saved properly

### No invoices synced
- Check that emails have PDF attachments
- Verify that the PDFs contain invoice-related keywords
- Check the Edge Function logs for errors

## Support

For issues specific to Google OAuth setup, refer to:
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
