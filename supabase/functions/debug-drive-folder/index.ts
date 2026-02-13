import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function refreshAccessToken(
  supabase: any,
  config: any
): Promise<string> {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!googleClientId || !googleClientSecret) {
    throw new Error("Brak konfiguracji GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  }

  if (!config.oauth_refresh_token) {
    throw new Error("Brak refresh tokena");
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
    throw new Error(`Token refresh failed: ${errorBody}`);
  }

  const tokens = await tokenResponse.json();
  return tokens.access_token;
}

async function getValidAccessToken(supabase: any, config: any): Promise<string> {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    console.log("=== DEBUG DRIVE FOLDER START ===");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Brak nagłówka autoryzacji" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { createClient } = await import("npm:@supabase/supabase-js@2");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Nieautoryzowany" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get email config
    const { data: emailConfigs, error: emailConfigError } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("provider", "google_workspace");

    if (emailConfigError || !emailConfigs || emailConfigs.length === 0) {
      return new Response(
        JSON.stringify({ error: "Brak połączonego konta Google" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const oauthConfig = emailConfigs[0];
    const accessToken = await getValidAccessToken(supabase, oauthConfig);

    console.log("✓ Access token obtained");

    // Get folder mapping
    const { data: folderMappings } = await supabase
      .from("user_drive_folder_mappings")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const { data: driveConfigs } = await supabase
      .from("user_drive_configs")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const folderId = folderMappings?.google_drive_folder_id || driveConfigs?.google_drive_folder_id;

    if (!folderId) {
      return new Response(
        JSON.stringify({ error: "Brak skonfigurowanego folderu Drive" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("📁 Checking folder:", folderId);

    // 1. Get folder metadata
    console.log("\n=== STEP 1: Folder Metadata ===");
    const folderMetadataUrl = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,capabilities,shared,owners`;
    const folderMetadataResponse = await fetch(folderMetadataUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const folderMetadata = await folderMetadataResponse.json();
    console.log("Folder metadata:", JSON.stringify(folderMetadata, null, 2));

    // 2. List ALL files in folder (no filter)
    console.log("\n=== STEP 2: All Files (no filter) ===");
    const allFilesUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,size,modifiedTime,trashed)&pageSize=100`;

    console.log("Request URL:", allFilesUrl);

    const allFilesResponse = await fetch(allFilesUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log("Response status:", allFilesResponse.status);

    if (!allFilesResponse.ok) {
      const errorBody = await allFilesResponse.text();
      console.error("Error response:", errorBody);

      return new Response(
        JSON.stringify({
          error: `Drive API error: ${allFilesResponse.status}`,
          details: errorBody,
          folderId: folderId,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const allFilesData = await allFilesResponse.json();
    const allFiles = allFilesData.files || [];

    console.log(`Found ${allFiles.length} files total`);
    console.log("All files:", JSON.stringify(allFiles, null, 2));

    // 3. List only PDF files
    console.log("\n=== STEP 3: PDF Files Only ===");
    const pdfFilesUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`;

    const pdfFilesResponse = await fetch(pdfFilesUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const pdfFilesData = await pdfFilesResponse.json();
    const pdfFiles = pdfFilesData.files || [];

    console.log(`Found ${pdfFiles.length} PDF files`);
    console.log("PDF files:", JSON.stringify(pdfFiles, null, 2));

    // 4. Check permissions
    console.log("\n=== STEP 4: User Permissions ===");
    const aboutUrl = `https://www.googleapis.com/drive/v3/about?fields=user`;
    const aboutResponse = await fetch(aboutUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const aboutData = await aboutResponse.json();
    console.log("Current user:", JSON.stringify(aboutData, null, 2));

    return new Response(
      JSON.stringify({
        success: true,
        folderId: folderId,
        folderMetadata: folderMetadata,
        totalFiles: allFiles.length,
        allFiles: allFiles,
        pdfFiles: pdfFiles,
        pdfCount: pdfFiles.length,
        currentUser: aboutData,
        message: `Znaleziono ${allFiles.length} plików (w tym ${pdfFiles.length} PDF)`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
