import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

async function getOAuthTokenFromDb(supabase: any): Promise<string | null> {
  const { data: configs } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("is_active", true)
    .eq("provider", "google_workspace")
    .limit(1);

  if (!configs || configs.length === 0) return null;

  const config = configs[0];
  if (!config.oauth_refresh_token) return null;

  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!googleClientId || !googleClientSecret) return null;

  const expiryTime = config.oauth_token_expiry ? new Date(config.oauth_token_expiry).getTime() : 0;
  if (config.oauth_access_token && Date.now() < expiryTime - 5 * 60 * 1000) {
    return config.oauth_access_token;
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

  if (!tokenResponse.ok) return null;

  const tokens = await tokenResponse.json();
  const expiryDate = new Date();
  expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

  await supabase.from("user_email_configs").update({
    oauth_access_token: tokens.access_token,
    oauth_token_expiry: expiryDate.toISOString(),
  }).eq("id", config.id);

  return tokens.access_token;
}

async function uploadFileToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  fileBase64: string,
  mimeType: string
): Promise<string> {
  const binaryString = atob(fileBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const fileBlob = new Blob([bytes], { type: mimeType });

  const metadata = {
    name: fileName,
    mimeType: mimeType,
    parents: [folderId],
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
    throw new Error(`Drive upload failed (${uploadResponse.status}): ${errorText}`);
  }

  const data = await uploadResponse.json();
  return data.id;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.is_admin) throw new Error("Admin access required");

    const accessToken = await getServiceAccountToken() || await getOAuthTokenFromDb(supabase);
    if (!accessToken) throw new Error("No Google Drive authentication available. Configure Service Account or connect a Google account.");

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const onlyMissing = body.only_missing !== false;

    const query = supabase
      .from("invoices")
      .select(`
        id, file_url, pdf_base64, status, department_id, vendor_name, invoice_number, created_at,
        departments!inner(
          name,
          google_drive_draft_folder_id,
          google_drive_unpaid_folder_id,
          google_drive_paid_folder_id
        )
      `)
      .not("pdf_base64", "is", null);

    if (onlyMissing) {
      query.is("google_drive_id", null);
    }

    const { data: invoices, error: fetchError } = await query.order("created_at", { ascending: true });

    if (fetchError) throw fetchError;
    if (!invoices || invoices.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No invoices to process", processed: 0, skipped: 0, errors: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          total: invoices.length,
          invoices: invoices.map((inv: any) => ({
            id: inv.id,
            invoice_number: inv.invoice_number,
            vendor: inv.vendor_name,
            status: inv.status,
            department: inv.departments?.name,
            target_folder: inv.status === "paid"
              ? inv.departments?.google_drive_paid_folder_id
              : inv.status === "draft"
              ? inv.departments?.google_drive_draft_folder_id
              : inv.departments?.google_drive_unpaid_folder_id,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let skipped = 0;
    const errors: { id: string; error: string }[] = [];

    for (const invoice of invoices) {
      try {
        const dept = (invoice as any).departments;
        if (!dept) {
          skipped++;
          continue;
        }

        let folderId: string | null = null;
        if (invoice.status === "paid") {
          folderId = dept.google_drive_paid_folder_id;
        } else if (invoice.status === "draft") {
          folderId = dept.google_drive_draft_folder_id;
        } else {
          folderId = dept.google_drive_unpaid_folder_id;
        }

        if (!folderId) {
          skipped++;
          errors.push({ id: invoice.id, error: `No folder configured for status '${invoice.status}' in department '${dept.name}'` });
          continue;
        }

        const cleanFolderId = extractFolderIdFromUrl(folderId);

        const dateStr = new Date(invoice.created_at).toISOString().slice(0, 10);
        const invoiceNum = invoice.invoice_number || invoice.id.slice(0, 8);
        const vendor = (invoice.vendor_name || "unknown").replace(/[^a-zA-Z0-9_\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]/g, "").trim();
        const fileName = `${dateStr}_${vendor}_${invoiceNum}.pdf`;

        const driveFileId = await uploadFileToDrive(
          accessToken,
          cleanFolderId,
          fileName,
          invoice.pdf_base64,
          "application/pdf"
        );

        await supabase
          .from("invoices")
          .update({ google_drive_id: driveFileId, user_drive_file_id: driveFileId })
          .eq("id", invoice.id);

        processed++;
        console.log(`[BulkUpload] Uploaded invoice ${invoice.id} -> Drive file ${driveFileId}`);
      } catch (err: any) {
        errors.push({ id: invoice.id, error: err.message });
        console.error(`[BulkUpload] Error for invoice ${invoice.id}:`, err.message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed, skipped, errors, total: invoices.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[BulkUpload] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
