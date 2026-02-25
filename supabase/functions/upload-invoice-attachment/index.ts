import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface UploadRequest {
  fileBase64: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  invoiceId: string;
  invoiceNumber: string;
  departmentId: string | null;
  userId?: string;
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

async function uploadViaDriveFunction(
  supabaseUrl: string,
  authHeader: string,
  fileBase64: string,
  fileName: string,
  mimeType: string,
  folderId: string,
  userId: string
): Promise<{ fileId: string; webViewLink: string }> {
  const response = await fetch(
    `${supabaseUrl}/functions/v1/upload-to-google-drive`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileBase64,
        fileName,
        mimeType,
        originalMimeType: mimeType,
        folderId,
        userId,
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Drive upload failed: ${response.status}`);
  }

  return { fileId: data.fileId || data.driveFileId, webViewLink: data.webViewLink };
}

async function findOrCreateFolderViaDrive(
  accessToken: string,
  folderName: string,
  parentFolderId: string
): Promise<string> {
  const escapedName = folderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query = `name='${escapedName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (searchResponse.ok) {
    const searchData = await searchResponse.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }
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
    throw new Error(`Failed to create folder: ${createResponse.status} ${await createResponse.text()}`);
  }

  const createData = await createResponse.json();
  return createData.id;
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

async function getOAuthAccessToken(supabase: any, userId: string): Promise<string | null> {
  const { data: userConfigs } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("provider", "google_workspace")
    .limit(1);

  if (userConfigs && userConfigs.length > 0) {
    const cfg = userConfigs[0];
    const expiryTime = cfg.oauth_token_expiry ? new Date(cfg.oauth_token_expiry).getTime() : 0;

    if (Date.now() < expiryTime - 5 * 60 * 1000 && cfg.oauth_access_token) {
      return cfg.oauth_access_token;
    }

    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

    if (googleClientId && googleClientSecret && cfg.oauth_refresh_token) {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: googleClientId,
          client_secret: googleClientSecret,
          refresh_token: cfg.oauth_refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (tokenResponse.ok) {
        const tokens = await tokenResponse.json();
        const expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);
        await supabase
          .from("user_email_configs")
          .update({
            oauth_access_token: tokens.access_token,
            oauth_token_expiry: expiryDate.toISOString(),
          })
          .eq("id", cfg.id);
        return tokens.access_token;
      }
    }
  }

  const { data: anyConfigs } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("is_active", true)
    .eq("provider", "google_workspace")
    .limit(1);

  if (anyConfigs && anyConfigs.length > 0) {
    const cfg = anyConfigs[0];
    const expiryTime = cfg.oauth_token_expiry ? new Date(cfg.oauth_token_expiry).getTime() : 0;

    if (Date.now() < expiryTime - 5 * 60 * 1000 && cfg.oauth_access_token) {
      return cfg.oauth_access_token;
    }

    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

    if (googleClientId && googleClientSecret && cfg.oauth_refresh_token) {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: googleClientId,
          client_secret: googleClientSecret,
          refresh_token: cfg.oauth_refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (tokenResponse.ok) {
        const tokens = await tokenResponse.json();
        const expiryDate = new Date();
        expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);
        await supabase
          .from("user_email_configs")
          .update({
            oauth_access_token: tokens.access_token,
            oauth_token_expiry: expiryDate.toISOString(),
          })
          .eq("id", cfg.id);
        return tokens.access_token;
      }
    }
  }

  return null;
}

async function getAccessToken(supabase: any, userId: string): Promise<string> {
  const serviceToken = await getServiceAccountToken();
  if (serviceToken) {
    console.log("[Auth] Using Google Service Account");
    return serviceToken;
  }

  const oauthToken = await getOAuthAccessToken(supabase, userId);
  if (oauthToken) {
    console.log("[Auth] Using OAuth token");
    return oauthToken;
  }

  throw new Error(
    "Brak konfiguracji Google Drive. Skonfiguruj Service Account lub połącz konto Google w Konfiguracji."
  );
}

