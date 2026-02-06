/*
  # Google OAuth Callback Handler

  This function handles the OAuth callback from Google,
  exchanges the authorization code for tokens,
  and saves them to the database.
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { code, redirect_uri } = await req.json();

    if (!code) {
      throw new Error("Missing authorization code");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      throw new Error(`Failed to exchange code: ${JSON.stringify(errorData)}`);
    }

    const tokens = await tokenResponse.json();

    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );

    if (!userInfoResponse.ok) {
      throw new Error("Failed to fetch user info");
    }

    const userInfo = await userInfoResponse.json();

    const expiryDate = new Date();
    expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

    const { error: insertError } = await supabase
      .from("user_email_configs")
      .insert({
        user_id: user.id,
        email_address: userInfo.email,
        provider: "google_workspace",
        oauth_access_token: tokens.access_token,
        oauth_refresh_token: tokens.refresh_token,
        oauth_token_expiry: expiryDate.toISOString(),
        is_active: true,
      });

    if (insertError) {
      throw new Error(`Failed to save config: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        email: userInfo.email,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Error in google-oauth-callback:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
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
