/*
  # Check OAuth Status

  Diagnostic function to check if user has valid OAuth configuration
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    // Check email configs
    const { data: emailConfigs, error: configError } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("user_id", user.id);

    console.log("Email configs query result:", { emailConfigs, configError });

    if (configError) {
      throw new Error(`Database error: ${configError.message}`);
    }

    const activeConfigs = emailConfigs?.filter(c => c.is_active && c.provider === "google_workspace") || [];

    return new Response(
      JSON.stringify({
        success: true,
        userId: user.id,
        userEmail: user.email,
        totalConfigs: emailConfigs?.length || 0,
        activeGoogleConfigs: activeConfigs.length,
        configs: emailConfigs?.map(c => ({
          id: c.id,
          email_address: c.email_address,
          provider: c.provider,
          is_active: c.is_active,
          hasAccessToken: !!c.oauth_access_token,
          hasRefreshToken: !!c.oauth_refresh_token,
          tokenExpiry: c.oauth_token_expiry,
        })) || [],
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Error checking OAuth status:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
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