async function uploadToSupabaseStorage(
  supabase: any,
  userId: string,
  invoiceId: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array
): Promise<{ storagePath: string; publicUrl: string }> {
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${userId}/${invoiceId}/${Date.now()}_${sanitizedFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("invoice-attachments")
    .upload(storagePath, bytes, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from("invoice-attachments")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10);

  if (signedUrlError || !signedUrlData?.signedUrl) {
    throw new Error(`Failed to create signed URL: ${signedUrlError?.message}`);
  }

  return { storagePath, publicUrl: signedUrlData.signedUrl };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: UploadRequest = await req.json();
    const { fileBase64, fileName, mimeType, fileSize, invoiceId, invoiceNumber, departmentId, userId: bodyUserId } = body;

    if (!fileBase64) throw new Error("No file data provided");
    if (!fileName) throw new Error("fileName is required");
    if (!invoiceId) throw new Error("invoiceId is required");
    if (!bodyUserId) throw new Error("userId is required");

    const resolvedUserId = bodyUserId;

    const binaryString = atob(fileBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    let attachmentsFolderId: string | null = null;
    let deptName: string | null = null;

    if (departmentId) {
      const { data: dept } = await supabase
        .from("departments")
        .select("google_drive_attachments_folder_id, google_drive_unpaid_folder_id, google_drive_draft_folder_id, google_drive_paid_folder_id, name")
        .eq("id", departmentId)
        .maybeSingle();

      if (dept?.google_drive_attachments_folder_id) {
        attachmentsFolderId = extractFolderIdFromUrl(dept.google_drive_attachments_folder_id);
      } else {
        const fallbackFolder =
          dept?.google_drive_unpaid_folder_id ||
          dept?.google_drive_draft_folder_id ||
          dept?.google_drive_paid_folder_id;
        if (fallbackFolder) {
          const accessToken = await getAccessToken(supabase, resolvedUserId).catch(() => null);
          if (accessToken) {
            const parentId = extractFolderIdFromUrl(fallbackFolder);
            attachmentsFolderId = await findOrCreateFolderViaDrive(accessToken, "Zalaczniki", parentId).catch(() => null);
          }
        }
      }
      deptName = dept?.name || null;
    }

    if (attachmentsFolderId) {
      const accessToken = await getAccessToken(supabase, resolvedUserId);

      const invoiceFolderName = invoiceNumber && invoiceNumber.trim()
        ? invoiceNumber.trim().replace(/[/\\:*?"<>|]/g, "_")
        : `faktura_${invoiceId.slice(0, 8)}`;

      const invoiceFolderId = await findOrCreateFolderViaDrive(accessToken, invoiceFolderName, attachmentsFolderId);

      const fileBlob = new Blob([bytes], { type: mimeType || "application/octet-stream" });

      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({
        name: fileName,
        mimeType: mimeType || "application/octet-stream",
        parents: [invoiceFolderId],
      })], { type: "application/json" }));
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

      const { error: insertError } = await supabase
        .from("invoice_attachments")
        .insert({
          invoice_id: invoiceId,
          uploaded_by: resolvedUserId,
          file_name: fileName,
          google_drive_file_id: uploadData.id,
          google_drive_web_view_link: uploadData.webViewLink,
          google_drive_folder_id: invoiceFolderId,
          mime_type: mimeType || "application/octet-stream",
          file_size: fileSize || null,
        });

      if (insertError) {
        throw new Error(`Database error: ${insertError.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          fileId: uploadData.id,
          webViewLink: uploadData.webViewLink,
          fileName,
          storage: "google_drive",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rootFolderUrl = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");
    if (rootFolderUrl) {
      const accessToken = await getAccessToken(supabase, resolvedUserId);
      const rootFolderId = extractFolderIdFromUrl(rootFolderUrl);
      const attachmentsRootId = await findOrCreateFolderViaDrive(accessToken, "Zalaczniki", rootFolderId);

      const invoiceFolderName = invoiceNumber && invoiceNumber.trim()
        ? invoiceNumber.trim().replace(/[/\\:*?"<>|]/g, "_")
        : `faktura_${invoiceId.slice(0, 8)}`;

      const invoiceFolderId = await findOrCreateFolderViaDrive(accessToken, invoiceFolderName, attachmentsRootId);

      const fileBlob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify({
        name: fileName,
        mimeType: mimeType || "application/octet-stream",
        parents: [invoiceFolderId],
      })], { type: "application/json" }));
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

      const { error: insertError } = await supabase
        .from("invoice_attachments")
        .insert({
          invoice_id: invoiceId,
          uploaded_by: resolvedUserId,
          file_name: fileName,
          google_drive_file_id: uploadData.id,
          google_drive_web_view_link: uploadData.webViewLink,
          google_drive_folder_id: invoiceFolderId,
          mime_type: mimeType || "application/octet-stream",
          file_size: fileSize || null,
        });

      if (insertError) {
        throw new Error(`Database error: ${insertError.message}`);
      }

      return new Response(
        JSON.stringify({
          success: true,
          fileId: uploadData.id,
          webViewLink: uploadData.webViewLink,
          fileName,
          storage: "google_drive",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { storagePath, publicUrl } = await uploadToSupabaseStorage(
      supabase,
      resolvedUserId,
      invoiceId,
      fileName,
      mimeType,
      bytes
    );

    const { error: insertError } = await supabase
      .from("invoice_attachments")
      .insert({
        invoice_id: invoiceId,
        uploaded_by: resolvedUserId,
        file_name: fileName,
        google_drive_file_id: null,
        google_drive_web_view_link: publicUrl,
        google_drive_folder_id: null,
        storage_path: storagePath,
        mime_type: mimeType || "application/octet-stream",
        file_size: fileSize || null,
      });

    if (insertError) {
      await supabase.storage.from("invoice-attachments").remove([storagePath]);
      throw new Error(`Database error: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        webViewLink: publicUrl,
        fileName,
        storage: "supabase",
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
