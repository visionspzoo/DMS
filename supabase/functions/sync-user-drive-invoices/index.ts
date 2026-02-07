import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmailConfig {
  id: string;
  user_id: string;
  email_address: string;
  oauth_access_token: string;
  oauth_refresh_token: string;
  oauth_token_expiry: string;
  is_active: boolean;
}

interface DriveConfig {
  id: string;
  user_id: string;
  google_drive_folder_id: string;
  is_active: boolean;
  last_sync_at: string | null;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

async function computeFileHash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function refreshAccessToken(
  supabase: any,
  config: EmailConfig
): Promise<string> {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!googleClientId || !googleClientSecret) {
    throw new Error(
      "Brak konfiguracji GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"
    );
  }

  if (!config.oauth_refresh_token) {
    throw new Error(
      "Brak refresh tokena. Odlacz i polacz ponownie konto Google."
    );
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
    throw new Error(
      `Nie udalo sie odswiezyc tokena Google (${tokenResponse.status}). Odlacz i polacz ponownie konto.`
    );
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Brak naglowka autoryzacji" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({
          error: "Nieautoryzowany: " + (userError?.message || "brak uzytkownika"),
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: driveConfigs, error: driveConfigError } = await supabase
      .from("user_drive_configs")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (driveConfigError) {
      throw new Error(`Blad ladowania konfiguracji Drive: ${driveConfigError.message}`);
    }

