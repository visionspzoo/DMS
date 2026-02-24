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

function sanitize(str: string): string {
  return str.replace(/[/\\:*?"<>|]/g, "_").trim();
}

function buildFileName(invoice: any): string {
  const num = sanitize(invoice.invoice_number || invoice.id.slice(0, 8)).slice(0, 80);
  const vendor = sanitize(invoice.supplier_name || "").slice(0, 60);
  if (vendor) return `${num}_${vendor}.pdf`;
  return `${num}.pdf`;
}

function getInvoiceDate(invoice: any): Date {
  const raw = invoice.issue_date || invoice.created_at;
  if (raw) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
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

async function findOrCreateFolder(name: string, parentId: string, accessToken: string): Promise<string> {
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `name='${escaped}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (searchResp.ok) {
    const searchData = await searchResp.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }
  }

  const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Nie udalo sie utworzyc folderu '${name}': ${createResp.status} - ${err}`);
  }

  const createData = await createResp.json();
  return createData.id;
}

async function getYearMonthFolder(
  baseFolderId: string,
  date: Date,
  accessToken: string,
  cache: Map<string, string>
): Promise<string> {
  const year = date.getFullYear().toString();
  const month = date.getMonth() + 1;
  const monthLabel = POLISH_MONTHS[month];
  const cacheKey = `${baseFolderId}/${year}/${monthLabel}`;

  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const yearFolderId = await findOrCreateFolder(year, baseFolderId, accessToken);
  const monthFolderId = await findOrCreateFolder(monthLabel, yearFolderId, accessToken);

  cache.set(cacheKey, monthFolderId);
  return monthFolderId;
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

function getTargetFolder(invoice: any, dept: any): string | null {
  if (invoice.status === "paid") return dept.google_drive_paid_folder_id;
  if (invoice.status === "draft") return dept.google_drive_draft_folder_id;
  return dept.google_drive_unpaid_folder_id;
}

function getTargetFolderLabel(invoice: any, dept: any): string {
  if (!dept) return "Brak dzialu";
  const folderType = invoice.status === "paid" ? "oplacone" : invoice.status === "draft" ? "robocze" : "do zaplaty";
  const folderId = getTargetFolder(invoice, dept);
  if (!folderId) return `${dept.name} - brak folderu (${folderType})`;
  const date = getInvoiceDate(invoice);
  const year = date.getFullYear();
  const month = POLISH_MONTHS[date.getMonth() + 1];
  return `${dept.name} / ${folderType} / ${year} / ${month}`;
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

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const onlyMissing = body.only_missing !== false;
    const batchSize = body.batch_size ?? 5;
    const offset = body.offset ?? 0;

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

    const selectFields = dryRun
      ? "id, status, department_id, supplier_name, invoice_number, issue_date, created_at"
      : "id, pdf_base64, status, department_id, supplier_name, invoice_number, issue_date, created_at";

    let invoicesQuery = supabase
      .from("invoices")
      .select(selectFields)
      .not("pdf_base64", "is", null)
      .not("department_id", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (onlyMissing) {
      invoicesQuery = invoicesQuery.is("google_drive_id", null);
    }

    const { data: invoices, error: fetchError } = await invoicesQuery;
    if (fetchError) throw fetchError;

    if (!invoices || invoices.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No invoices to process", processed: 0, skipped: 0, errors: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const deptIds = [...new Set(invoices.map((i: any) => i.department_id).filter(Boolean))];
    const { data: departments, error: deptError } = await supabase
      .from("departments")
      .select("id, name, google_drive_draft_folder_id, google_drive_unpaid_folder_id, google_drive_paid_folder_id")
      .in("id", deptIds);

    if (deptError) throw deptError;

    const deptMap: Record<string, any> = {};
    for (const dept of (departments || [])) {
      deptMap[dept.id] = dept;
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dry_run: true,
          total: invoices.length,
          invoices: invoices.map((inv: any) => {
            const dept = deptMap[inv.department_id];
            return {
              id: inv.id,
              invoice_number: inv.invoice_number,
              vendor: inv.supplier_name,
              status: inv.status,
              department: dept?.name,
              target_folder: getTargetFolderLabel(inv, dept),
            };
          }),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let skipped = 0;
    const errors: { id: string; error: string }[] = [];
    const items: { id: string; invoice_number: string; vendor: string; status: string; department: string; ok: boolean; error?: string; drive_file_id?: string }[] = [];

    const folderCache = new Map<string, string>();

    for (const invoice of invoices) {
      const dept = deptMap[invoice.department_id];
      const invoiceMeta = {
        id: invoice.id,
        invoice_number: invoice.invoice_number || '',
        vendor: invoice.supplier_name || '',
        status: invoice.status,
        department: dept?.name || '',
      };

      try {
        if (!dept) {
          skipped++;
          const errMsg = "Nie znaleziono dzialu";
          errors.push({ id: invoice.id, error: errMsg });
          items.push({ ...invoiceMeta, ok: false, error: errMsg });
          continue;
        }

        const baseFolderRaw = getTargetFolder(invoice, dept);
        if (!baseFolderRaw) {
          skipped++;
          const errMsg = `Brak folderu dla statusu '${invoice.status}' w dziale '${dept.name}'`;
          errors.push({ id: invoice.id, error: errMsg });
          items.push({ ...invoiceMeta, ok: false, error: errMsg });
          continue;
        }

        const baseFolderId = extractFolderIdFromUrl(baseFolderRaw);
        const invoiceDate = getInvoiceDate(invoice);

        const targetFolderId = await getYearMonthFolder(baseFolderId, invoiceDate, accessToken, folderCache);

        const fileName = buildFileName(invoice);

        const driveFileId = await uploadFileToDrive(
          accessToken,
          targetFolderId,
          fileName,
          invoice.pdf_base64,
          "application/pdf"
        );

        await supabase
          .from("invoices")
          .update({ google_drive_id: driveFileId, user_drive_file_id: driveFileId })
          .eq("id", invoice.id);

        processed++;
        items.push({ ...invoiceMeta, ok: true, drive_file_id: driveFileId });
        console.log(`[BulkUpload] Uploaded ${invoice.id} -> ${driveFileId} (${fileName})`);
      } catch (err: any) {
        errors.push({ id: invoice.id, error: err.message });
        items.push({ ...invoiceMeta, ok: false, error: err.message });
        console.error(`[BulkUpload] Error for ${invoice.id}:`, err.message);
      }
    }

    const has_more = invoices.length === batchSize;
    return new Response(
      JSON.stringify({ success: true, processed, skipped, errors, items, total: invoices.length, has_more, next_offset: offset + batchSize }),
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
