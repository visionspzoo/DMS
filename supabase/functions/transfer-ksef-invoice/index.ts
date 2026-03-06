import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TransferRequest {
  ksefInvoiceId: string;
  departmentId: string;
  userId?: string;
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

async function getGoogleAccessToken(supabase: any, userId: string): Promise<string | null> {
  const { data: configs } = await supabase
    .from("user_email_configs")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("provider", "google_workspace")
    .limit(1);

  if (!configs || configs.length === 0) {
    const { data: anyConfigs } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("is_active", true)
      .eq("provider", "google_workspace")
      .limit(1);

    if (!anyConfigs || anyConfigs.length === 0) {
      return null;
    }

    const config = anyConfigs[0] as OAuthConfig;
    const expiryTime = config.oauth_token_expiry ? new Date(config.oauth_token_expiry).getTime() : 0;
    if (Date.now() >= expiryTime - 5 * 60 * 1000) {
      return await refreshOAuthToken(supabase, config);
    }
    return config.oauth_access_token;
  }

  const config = configs[0] as OAuthConfig;
  const expiryTime = config.oauth_token_expiry ? new Date(config.oauth_token_expiry).getTime() : 0;
  if (Date.now() >= expiryTime - 5 * 60 * 1000) {
    return await refreshOAuthToken(supabase, config);
  }
  return config.oauth_access_token;
}

const POLISH_MONTHS: Record<number, string> = {
  1: "01 - Styczen", 2: "02 - Luty", 3: "03 - Marzec", 4: "04 - Kwiecien",
  5: "05 - Maj", 6: "06 - Czerwiec", 7: "07 - Lipiec", 8: "08 - Sierpien",
  9: "09 - Wrzesien", 10: "10 - Pazdziernik", 11: "11 - Listopad", 12: "12 - Grudzien",
};

async function findOrCreateFolder(folderName: string, parentId: string, accessToken: string): Promise<string> {
  const escaped = folderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = `name='${escaped}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const createData = await createRes.json();
  return createData.id;
}

async function resolveYearMonthFolder(baseFolderId: string, issueDate: string | null, accessToken: string): Promise<string> {
  if (!issueDate) return baseFolderId;
  const date = new Date(issueDate);
  if (isNaN(date.getTime())) return baseFolderId;
  const year = String(date.getFullYear());
  const monthLabel = POLISH_MONTHS[date.getMonth() + 1];
  const yearFolderId = await findOrCreateFolder(year, baseFolderId, accessToken);
  return await findOrCreateFolder(monthLabel, yearFolderId, accessToken);
}

async function uploadToDrive(
  accessToken: string,
  fileName: string,
  pdfBase64: string,
  folderId: string
): Promise<{ fileId: string; webViewLink: string } | null> {
  const binaryString = atob(pdfBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const fileBlob = new Blob([bytes], { type: "application/pdf" });

  const cleanFolderId = folderId.replace(/\/folders\/([a-zA-Z0-9_-]+).*/, "$1").replace(/^.*id=([a-zA-Z0-9_-]+).*/, "$1");
  const actualFolderId = cleanFolderId.match(/^[a-zA-Z0-9_-]+$/) ? cleanFolderId : folderId;

  const metadata = {
    name: fileName,
    mimeType: "application/pdf",
    parents: [actualFolderId],
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
    console.error(`Drive upload API error ${uploadResponse.status}: ${errorText}`);
    return null;
  }

  const data = await uploadResponse.json();
  return { fileId: data.id, webViewLink: data.webViewLink };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { ksefInvoiceId, departmentId, userId }: TransferRequest = await req.json();
    console.log(`Transfer request:`, { ksefInvoiceId, departmentId, userId });

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    let uploaderId = null;

    if (token) {
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        uploaderId = user?.id;
        console.log(`Authenticated user ID: ${uploaderId}`);
      } catch (error) {
        console.warn("Could not extract user from token");
      }
    }

    // 1. Get KSEF invoice
    const { data: ksefInvoice, error: ksefError } = await supabase
      .from("ksef_invoices")
      .select("*")
      .eq("id", ksefInvoiceId)
      .single();

    if (ksefError || !ksefInvoice) {
      throw new Error(`KSEF invoice not found: ${ksefError?.message}`);
    }

    console.log(`Found KSEF invoice: ${ksefInvoice.invoice_number}`);

    // 2. Get department info
    const { data: department, error: deptError } = await supabase
      .from("departments")
      .select("name, google_drive_draft_folder_id, manager_id, director_id")
      .eq("id", departmentId)
      .single();

    if (deptError || !department) {
      throw new Error(`Department not found: ${deptError?.message}`);
    }

    console.log(`Found department: ${department.name}`);

    // 3. Get PDF - use existing from database, or try to download
    let pdfBase64 = ksefInvoice.pdf_base64;

    if (!pdfBase64) {
      console.log("No PDF in database, attempting download from KSEF...");
      try {
        const pdfParams = new URLSearchParams({
          path: `/api/external/invoices/${encodeURIComponent(ksefInvoice.ksef_reference_number)}/pdf-base64`,
        });

        const pdfResponse = await fetch(`${supabaseUrl}/functions/v1/ksef-proxy?${pdfParams}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${supabaseAnonKey}`,
            "Content-Type": "application/json",
          },
        });

        if (pdfResponse.ok) {
          const pdfData = await pdfResponse.json();
          if (pdfData.success && pdfData.data?.base64) {
            pdfBase64 = pdfData.data.base64;
            console.log(`PDF downloaded from KSEF`);
            await supabase.from("ksef_invoices").update({ pdf_base64: pdfBase64 }).eq("id", ksefInvoice.id);
          }
        }
      } catch (pdfError: any) {
        console.warn("PDF download failed:", pdfError.message);
      }
    }

    // 4. If still no PDF, try generating from XML content
    if (!pdfBase64 && ksefInvoice.xml_content) {
      console.log("Generating PDF from XML content...");
      try {
        const genResponse = await fetch(`${supabaseUrl}/functions/v1/generate-ksef-pdf`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseAnonKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            xml: ksefInvoice.xml_content,
            ksefNumber: ksefInvoice.ksef_reference_number,
          }),
        });

        if (genResponse.ok) {
          const pdfArrayBuffer = await genResponse.arrayBuffer();
          pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfArrayBuffer)));
          console.log(`PDF generated from XML (${pdfArrayBuffer.byteLength} bytes)`);
          await supabase.from("ksef_invoices").update({ pdf_base64: pdfBase64 }).eq("id", ksefInvoice.id);
        }
      } catch (genError: any) {
        console.warn("PDF generation from XML failed:", genError.message);
      }
    }

    // 5. Get exchange rate if needed
    let exchangeRate = 1;
    let plnGrossAmount = ksefInvoice.gross_amount;

    if (ksefInvoice.currency !== "PLN" && ksefInvoice.issue_date) {
      try {
        const rateResponse = await fetch(`${supabaseUrl}/functions/v1/get-exchange-rate`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseAnonKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            currency: ksefInvoice.currency,
            date: ksefInvoice.issue_date,
          }),
        });

        if (rateResponse.ok) {
          const rateData = await rateResponse.json();
          exchangeRate = rateData.rate;
          plnGrossAmount = ksefInvoice.gross_amount * exchangeRate;
        }
      } catch (err) {
        console.error("Error fetching exchange rate:", err);
      }
    }

    // 6. Find appropriate approver for department if userId not provided
    let appropriateApproverId = userId || null;

    // Use manager_id and director_id directly from the departments table (authoritative source)
    // Directors are assigned to departments via departments.director_id, NOT via profiles.department_id
    const deptManagerId: string | null = department.manager_id || null;
    const deptDirectorId: string | null = department.director_id || null;

    if (!appropriateApproverId) {
      appropriateApproverId = deptManagerId || deptDirectorId || null;
      if (appropriateApproverId) {
        console.log("Using dept manager/director as approver:", appropriateApproverId);
      } else {
        try {
          const { data: approverData } = await supabase.rpc("get_next_approver_in_department", {
            dept_id: departmentId,
            user_role: null,
          });
          if (approverData) {
            appropriateApproverId = approverData;
            console.log("Found appropriate approver via RPC:", appropriateApproverId);
          }
        } catch (err) {
          console.error("Error finding approver:", err);
        }
      }
    }

    // 7. Create invoice record (without Drive URL yet)
    const taxAmount = ksefInvoice.tax_amount || (ksefInvoice.gross_amount - ksefInvoice.net_amount);
    // invoiceOwner should be the department's manager or director, NOT the logged-in user
    // The logged-in user (uploaderId) might be an admin fetching invoices from a different dept
    const invoiceOwner = deptManagerId || deptDirectorId || userId || ksefInvoice.fetched_by;

    const invoiceData: any = {
      invoice_number: ksefInvoice.invoice_number,
      supplier_name: ksefInvoice.supplier_name || "Brak nazwy",
      supplier_nip: ksefInvoice.supplier_nip,
      buyer_name: ksefInvoice.buyer_name || null,
      buyer_nip: ksefInvoice.buyer_nip || null,
      gross_amount: ksefInvoice.gross_amount,
      net_amount: ksefInvoice.net_amount,
      tax_amount: taxAmount,
      currency: ksefInvoice.currency,
      issue_date: ksefInvoice.issue_date,
      status: "waiting",
      uploaded_by: invoiceOwner,
      department_id: departmentId,
      file_url: null,
      pdf_base64: pdfBase64,
      description: "Faktura z KSEF",
      pln_gross_amount: plnGrossAmount,
      exchange_rate: exchangeRate,
      source: "ksef",
      google_drive_id: null,
      current_approver_id: appropriateApproverId,
    };

    console.log(`Creating invoice:`, {
      uploaded_by: invoiceData.uploaded_by,
      department_id: invoiceData.department_id,
      invoice_number: invoiceData.invoice_number,
    });

    const { data: newInvoice, error: insertError } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select()
      .single();

    if (insertError) {
      throw new Error(`Insert failed: ${insertError.message} | code: ${insertError.code} | details: ${insertError.details}`);
    }

    console.log(`Invoice created with ID: ${newInvoice.id}`);

    // 8. Update KSEF invoice record
    const updateData: any = {
      transferred_to_invoice_id: newInvoice.id,
      transferred_to_department_id: departmentId,
      transferred_at: new Date().toISOString(),
      assigned_to_department_at: new Date().toISOString(),
    };

    if (ksefInvoice.xml_content) updateData.xml_content = ksefInvoice.xml_content;
    if (pdfBase64) updateData.pdf_base64 = pdfBase64;

    const { error: updateError } = await supabase
      .from("ksef_invoices")
      .update(updateData)
      .eq("id", ksefInvoiceId);

    if (updateError) throw updateError;

    // 9. Upload PDF to Google Drive synchronously (before returning response)
    if (pdfBase64 && department.google_drive_draft_folder_id) {
      try {
        console.log(`Uploading PDF to Google Drive for invoice ${newInvoice.id}...`);

        const userIdsToTry = [
          userId,
          invoiceOwner,
          ksefInvoice.fetched_by,
          department.manager_id,
          department.director_id,
        ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

        let accessToken: string | null = null;

        for (const uid of userIdsToTry) {
          try {
            accessToken = await getGoogleAccessToken(supabase, uid);
            if (accessToken) {
              console.log(`Got Google access token for user ${uid}`);
              break;
            }
          } catch (err: any) {
            console.warn(`Could not get token for user ${uid}: ${err.message}`);
          }
        }

        if (!accessToken) {
          console.error("No Google access token available from any user");
        } else {
          const targetFolderId = await resolveYearMonthFolder(
            department.google_drive_draft_folder_id,
            ksefInvoice.issue_date,
            accessToken
          );

          const supplierName = (ksefInvoice.supplier_name || '').replace(/[<>:"/\\|?*]/g, '').trim();
          const invoiceNum = (ksefInvoice.invoice_number || '').replace(/\//g, '_').replace(/[<>:"|?*]/g, '').trim();
          const driveFileName = supplierName
            ? `${invoiceNum} - ${supplierName}.pdf`
            : `${invoiceNum}.pdf`;

          const result = await uploadToDrive(
            accessToken,
            driveFileName,
            pdfBase64,
            targetFolderId
          );

          if (result) {
            console.log(`PDF uploaded to Google Drive: ${result.fileId}`);
            await supabase
              .from("invoices")
              .update({
                google_drive_id: result.fileId,
                user_drive_file_id: result.fileId,
                file_url: `https://drive.google.com/file/d/${result.fileId}/view`,
              })
              .eq("id", newInvoice.id);
            console.log(`Invoice updated with Drive file ID: ${result.fileId}`);
          } else {
            console.error("Drive upload returned no result");
          }
        }
      } catch (driveError: any) {
        console.error("Drive upload error:", driveError.message);
      }
    }

    // 10. Run OCR on the transferred invoice
    if (pdfBase64) {
      EdgeRuntime.waitUntil((async () => {
        try {
          console.log("Running OCR for KSEF invoice...");
          const ocrResponse = await fetch(`${supabaseUrl}/functions/v1/process-invoice-ocr`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseAnonKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              pdfBase64: pdfBase64,
              invoiceId: newInvoice.id,
            }),
          });

          if (ocrResponse.ok) {
            console.log("OCR completed successfully");
          } else {
            const ocrError = await ocrResponse.json();
            console.error("OCR failed:", ocrError);
          }
        } catch (ocrError: any) {
          console.error("OCR error:", ocrError.message);
        }
      })());
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoice: newInvoice,
        message: "Faktura została przeniesiona pomyślnie",
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Transfer error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Nie udało się przenieść faktury",
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