    if (!driveConfigs || driveConfigs.length === 0) {
      return new Response(
        JSON.stringify({
          message: "Brak aktywnych konfiguracji Google Drive",
          total_synced: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: emailConfigs, error: emailConfigError } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("provider", "google_workspace");

    if (emailConfigError || !emailConfigs || emailConfigs.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Brak polaczonego konta Google. Polacz konto Google w sekcji 'Synchronizacja email' w Konfiguracji, aby synchronizacja z Drive mogla dzialac.",
          total_synced: 0,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const oauthConfig = emailConfigs[0] as EmailConfig;
    const accessToken = await getValidAccessToken(supabase, oauthConfig);

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, department_id")
      .eq("id", user.id)
      .maybeSingle();

    let totalSynced = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const mistralApiKey = Deno.env.get("MISTRAL_API_KEY");

    if (!claudeApiKey && !mistralApiKey) {
      warnings.push("UWAGA: Brak kluczy API (ANTHROPIC_API_KEY lub MISTRAL_API_KEY) w Supabase. Faktury zostana zaimportowane, ale dane nie zostana automatycznie wyekstraktowane. Skonfiguruj klucze API w Dashboard Supabase -> Project Settings -> Edge Functions -> Secrets.");
    }

    for (const driveConfig of driveConfigs as DriveConfig[]) {
      try {
        const folderId = driveConfig.google_drive_folder_id;
        if (!folderId) {
          errors.push("Brak ID folderu Google Drive");
          continue;
        }

        const filesUrl =
          `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name,modifiedTime)&pageSize=50`;

        const filesResponse = await fetch(filesUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!filesResponse.ok) {
          const errBody = await filesResponse.text();
          console.error("Drive API error:", errBody);
          if (filesResponse.status === 403 || filesResponse.status === 401) {
            errors.push(
              "Brak dostepu do folderu Drive. Odlacz i polacz ponownie konto Google, aby przyznac uprawnienia do Drive."
            );
          } else {
            errors.push(`Blad Google Drive API: ${filesResponse.status}`);
          }
          continue;
        }

        const filesData = await filesResponse.json();
        const files = filesData.files || [];

        for (const file of files) {
          const { data: existingInvoice } = await supabase
            .from("invoices")
            .select("id")
            .eq("uploaded_by", user.id)
            .eq("file_hash", `drive:${file.id}`)
            .maybeSingle();

          if (existingInvoice) continue;

          const { data: existingByName } = await supabase
            .from("invoices")
            .select("id")
            .eq("uploaded_by", user.id)
            .eq("invoice_number", file.name.replace(".pdf", ""))
            .maybeSingle();

          if (existingByName) continue;

          const fileUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
          const fileResponse = await fetch(fileUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!fileResponse.ok) {
            console.error(`Failed to download file ${file.name}: ${fileResponse.status}`);
            continue;
          }

          const fileBuffer = await fileResponse.arrayBuffer();
          const fileBytes = new Uint8Array(fileBuffer);
          const base64 = uint8ToBase64(fileBytes);
          const fileHash = `drive:${file.id}`;

          const filePath = `invoices/${user.id}/${Date.now()}_${file.name}`;
          const { error: uploadError } = await supabase.storage
            .from("documents")
            .upload(filePath, fileBytes, {
              contentType: "application/pdf",
              upsert: false,
            });

          let publicUrl = null;
          if (!uploadError) {
            const {
              data: { publicUrl: url },
            } = supabase.storage.from("documents").getPublicUrl(filePath);
            publicUrl = url;
          }

          const { data: invoiceData, error: insertError } = await supabase
            .from("invoices")
            .insert({
              invoice_number: file.name.replace(".pdf", ""),
              supplier_name: "Przetwarzanie...",
              gross_amount: 0,
              uploaded_by: user.id,
              department_id: profile?.department_id || null,
              status: "draft",
              pdf_base64: base64,
              file_url: publicUrl,
              source: "google_drive",
              file_hash: fileHash,
            })
            .select("id")
            .single();

          if (insertError) {
            console.error(`Failed to insert invoice ${file.name}:`, insertError);
            continue;
          }

          if (invoiceData?.id) {
            try {
              console.log(`Processing OCR for invoice ${invoiceData.id} from ${file.name}`);

              const ocrPayload: any = {
                invoiceId: invoiceData.id,
              };

              // If publicUrl is available, use it; otherwise use base64
              if (publicUrl) {
                ocrPayload.fileUrl = publicUrl;
              } else {
                ocrPayload.pdfBase64 = base64;
              }

              const ocrResponse = await fetch(
                `${supabaseUrl}/functions/v1/process-invoice-ocr`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${supabaseServiceKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(ocrPayload),
                }
              );

              if (ocrResponse.ok) {
                const ocrData = await ocrResponse.json();
                console.log(`✓ OCR completed for ${file.name}`);

                if (ocrData.validationError) {
                  warnings.push(`${file.name}: ${ocrData.validationError}`);
                }

                if (ocrData.suggestedTags?.length > 0) {
                  for (const tag of ocrData.suggestedTags) {
                    await supabase
                      .from("invoice_tags")
                      .insert({
                        invoice_id: invoiceData.id,
                        tag_id: tag.id,
                      })
                      .then(() => {});
                  }
                }
              } else {
                const errorText = await ocrResponse.text();
                console.error(`OCR request failed for ${file.name}:`, errorText);
              }
            } catch (ocrErr: any) {
              console.error(`OCR failed for ${file.name}:`, ocrErr.message);
            }

            try {
              const { data: updatedInvoice } = await supabase
                .from("invoices")
                .select("department_id, invoice_number")
                .eq("id", invoiceData.id)
                .maybeSingle();

              const deptId = updatedInvoice?.department_id || profile?.department_id;

              if (deptId) {
                const { data: dept } = await supabase
                  .from("departments")
                  .select("google_drive_draft_folder_id, name")
                  .eq("id", deptId)
                  .maybeSingle();

                const targetFolder = dept?.google_drive_draft_folder_id;

                if (targetFolder) {
                  const driveFileName = updatedInvoice?.invoice_number
                    ? `${updatedInvoice.invoice_number}.pdf`
                    : file.name;

                  await fetch(
                    `${supabaseUrl}/functions/v1/upload-to-google-drive`,
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${supabaseServiceKey}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        fileBase64: base64,
                        fileName: driveFileName,
                        invoiceId: invoiceData.id,
                        folderId: targetFolder,
                        originalMimeType: "application/pdf",
                      }),
                    }
                  );
                }
              }
            } catch (driveErr: any) {
              console.error(`Drive upload failed for ${file.name}:`, driveErr.message);
            }
          }

          totalSynced++;
        }

        await supabase
          .from("user_drive_configs")
          .update({ last_sync_at: new Date().toISOString() })
          .eq("id", driveConfig.id);
      } catch (error: any) {
        console.error(`Error syncing Drive folder:`, error);
        errors.push(error.message);
      }
    }

    return new Response(
      JSON.stringify({
        message: `Zsynchronizowano ${totalSynced} faktur z Google Drive`,
        total_synced: totalSynced,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in sync-user-drive-invoices:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
