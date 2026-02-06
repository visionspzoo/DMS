import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

async function getGoogleAccessToken(): Promise<string> {
  const now = Date.now();

  if (cachedAccessToken && tokenExpiresAt > now) {
    return cachedAccessToken;
  }

  const googleClientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const googleClientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const googleRefreshToken = Deno.env.get('GOOGLE_REFRESH_TOKEN');

  if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
    throw new Error('Google Drive credentials not configured');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: googleRefreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error('Failed to get Google access token');
  }

  const tokenData = await tokenResponse.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = now + (tokenData.expires_in * 1000) - 60000;

  return cachedAccessToken;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { fileId, targetFolderId } = await req.json();

    if (!fileId || !targetFolderId) {
      return new Response(
        JSON.stringify({ error: 'fileId and targetFolderId are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const accessToken = await getGoogleAccessToken();

    const getFileResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!getFileResponse.ok) {
      throw new Error(`Failed to get file info: ${await getFileResponse.text()}`);
    }

    const fileData = await getFileResponse.json();
    const previousParents = fileData.parents?.join(',') || '';

    const moveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${targetFolderId}&removeParents=${previousParents}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!moveResponse.ok) {
      const errorText = await moveResponse.text();
      throw new Error(`Failed to move file: ${moveResponse.status} - ${errorText}`);
    }

    const result = await moveResponse.json();

    return new Response(
      JSON.stringify({ success: true, result }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error moving file on Google Drive:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
