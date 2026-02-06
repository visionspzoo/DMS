import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface DeleteRequest {
  fileId: string;
}

let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: googleRefreshToken,
      grant_type: "refresh_token",
    }),
  });
  
  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to refresh Google token: ${errorText}`);
  }
  
  const tokenData = await tokenResponse.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = now + (tokenData.expires_in * 1000) - 60000;
  
  return cachedAccessToken!;
}

async function deleteFileFromGoogleDrive(fileId: string): Promise<void> {
  const accessToken = await getGoogleAccessToken();
  
  console.log(`Deleting file from Google Drive: ${fileId}`);
  
  const deleteResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    }
  );
  
  if (!deleteResponse.ok) {
    const errorText = await deleteResponse.text();
    throw new Error(`Failed to delete file from Google Drive: ${deleteResponse.status} - ${errorText}`);
  }
  
  console.log("✓ File deleted successfully from Google Drive");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log("=== DELETE FROM GOOGLE DRIVE STARTED ===");
    
    const { fileId }: DeleteRequest = await req.json();
    
    if (!fileId) {
      throw new Error("fileId is required");
    }
    
    console.log(`Request to delete file: ${fileId}`);
    
    await deleteFileFromGoogleDrive(fileId);
    
    console.log("=== DELETE FROM GOOGLE DRIVE COMPLETED ===");
    
    return new Response(
      JSON.stringify({
        success: true,
        message: "File deleted from Google Drive",
        fileId,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("=== DELETE FROM GOOGLE DRIVE FAILED ===");
    console.error("Error:", error);
    
    return new Response(
      JSON.stringify({
        error: error.message,
        details: error.toString(),
      }),
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
