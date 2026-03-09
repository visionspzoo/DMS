import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface EmailConfig {
  id: string;
  user_id: string;
  email_address: string;
  oauth_access_token: string;
  oauth_refresh_token: string;
  oauth_token_expiry: string;
  is_active: boolean;
}

async function refreshAccessToken(
  supabase: any,
  config: EmailConfig
): Promise<string> {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!googleClientId || !googleClientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
  }

  if (!config.oauth_refresh_token) {
    throw new Error("No refresh token available. Please reconnect your Google account.");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: config.oauth_refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    console.error("Token refresh failed:", errorBody);
    throw new Error(`Failed to refresh Google token (${tokenResponse.status}). Please reconnect your Google account.`);
  }

  const tokens = await tokenResponse.json();
  const expiryDate = new Date();
  expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

  await supabase
    .from("user_email_configs")
    .update({
      oauth_access_token: tokens.access_token,
      oauth_token_expiry: expiryDate.toISOString(),
    })
    .eq("id", config.id);

  return tokens.access_token;
}

async function getValidAccessToken(
  supabase: any,
  config: EmailConfig
): Promise<string> {
  if (!config.oauth_token_expiry || !config.oauth_access_token) {
    return await refreshAccessToken(supabase, config);
  }

  const expiryTime = new Date(config.oauth_token_expiry).getTime();
  const now = Date.now();

  if (now >= expiryTime - 5 * 60 * 1000) {
    return await refreshAccessToken(supabase, config);
  }

  return config.oauth_access_token;
}

async function getServiceAccountToken(): Promise<string | null> {
  const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!serviceAccountJson) return null;

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    const encode = (obj: object) =>
      btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const headerB64 = encode(header);
    const payloadB64 = encode(payload);
    const signingInput = `${headerB64}.${payloadB64}`;

    const pemBody = serviceAccount.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s/g, "");

    const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(signingInput)
    );

    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const jwt = `${signingInput}.${signatureB64}`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenResponse.ok) {
      console.error("[ServiceAccount] Token error:", await tokenResponse.text());
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (e) {
    console.error("[ServiceAccount] Failed:", e);
    return null;
  }
}

async function getOrCreateFolder(
  accessToken: string,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!searchResponse.ok) {
    throw new Error(`Failed to search for folder: ${await searchResponse.text()}`);
  }

  const searchData = await searchResponse.json();

  if (searchData.files && searchData.files.length > 0) {
    console.log(`[MoveFile] Found existing folder '${folderName}': ${searchData.files[0].id}`);
    return searchData.files[0].id;
  }

  const createResponse = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      }),
    }
  );

  if (!createResponse.ok) {
    throw new Error(`Failed to create folder '${folderName}': ${await createResponse.text()}`);
  }

  const createdFolder = await createResponse.json();
  console.log(`[MoveFile] Created folder '${folderName}': ${createdFolder.id}`);
  return createdFolder.id;
}

const POLISH_MONTHS: Record<number, string> = {
  1: "01 - Styczen",
  2: "02 - Luty",
  3: "03 - Marzec",
  4: "04 - Kwiecien",
  5: "05 - Maj",
  6: "06 - Czerwiec",
  7: "07 - Lipiec",
  8: "08 - Sierpien",
  9: "09 - Wrzesien",
  10: "10 - Pazdziernik",
  11: "11 - Listopad",
  12: "12 - Grudzien",
};

async function resolveTargetFolder(
  accessToken: string,
  baseFolderId: string,
  issueDate: string | null
): Promise<string> {
  if (!issueDate) {
    return baseFolderId;
  }

  const date = new Date(issueDate);
  if (isNaN(date.getTime())) {
    console.warn(`[MoveFile] Invalid issueDate '${issueDate}', using base folder`);
    return baseFolderId;
  }

  const year = String(date.getFullYear());
  const monthLabel = POLISH_MONTHS[date.getMonth() + 1];

  const yearFolderId = await getOrCreateFolder(accessToken, baseFolderId, year);
  const monthFolderId = await getOrCreateFolder(accessToken, yearFolderId, monthLabel);

  return monthFolderId;
}

