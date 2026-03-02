import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
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

async function findOrCreateFolder(folderName: string, parentFolderId: string, accessToken: string): Promise<string> {
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
    throw new Error(`Failed to create folder '${folderName}': ${createResponse.status}`);
  }

  const createData = await createResponse.json();
  return createData.id;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").trim();
}

function buildInvoiceFileName(
  invoiceNumber: string | null | undefined,
  supplierName: string | null | undefined,
  originalFileName: string
): string {
  const parts: string[] = [];

  if (invoiceNumber && String(invoiceNumber).trim().length > 0 && invoiceNumber !== "null") {
    parts.push(sanitizeFileName(String(invoiceNumber).trim()));
  }

  if (supplierName && String(supplierName).trim().length > 0 && supplierName !== "null") {
    parts.push(sanitizeFileName(String(supplierName).trim()));
  }

  if (parts.length === 0) {
    return originalFileName.endsWith(".pdf") ? originalFileName : originalFileName + ".pdf";
  }

  return parts.join(" - ") + ".pdf";
}

async function uploadFileToDriveFolder(
  fileBytes: Uint8Array,
  fileName: string,
  targetFolderId: string,
  issueDate: string | null | undefined,
  invoiceNumber: string | null | undefined,
  supplierName: string | null | undefined,
  accessToken: string
): Promise<string | null> {
  let folderId = targetFolderId;

  if (issueDate) {
    const date = new Date(issueDate);
    if (!isNaN(date.getTime())) {
      const year = String(date.getFullYear());
      const month = date.getMonth() + 1;
      const monthLabel = POLISH_MONTHS[month];
      const yearFolderId = await findOrCreateFolder(year, folderId, accessToken);
      folderId = await findOrCreateFolder(monthLabel, yearFolderId, accessToken);
    }
  }

  const finalFileName = buildInvoiceFileName(invoiceNumber, supplierName, fileName);

  const metadata = {
    name: finalFileName,
    mimeType: "application/pdf",
    parents: [folderId],
  };

  const fileBlob = new Blob([fileBytes], { type: "application/pdf" });
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
    const errText = await uploadResponse.text();
    throw new Error(`Drive upload failed: ${uploadResponse.status} - ${errText}`);
  }

  const uploadData = await uploadResponse.json();
  return uploadData.id;
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

interface DriveConfig {
  id: string;
  user_id: string;
  google_drive_folder_id: string;
  is_active: boolean;
  last_sync_at: string | null;
}

interface FolderMapping {
  id: string;
  user_id: string;
  folder_name: string;
  google_drive_folder_id: string;
  department_id: string;
  default_assignee_id: string | null;
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
  console.error("🚀 FUNCTION INVOKED - METHOD:", req.method, "URL:", req.url);

