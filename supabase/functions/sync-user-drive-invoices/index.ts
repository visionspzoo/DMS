import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface UserDriveConfig {
  id: string;
  user_id: string;
  google_drive_folder_id: string;
  is_active: boolean;
  last_sync_at: string | null;
}

interface UserProfile {
  id: string;
  email: string;
  department_id: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const googleApiKey = Deno.env.get('GOOGLE_API_KEY');
    const googleServiceAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');

    if (!googleApiKey && !googleServiceAccount) {
      throw new Error('Google API credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: configs, error: configError } = await supabase
      .from('user_drive_configs')
      .select('*')
      .eq('is_active', true);

    if (configError) {
      throw configError;
    }

    if (!configs || configs.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No active user drive configurations found', synced: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let totalSynced = 0;
    const syncResults = [];

    for (const config of configs as UserDriveConfig[]) {
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, email, department_id')
          .eq('id', config.user_id)
          .single();

        if (profileError || !profile) {
          console.error(`Profile not found for user ${config.user_id}`);
          continue;
        }

        const userProfile = profile as UserProfile;

        const filesUrl = `https://www.googleapis.com/drive/v3/files?q='${config.google_drive_folder_id}'+in+parents+and+mimeType='application/pdf'&key=${googleApiKey}`;

        const filesResponse = await fetch(filesUrl);

        if (!filesResponse.ok) {
          throw new Error(`Google Drive API error: ${filesResponse.statusText}`);
        }

        const filesData = await filesResponse.json();
        const files = filesData.files || [];

        let syncedCount = 0;

        for (const file of files) {
          const { data: existingInvoice } = await supabase
            .from('invoices')
            .select('id')
            .eq('uploaded_by', config.user_id)
            .eq('invoice_number', file.name)
            .maybeSingle();

          if (existingInvoice) {
            continue;
          }

          const fileUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${googleApiKey}`;
          const fileResponse = await fetch(fileUrl);

          if (!fileResponse.ok) {
            console.error(`Failed to download file ${file.name}`);
            continue;
          }

          const fileBlob = await fileResponse.blob();
          const fileBuffer = await fileBlob.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

          const invoiceData = {
            invoice_number: file.name.replace('.pdf', ''),
            supplier_name: 'Imported from Drive',
            gross_amount: 0,
            uploaded_by: config.user_id,
            department_id: userProfile.department_id,
            status: 'draft',
            description: `Automatycznie zaimportowano z Google Drive`,
            pdf_base64: base64,
            source: 'google_drive',
          };

          const { error: insertError } = await supabase
            .from('invoices')
            .insert(invoiceData);

          if (insertError) {
            console.error(`Failed to insert invoice ${file.name}:`, insertError);
            continue;
          }

          syncedCount++;
        }

        await supabase
          .from('user_drive_configs')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('id', config.id);

        totalSynced += syncedCount;
        syncResults.push({
          user_id: config.user_id,
          folder_id: config.google_drive_folder_id,
          synced: syncedCount,
        });

      } catch (error) {
        console.error(`Error syncing for user ${config.user_id}:`, error);
        syncResults.push({
          user_id: config.user_id,
          error: error.message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Sync completed',
        total_configs: configs.length,
        total_synced: totalSynced,
        results: syncResults,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sync-user-drive-invoices:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
