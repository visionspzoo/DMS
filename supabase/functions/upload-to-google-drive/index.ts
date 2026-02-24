import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
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
}

interface EmailConfig {
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

async function findOrCreateFolder(folderName: string, parentFolderId: string, accessToken: string): Promise<string> {
  const escapedName = folderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  
  const query = `name='${escapedName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  
  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
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

    const { fileUrl, fileBase64, fileName, invoiceId, department, folderId, mimeType, originalMimeType, isContract, userId }: UploadRequest = await req.json();

    let targetUserId: string;

    // If userId is provided (internal call from service), use it
    // Otherwise authenticate the user from the token
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

    // Get Google OAuth config - first try the uploading user, then fall back to any active config
    let emailConfigs = null;
    let configError = null;

    const { data: userConfigs, error: userConfigError } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("is_active", true)
      .eq("provider", "google_workspace");

    if (!userConfigError && userConfigs && userConfigs.length > 0) {
      emailConfigs = userConfigs;
    } else {
      // Fall back to any active Google OAuth config in the system
      const { data: anyConfigs, error: anyConfigError } = await supabase
        .from("user_email_configs")
        .select("*")
        .eq("is_active", true)
        .eq("provider", "google_workspace")
        .limit(1);

      emailConfigs = anyConfigs;
      configError = anyConfigError;
    }

    if (configError || !emailConfigs || emailConfigs.length === 0) {
      throw new Error("No active Google account connected. Please connect a Google account in Configuration.");
    }

    const oauthConfig = emailConfigs[0] as EmailConfig;
    const accessToken = await getValidAccessToken(supabase, oauthConfig);

    let targetFolderId: string;

    if (folderId) {
      // Use direct folder ID (for KSEF invoices)
      targetFolderId = extractFolderIdFromUrl(folderId);
    } else {
      // Use root folder and create subfolders (for regular invoices)
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

    let fileBlob: Blob;

    if (fileBase64) {
      const binaryString = atob(fileBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      fileBlob = new Blob([bytes], { type: originalMimeType || 'application/octet-stream' });
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
      name: fileName,
      mimeType: mimeType || fileBlob.type,
      parents: [targetFolderId],
    };

    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append("file", fileBlob);

    const uploadResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
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
        console.error('[Drive Upload] Failed to update invoice:', updateError);
        throw updateError;
      }
      console.log('[Drive Upload] Updated invoice', invoiceId, 'with file ID', uploadData.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        fileId: uploadData.id,
        driveFileId: uploadData.id,
        webViewLink: uploadData.webViewLink
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error uploading to Google Drive:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});