  if (req.method === "OPTIONS") {
    console.error("OPTIONS request - returning CORS headers");
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  console.error("POST request - starting sync process");

  try {
    console.error("=== SYNC DRIVE INVOICES START ===");
    console.error("Request method:", req.method);
    console.error("Request URL:", req.url);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    console.log("Environment variables loaded");

    const authHeader = req.headers.get("Authorization");
    console.log("Auth header present:", !!authHeader);

    if (!authHeader) {
      console.log("ERROR: Missing auth header");
      return new Response(
        JSON.stringify({ error: "Brak naglowka autoryzacji" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Importing Supabase client...");
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    console.log("Supabase client imported");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    let userId: string;

    if (token === supabaseServiceKey) {
      const body = await req.json().catch(() => ({}));
      if (!body.user_id) {
        return new Response(
          JSON.stringify({ error: "Brak user_id w trybie cron" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = body.user_id;
      console.log("Cron mode - syncing for user:", userId);
    } else {
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !user) {
        console.error("JWT verification failed:", userError?.message);
        return new Response(
          JSON.stringify({ error: "Nieautoryzowany: " + (userError?.message || "brak uzytkownika") }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = user.id;
      console.log("User authenticated, ID:", userId);
    }

    // Load folder mappings (new system with department assignments and default assignees)
    const { data: folderMappings, error: mappingError } = await supabase
      .from("user_drive_folder_mappings")
      .select("*, departments(manager_id, director_id)")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (mappingError) {
      throw new Error(`Blad ladowania mapowania folderow: ${mappingError.message}`);
    }

    // Fallback: Load legacy drive configs if no folder mappings exist
    const { data: driveConfigs, error: driveConfigError } = await supabase
      .from("user_drive_configs")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (driveConfigError) {
      throw new Error(`Blad ladowania konfiguracji Drive: ${driveConfigError.message}`);
    }

    // Prioritize folder mappings, fallback to legacy configs
    const foldersToSync = folderMappings && folderMappings.length > 0
      ? folderMappings
      : driveConfigs;

    if (!foldersToSync || foldersToSync.length === 0) {
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
      .eq("user_id", userId)
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

    console.log("OAuth config loaded:", {
      email: oauthConfig.email_address,
      hasAccessToken: !!oauthConfig.oauth_access_token,
      hasRefreshToken: !!oauthConfig.oauth_refresh_token,
      tokenExpiry: oauthConfig.oauth_token_expiry,
    });

    let accessToken = await getValidAccessToken(supabase, oauthConfig);
    console.log("Access token obtained, length:", accessToken?.length);

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, department_id")
      .eq("id", userId)
      .maybeSingle();

    let totalSynced = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const mistralApiKey = Deno.env.get("MISTRAL_API_KEY");

    if (!claudeApiKey && !mistralApiKey) {
      warnings.push("UWAGA: Brak kluczy API (ANTHROPIC_API_KEY lub MISTRAL_API_KEY) w Supabase. Faktury zostana zaimportowane, ale dane nie zostana automatycznie wyekstraktowane. Skonfiguruj klucze API w Dashboard Supabase -> Project Settings -> Edge Functions -> Secrets.");
    }

    // Determine if we're using folder mappings or legacy configs
    const isUsingMappings = folderMappings && folderMappings.length > 0;

    for (const folderConfig of foldersToSync) {
      try {
        const folderId = folderConfig.google_drive_folder_id;
        if (!folderId) {
          errors.push("Brak ID folderu Google Drive");
          continue;
        }

        // Get department ID and default assignee from mapping or fallback to user's default department
        const mappedDepartmentId = isUsingMappings
          ? (folderConfig as FolderMapping).department_id
          : profile?.department_id;

        // Determine uploaded_by: default_assignee_id > manager_id > director_id > userId
        let uploadedBy = userId; // Default to current user

        if (isUsingMappings) {
          const mapping = folderConfig as FolderMapping;

          if (mapping.default_assignee_id) {
            // Priorytet 1: użytkownik wybrany w mapowaniu
            uploadedBy = mapping.default_assignee_id;
            console.log(`Using default assignee from mapping: ${uploadedBy}`);
          } else if (mapping.departments) {
            // Priorytet 2: kierownik działu
            const dept = Array.isArray(mapping.departments) ? mapping.departments[0] : mapping.departments;
            if (dept?.manager_id) {
              uploadedBy = dept.manager_id;
              console.log(`Using department manager: ${uploadedBy}`);
            } else if (dept?.director_id) {
              // Priorytet 3: dyrektor działu
              uploadedBy = dept.director_id;
              console.log(`Using department director: ${uploadedBy}`);
            }
          }
        }

        const filesUrl =
          `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType='application/pdf'+and+trashed=false&fields=files(id,name,modifiedTime)&pageSize=50`;

        console.log("Fetching files from Drive folder:", folderId);
        console.log("Using access token (first 20 chars):", accessToken.substring(0, 20) + "...");

        let filesResponse = await fetch(filesUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        console.log("Drive API response status:", filesResponse.status);

        // If 401, try to refresh token and retry once
        if (filesResponse.status === 401) {
          console.log("Received 401 from Drive API - attempting to refresh token...");
          try {
            const newAccessToken = await refreshAccessToken(supabase, oauthConfig);
            console.log("Token refreshed successfully, retrying request...");

            filesResponse = await fetch(filesUrl, {
              headers: { Authorization: `Bearer ${newAccessToken}` },
            });

            console.log("Retry response status:", filesResponse.status);

            // Update accessToken for subsequent file downloads
            accessToken = newAccessToken;
          } catch (refreshError: any) {
            console.error("Failed to refresh token:", refreshError.message);
            errors.push(`Nie udalo sie odswiezyc tokena Google: ${refreshError.message}. Odlacz i polacz ponownie konto Google w Konfiguracji.`);
            continue;
          }
        }

        if (!filesResponse.ok) {
          const errBody = await filesResponse.text();
          console.error("Drive API error response:", errBody);
          console.error("Drive API status:", filesResponse.status);
          console.error("Folder ID attempted:", folderId);

          if (filesResponse.status === 403) {
            errors.push(
              `Brak dostepu do folderu Drive (403). Upewnij sie, ze masz dostep do tego folderu. Szczegoly: ${errBody.substring(0, 200)}`
            );
          } else if (filesResponse.status === 401) {
            errors.push(
              `Autoryzacja Google Drive wygasla (401). Odlacz i polacz ponownie konto Google w sekcji Konfiguracja.`
            );
          } else {
            errors.push(`Blad Google Drive API (${filesResponse.status}): ${errBody.substring(0, 200)}`);
          }
          continue;
        }

        console.log("Successfully fetched files list from Drive");

        const filesData = await filesResponse.json();
        const files = filesData.files || [];

        console.log(`📁 Found ${files.length} PDF files in folder ${folderId}`);
        if (files.length > 0) {
          console.log('📄 Files:', files.map((f: any) => f.name).join(', '));
        }

        for (const file of files) {
          console.log(`\n🔍 Processing file: ${file.name} (ID: ${file.id})`);

          const { data: existingInvoice } = await supabase
            .from("invoices")
            .select("id")
            .eq("uploaded_by", userId)
            .eq("file_hash", `drive:${file.id}`)
            .maybeSingle();

          if (existingInvoice) {
            console.log(`⏭️  Skipping ${file.name} - already exists by file_hash`);
            continue;
          }

          const { data: existingByName } = await supabase
            .from("invoices")
            .select("id")
            .eq("uploaded_by", userId)
            .eq("invoice_number", file.name.replace(".pdf", ""))
            .maybeSingle();

          if (existingByName) {
            console.log(`⏭️  Skipping ${file.name} - already exists by invoice_number`);
            continue;
          }

          console.log(`📥 Downloading and importing ${file.name}...`);

          const fileUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
          const fileResponse = await fetch(fileUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!fileResponse.ok) {
            console.error(`❌ Failed to download file ${file.name}: ${fileResponse.status}`);
            errors.push(`Nie udało się pobrać pliku ${file.name}: ${fileResponse.status}`);
            continue;
          }

          console.log(`✅ File downloaded successfully`);

          const fileBuffer = await fileResponse.arrayBuffer();
          const fileBytes = new Uint8Array(fileBuffer);
          const base64 = uint8ToBase64(fileBytes);
          const fileHash = `drive:${file.id}`;

          const filePath = `invoices/${userId}/${Date.now()}_${file.name}`;
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

          console.log(`💾 Inserting invoice to database...`);
          console.log(`   - Invoice number: ${file.name.replace(".pdf", "")}`);
          console.log(`   - Department ID: ${mappedDepartmentId || 'null'}`);
          console.log(`   - Uploaded by (owner): ${uploadedBy}`);
          console.log(`   - Synced by user: ${userId}`);
          console.log(`   - File hash: ${fileHash}`);

          const { data: invoiceData, error: insertError } = await supabase
            .from("invoices")
            .insert({
              invoice_number: file.name.replace(".pdf", ""),
              supplier_name: null,
              gross_amount: null,
              uploaded_by: uploadedBy,
              department_id: mappedDepartmentId || null,
              status: "draft",
              pdf_base64: base64,
              file_url: publicUrl,
              source: "google_drive",
              file_hash: fileHash,
              user_drive_file_id: file.id,
              drive_owner_user_id: userId,
            })
            .select("id")
            .single();

          if (insertError) {
            console.error(`❌ Failed to insert invoice ${file.name}:`, insertError);

            // Check if it's a duplicate file hash error
            if (insertError.message && insertError.message.includes('idx_invoices_file_hash_per_user')) {
              errors.push(`Pominięto ${file.name} - ten plik został już wcześniej dodany`);
            }
            // Check if it's a foreign key constraint error (notifications)
            else if (insertError.message && insertError.message.includes('notifications_invoice_id_fkey')) {
              errors.push(`Błąd zapisu ${file.name} - problem z notyfikacjami. Spróbuj ponownie.`);
            }
            // Generic error
            else {
              errors.push(`Nie udało się zapisać faktury ${file.name}: ${insertError.message}`);
            }
            continue;
          }

          console.log(`✅ Invoice inserted with ID: ${invoiceData?.id}`);

          if (invoiceData?.id) {
            try {
              console.log(`Processing OCR for invoice ${invoiceData.id} from ${file.name}`);

              const ocrPayload: any = {
                invoiceId: invoiceData.id,
              };

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
                .select("department_id, invoice_number, supplier_name, issue_date")
                .eq("id", invoiceData.id)
                .maybeSingle();

              const deptId = updatedInvoice?.department_id || profile?.department_id;
              let movedToDeptFolder = false;

              if (deptId) {
                const { data: dept } = await supabase
                  .from("departments")
                  .select("google_drive_draft_folder_id, name")
                  .eq("id", deptId)
                  .maybeSingle();

                const targetFolder = dept?.google_drive_draft_folder_id;

                if (targetFolder) {
                  try {
                    const newFileId = await uploadFileToDriveFolder(
                      fileBytes,
                      file.name,
                      targetFolder,
                      updatedInvoice?.issue_date,
                      updatedInvoice?.invoice_number,
                      updatedInvoice?.supplier_name,
                      accessToken
                    );

                    if (newFileId) {
                      await supabase
                        .from("invoices")
                        .update({ user_drive_file_id: newFileId })
                        .eq("id", invoiceData.id);

                      console.log(`✓ Uploaded ${file.name} to department folder (with year/month subfolders): ${dept?.name}, new file ID: ${newFileId}`);
                      movedToDeptFolder = true;
                    }
                  } catch (uploadErr: any) {
                    console.warn(`Upload to department folder failed for ${file.name}:`, uploadErr.message);
                  }
                }
              }

              // Always delete from private folder - invoice is now in the system
              try {
                const deleteResp = await fetch(
                  `https://www.googleapis.com/drive/v3/files/${file.id}`,
                  {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${accessToken}` },
                  }
                );
                if (deleteResp.ok || deleteResp.status === 204) {
                  console.log(`🗑️  Deleted ${file.name} from user's private folder (moved to dept: ${movedToDeptFolder})`);
                } else {
                  const delErrBody = await deleteResp.text();
                  console.warn(`Could not delete ${file.name} from private folder: ${deleteResp.status} - ${delErrBody}`);
                }
              } catch (delErr: any) {
                console.warn(`Delete from private folder failed for ${file.name}:`, delErr.message);
              }
            } catch (driveErr: any) {
              console.error(`Drive move to department folder failed for ${file.name}:`, driveErr.message);
            }
          }

          totalSynced++;
          console.log(`✅ Successfully synced ${file.name} - Total synced so far: ${totalSynced}`);
        }

        console.log(`\n📊 Finished processing folder ${folderId} - Synced ${totalSynced} invoices from this folder`);

        // Update last_sync_at for the appropriate table
        if (isUsingMappings) {
          await supabase
            .from("user_drive_folder_mappings")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("id", folderConfig.id);
        } else {
          await supabase
            .from("user_drive_configs")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("id", folderConfig.id);
        }
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