async function moveFile(accessToken: string, fileId: string, targetFolderId: string, newFileName?: string): Promise<any> {
  const getFileResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (!getFileResponse.ok) {
    throw new Error(`Failed to get file info: ${await getFileResponse.text()}`);
  }

  const fileData = await getFileResponse.json();
  const previousParents = fileData.parents?.join(',') || '';

  const moveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${encodeURIComponent(targetFolderId)}&removeParents=${encodeURIComponent(previousParents)}&fields=id%2Cname%2Cparents`;

  const patchBody: Record<string, string> = {};
  if (newFileName) {
    patchBody.name = newFileName;
  }

  const moveResponse = await fetch(moveUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patchBody),
  });

  if (!moveResponse.ok) {
    const errorText = await moveResponse.text();
    throw new Error(`Failed to move file: ${moveResponse.status} - ${errorText}`);
  }

  return await moveResponse.json();
}

async function getGlobalRefreshToken(_supabase: any): Promise<string | null> {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const googleRefreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");

  if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
    return null;
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: googleClientId,
        client_secret: googleClientSecret,
        refresh_token: googleRefreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("[GlobalRefreshToken] Token error:", await tokenResponse.text());
      return null;
    }

    const tokenData = await tokenResponse.json();
    console.log("[Auth] Using global GOOGLE_REFRESH_TOKEN");
    return tokenData.access_token;
  } catch (e) {
    console.error("[GlobalRefreshToken] Failed:", e);
    return null;
  }
}

async function getAnyActiveOAuthToken(supabase: any): Promise<string | null> {
  const { data: configs } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("is_active", true)
    .eq("provider", "google_workspace")
    .limit(1);

  if (!configs || configs.length === 0) return null;

  try {
    return await getValidAccessToken(supabase, configs[0] as EmailConfig);
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error("Supabase configuration missing");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const body = await req.json();
    const { fileId, targetFolderId, issueDate, invoiceNumber, vendorName } = body;

    if (!fileId || !targetFolderId) {
      return new Response(
        JSON.stringify({ error: 'fileId and targetFolderId are required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let accessToken: string | null = null;
    let authMethod = 'none';

    accessToken = await getServiceAccountToken();
    if (accessToken) authMethod = 'service_account';

    if (!accessToken) {
      const globalToken = await getGlobalRefreshToken(supabase);
      if (globalToken) {
        accessToken = globalToken;
        authMethod = 'global_refresh_token';
      }
    }

    if (!accessToken) {
      const { data: emailConfigs } = await supabase
        .from("user_email_configs")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .eq("provider", "google_workspace");

      if (emailConfigs && emailConfigs.length > 0) {
        try {
          accessToken = await getValidAccessToken(supabase, emailConfigs[0] as EmailConfig);
          authMethod = 'user_oauth';
        } catch (e) {
          console.warn("[MoveFile] User OAuth failed:", e);
        }
      }
    }

    if (!accessToken) {
      accessToken = await getAnyActiveOAuthToken(supabase);
      if (accessToken) authMethod = 'any_oauth';
    }

    if (!accessToken) {
      throw new Error("No Google Drive authentication available. Configure Service Account or connect a Google account.");
    }

    const resolvedFolderId = await resolveTargetFolder(accessToken, targetFolderId, issueDate || null);

    const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
    let newFileName: string | undefined;
    if (invoiceNumber || vendorName) {
      const parts = [invoiceNumber, vendorName].filter(Boolean).map(sanitize);
      newFileName = parts.join(' - ') + '.pdf';
    }

    console.log(`[MoveFile] Moving file ${fileId} to folder ${resolvedFolderId} (base: ${targetFolderId}, issueDate: ${issueDate || 'none'}, newName: ${newFileName || 'unchanged'}) via ${authMethod}`);

    const result = await moveFile(accessToken, fileId, resolvedFolderId, newFileName);

    return new Response(
      JSON.stringify({ success: true, result, resolvedFolderId }),
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
