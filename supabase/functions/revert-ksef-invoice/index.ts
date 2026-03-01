import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RevertRequest {
  ksefInvoiceId: string;
}

interface OAuthConfig {
  id: string;
  user_id: string;
  oauth_access_token: string;
  oauth_refresh_token: string;
  oauth_token_expiry: string;
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
    const errorBody = await tokenResponse.text();
    throw new Error(`Failed to refresh Google token: ${errorBody}`);
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

async function getGoogleAccessToken(supabase: any): Promise<string | null> {
  const { data: configs } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("is_active", true)
    .eq("provider", "google_workspace")
    .limit(1);

  if (!configs || configs.length === 0) return null;

  const config = configs[0] as OAuthConfig;
  const expiryTime = config.oauth_token_expiry ? new Date(config.oauth_token_expiry).getTime() : 0;
  if (Date.now() >= expiryTime - 5 * 60 * 1000) {
    return await refreshOAuthToken(supabase, config);
  }
  return config.oauth_access_token;
}

async function deleteFromDrive(fileId: string, accessToken: string): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (response.status === 404) {
    console.warn(`File ${fileId} not found in Drive, skipping`);
    return;
  }
  if (!response.ok) {
    const err = await response.text();
    console.error(`Drive delete failed for ${fileId}: ${response.status} - ${err}`);
  }
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { ksefInvoiceId }: RevertRequest = await req.json();

    if (!ksefInvoiceId) {
      throw new Error("ksefInvoiceId is required");
    }

    console.log(`Reverting KSEF invoice: ${ksefInvoiceId}`);

    const { data: ksefInvoice, error: ksefError } = await supabase
      .from("ksef_invoices")
      .select("transferred_to_invoice_id")
      .eq("id", ksefInvoiceId)
      .maybeSingle();

    if (ksefError) throw ksefError;
    if (!ksefInvoice?.transferred_to_invoice_id) {
      throw new Error("Faktura nie jest przypisana do żadnego działu");
    }

    const invoiceId = ksefInvoice.transferred_to_invoice_id;

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, google_drive_id, user_drive_file_id")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invoiceError) throw invoiceError;

    console.log(`Invoice ${invoiceId}: google_drive_id=${invoice?.google_drive_id}, user_drive_file_id=${invoice?.user_drive_file_id}`);

    if (invoice?.google_drive_id || invoice?.user_drive_file_id) {
      const accessToken = await getGoogleAccessToken(supabase);

      if (accessToken) {
        const fileIdsToDelete = [...new Set([invoice.google_drive_id, invoice.user_drive_file_id].filter(Boolean))];
        for (const fileId of fileIdsToDelete) {
          console.log(`Deleting Drive file: ${fileId}`);
          await deleteFromDrive(fileId, accessToken);
        }
        console.log("Drive files deleted");
      } else {
        console.warn("No Google access token available, skipping Drive deletion");
      }
    } else {
      console.log("No Drive file IDs found on invoice, skipping Drive deletion");
    }

    const { error: deleteInvoiceError } = await supabase
      .from("invoices")
      .delete()
      .eq("id", invoiceId);

    if (deleteInvoiceError) throw deleteInvoiceError;

    console.log(`Invoice ${invoiceId} deleted from DB`);

    const { error: updateKsefError } = await supabase
      .from("ksef_invoices")
      .update({
        transferred_to_invoice_id: null,
        transferred_to_department_id: null,
        transferred_at: null,
      })
      .eq("id", ksefInvoiceId);

    if (updateKsefError) throw updateKsefError;

    console.log(`KSEF invoice ${ksefInvoiceId} reverted successfully`);

    return new Response(
      JSON.stringify({ success: true, message: "Przypisanie faktury zostało cofnięte" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Revert error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
