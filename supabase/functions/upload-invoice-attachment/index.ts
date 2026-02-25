import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OAuthConfig {
  id: string;
  user_id: string;
  email_address: string;
  oauth_access_token: string;
  oauth_refresh_token: string;
  oauth_token_expiry: string;
  is_active: boolean;
}

function extractFolderIdFromUrl(input: string): string {
  if (!input) return input;
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /id=([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return input;
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
      btoa(JSON.stringify(obj))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    const headerB64 = encode(header);
    const payloadB64 = encode(payload);
    const signingInput = `${headerB64}.${payloadB64}`;

    const pemKey = serviceAccount.private_key;
    const pemBody = pemKey
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
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const jwt = `${signingInput}.${signatureB64}`;

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenResponse.ok) return null;
    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (e) {
    console.error("[ServiceAccount] Failed to get token:", e);
    return null;
  }
}

async function refreshOAuthToken(supabase: any, config: OAuthConfig): Promise<string> {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!googleClientId || !googleClientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
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
    throw new Error(`Failed to refresh Google token (${tokenResponse.status}).`);
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

async function getOAuthToken(supabase: any, config: OAuthConfig): Promise<string> {
  if (!config.oauth_token_expiry || !config.oauth_access_token) {
    return await refreshOAuthToken(supabase, config);
  }
  const expiryTime = new Date(config.oauth_token_expiry).getTime();
  if (Date.now() >= expiryTime - 5 * 60 * 1000) {
    return await refreshOAuthToken(supabase, config);
  }
  return config.oauth_access_token;
}

async function getAccessToken(supabase: any, targetUserId: string): Promise<string> {
  const serviceToken = await getServiceAccountToken();
  if (serviceToken) return serviceToken;

  const { data: userConfigs } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("user_id", targetUserId)
    .eq("is_active", true)
    .eq("provider", "google_workspace");

  if (userConfigs && userConfigs.length > 0) {
    return await getOAuthToken(supabase, userConfigs[0] as OAuthConfig);
  }

  const { data: anyConfigs, error: anyConfigError } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("is_active", true)
    .eq("provider", "google_workspace")
    .limit(1);

  if (anyConfigError || !anyConfigs || anyConfigs.length === 0) {
    throw new Error("No active Google account connected.");
  }

  return await getOAuthToken(supabase, anyConfigs[0] as OAuthConfig);
}

async function findOrCreateFolder(folderName: string, parentFolderId: string, accessToken: string): Promise<string> {
  const escapedName = folderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query = `name='${escapedName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!searchResponse.ok) {
    throw new Error(`Failed to search for folder: ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  const createResponse = await fetch(
    "https://www.googleapis.com/drive/v3/files",
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
    throw new Error(`Failed to create folder: ${createResponse.status}`);
  }

  const createData = await createResponse.json();
  return createData.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error("Supabase configuration missing");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const invoiceId = formData.get("invoiceId") as string;
    const invoiceNumber = formData.get("invoiceNumber") as string;
    const departmentId = formData.get("departmentId") as string | null;

    if (!file) throw new Error("No file provided");
    if (!invoiceId) throw new Error("invoiceId is required");

    const accessToken = await getAccessToken(supabase, user.id);

    let attachmentsFolderId: string | null = null;

    if (departmentId) {
      const { data: dept } = await supabase
        .from("departments")
        .select("google_drive_attachments_folder_id, name")
        .eq("id", departmentId)
        .maybeSingle();

      if (dept?.google_drive_attachments_folder_id) {
        attachmentsFolderId = extractFolderIdFromUrl(dept.google_drive_attachments_folder_id);
      }
    }

    if (!attachmentsFolderId) {
      const rootFolderUrl = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");
      if (!rootFolderUrl) throw new Error("No attachments folder configured. Please set up the attachments folder for the department in Settings -> Dzialy.");
      const rootFolderId = extractFolderIdFromUrl(rootFolderUrl);
      attachmentsFolderId = await findOrCreateFolder("Zalaczniki", rootFolderId, accessToken);
    }

    const invoiceFolderName = invoiceNumber && invoiceNumber.trim()
      ? invoiceNumber.trim().replace(/[/\\:*?"<>|]/g, "_")
      : `faktura_${invoiceId.slice(0, 8)}`;

    const invoiceFolderId = await findOrCreateFolder(invoiceFolderName, attachmentsFolderId, accessToken);

    const arrayBuffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuffer);
    const fileBlob = new Blob([fileBytes], { type: file.type || "application/octet-stream" });

    const metadata = {
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      parents: [invoiceFolderId],
    };

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", fileBlob);

    const uploadResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType,size",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Google Drive upload failed: ${uploadResponse.status} - ${errorText}`);
    }

    const uploadData = await uploadResponse.json();

    const { error: insertError } = await supabase
      .from("invoice_attachments")
      .insert({
        invoice_id: invoiceId,
        uploaded_by: user.id,
        file_name: file.name,
        google_drive_file_id: uploadData.id,
        google_drive_web_view_link: uploadData.webViewLink,
        google_drive_folder_id: invoiceFolderId,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
      });

    if (insertError) {
      console.error("[Attachment] Failed to insert record:", insertError);
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        fileId: uploadData.id,
        webViewLink: uploadData.webViewLink,
        fileName: file.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error uploading attachment:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
