import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

interface UploadRequest {
  fileUrl?: string;
  fileBase64?: string;
  fileName: string;
  invoiceId?: string;
  department?: string;
  folderId?: string;
  mimeType?: string;
  originalMimeType?: string;
  isContract?: boolean;
  userId?: string;
  issueDate?: string;
}

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

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim();
}

function buildInvoiceFileName(
  invoiceNumber: string | null | undefined,
  supplierName: string | null | undefined,
  originalFileName: string
): string {
  const ext = ".pdf";
  const parts: string[] = [];

  if (invoiceNumber && String(invoiceNumber).trim().length > 0 && invoiceNumber !== "null") {
    parts.push(sanitizeFileName(String(invoiceNumber).trim()));
  }

  if (supplierName && String(supplierName).trim().length > 0 && supplierName !== "null") {
    parts.push(sanitizeFileName(String(supplierName).trim()));
  }

  if (parts.length === 0) {
    return originalFileName.endsWith(".pdf") ? originalFileName : originalFileName + ext;
  }

  return parts.join(" - ") + ext;
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

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error("[ServiceAccount] Token error:", err);
      return null;
    }

    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
  } catch (e) {
    console.error("[ServiceAccount] Failed to get token:", e);
    return null;
  }
}

async function getGlobalRefreshToken(): Promise<string | null> {
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
      const err = await tokenResponse.text();
      console.error("[GlobalRefreshToken] Token error:", err);
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

async function refreshOAuthToken(
  supabase: any,
  config: OAuthConfig
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

async function getOAuthToken(supabase: any, config: OAuthConfig): Promise<string> {
  if (!config.oauth_token_expiry || !config.oauth_access_token) {
    return await refreshOAuthToken(supabase, config);
  }

  const expiryTime = new Date(config.oauth_token_expiry).getTime();
  const now = Date.now();

  if (now >= expiryTime - 5 * 60 * 1000) {
    return await refreshOAuthToken(supabase, config);
  }

  return config.oauth_access_token;
}

async function getAccessToken(supabase: any, targetUserId: string): Promise<string> {
  const serviceToken = await getServiceAccountToken();
  if (serviceToken) {
    console.log("[Auth] Using Google Service Account");
    return serviceToken;
  }

  const globalToken = await getGlobalRefreshToken();
  if (globalToken) {
    return globalToken;
  }

  console.log("[Auth] No global auth, falling back to per-user OAuth");

  if (targetUserId) {
    const { data: userConfigs } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("is_active", true)
      .eq("provider", "google_workspace");

    if (userConfigs && userConfigs.length > 0) {
      console.log("[Auth] Using per-user OAuth for", targetUserId);
      return await getOAuthToken(supabase, userConfigs[0] as OAuthConfig);
    }
  }

  const { data: anyConfigs, error: anyConfigError } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("is_active", true)
    .eq("provider", "google_workspace")
    .limit(1);

  if (anyConfigError || !anyConfigs || anyConfigs.length === 0) {
    throw new Error("No active Google account connected. Please connect a Google account in Configuration or configure a Service Account.");
  }

  console.log("[Auth] Using any available OAuth as fallback");
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
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { fileUrl, fileBase64, fileName, invoiceId, department, folderId, mimeType, originalMimeType, isContract, userId, issueDate }: UploadRequest = await req.json();

    let targetUserId: string;

    if (userId) {
      targetUserId = userId;
    } else {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        throw new Error("Unauthorized");
      }
      targetUserId = user.id;
    }

    const accessToken = await getAccessToken(supabase, targetUserId);

    let targetFolderId: string;

    if (folderId) {
      targetFolderId = extractFolderIdFromUrl(folderId);
    } else {
      const rootFolderUrl = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");
      if (!rootFolderUrl) {
        throw new Error("GOOGLE_DRIVE_FOLDER_ID not configured");
      }

      const rootFolderId = extractFolderIdFromUrl(rootFolderUrl);
      targetFolderId = rootFolderId;

      if (department) {
        targetFolderId = await findOrCreateFolder(department, rootFolderId, accessToken);
      } else if (isContract) {
        targetFolderId = await findOrCreateFolder("Umowy", rootFolderId, accessToken);
      }
    }

    if (issueDate) {
      const date = new Date(issueDate);
      if (!isNaN(date.getTime())) {
        const year = String(date.getFullYear());
        const month = date.getMonth() + 1;
        const monthLabel = POLISH_MONTHS[month];
        const yearFolderId = await findOrCreateFolder(year, targetFolderId, accessToken);
        targetFolderId = await findOrCreateFolder(monthLabel, yearFolderId, accessToken);
      }
    }

    let finalFileName = fileName;

    if (invoiceId) {
      const { data: invoiceData } = await supabase
        .from("invoices")
        .select("invoice_number, supplier_name")
        .eq("id", invoiceId)
        .maybeSingle();

      if (invoiceData) {
        finalFileName = buildInvoiceFileName(
          invoiceData.invoice_number,
          invoiceData.supplier_name,
          fileName
        );
        console.log(`[Drive Upload] Renaming file to: ${finalFileName}`);
      }
    }

    let fileBlob: Blob;

    if (fileBase64) {
      const binaryString = atob(fileBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileBlob = new Blob([bytes], { type: originalMimeType || "application/octet-stream" });
    } else if (fileUrl) {
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        throw new Error("Failed to fetch file from URL");
      }
      fileBlob = await fileResponse.blob();
    } else {
      throw new Error("Either fileUrl or fileBase64 must be provided");
    }

    const metadata = {
      name: finalFileName,
      mimeType: mimeType || fileBlob.type,
      parents: [targetFolderId],
    };

    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("file", fileBlob);

    const uploadResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
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

    if (invoiceId) {
      const { error: updateError } = await supabase
        .from("invoices")
        .update({
          google_drive_id: uploadData.id,
          user_drive_file_id: uploadData.id,
        })
        .eq("id", invoiceId);

      if (updateError) {
        console.error("[Drive Upload] Failed to update invoice:", updateError);
        throw updateError;
      }
      console.log("[Drive Upload] Updated invoice", invoiceId, "with file ID", uploadData.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        fileId: uploadData.id,
        driveFileId: uploadData.id,
        webViewLink: uploadData.webViewLink,
        fileName: finalFileName,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error uploading to Google Drive:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
