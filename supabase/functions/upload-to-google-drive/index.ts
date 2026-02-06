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
}

let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

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

async function getGoogleAccessToken(): Promise<string> {
  const now = Date.now();
  
  if (cachedAccessToken && tokenExpiresAt > now) {
    return cachedAccessToken;
  }
  
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const googleRefreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  
  if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
    throw new Error("Google Drive credentials not configured");
  }
  
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: googleRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  
  if (!tokenResponse.ok) {
    throw new Error("Failed to get Google access token");
  }
  
  const tokenData = await tokenResponse.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = now + (tokenData.expires_in * 1000) - 60000;
  
  return cachedAccessToken;
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
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { fileUrl, fileBase64, fileName, invoiceId, department, folderId, mimeType, originalMimeType, isContract }: UploadRequest = await req.json();

    const accessToken = await getGoogleAccessToken();

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
        })
        .eq("id", invoiceId);

      if (updateError) throw updateError;
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