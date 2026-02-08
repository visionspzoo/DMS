import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface InvitationRequest {
  email: string;
  role: string;
  department_id?: string;
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Brak autoryzacji" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Nieautoryzowany" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*, department:departments(name)")
      .eq("id", user.id)
      .single();

    if (!profile || (!profile.is_admin && profile.role !== "director")) {
      return new Response(
        JSON.stringify({ success: false, error: "Brak uprawnień" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { email, role, department_id }: InvitationRequest = await req.json();

    if (!email || !role) {
      return new Response(
        JSON.stringify({ success: false, error: "Email i rola są wymagane" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const validRoles = ["specialist", "manager", "director", "ceo"];
    if (!validRoles.includes(role)) {
      return new Response(
        JSON.stringify({ success: false, error: "Nieprawidłowa rola" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: existingUser } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      return new Response(
        JSON.stringify({ success: false, error: "Użytkownik o tym emailu już istnieje" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: pendingInvitation } = await supabase
      .from("user_invitations")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingInvitation) {
      return new Response(
        JSON.stringify({ success: false, error: "Zaproszenie dla tego emaila już zostało wysłane" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: invitation, error: inviteError } = await supabase
      .from("user_invitations")
      .insert({
        email,
        invited_by: user.id,
        role,
        department_id: department_id || null,
      })
      .select()
      .single();

    if (inviteError) {
      console.error("Invitation creation error:", inviteError);
      return new Response(
        JSON.stringify({ success: false, error: "Błąd tworzenia zaproszenia" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: template } = await supabase
      .from("email_templates")
      .select("*")
      .eq("name", "user_invitation")
      .single();

    if (!template) {
      return new Response(
        JSON.stringify({ success: false, error: "Brak szablonu email" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let departmentName = "";
    if (department_id) {
      const { data: dept } = await supabase
        .from("departments")
        .select("name")
        .eq("id", department_id)
        .single();
      departmentName = dept?.name || "";
    }

    const roleNames: { [key: string]: string } = {
      specialist: "Specjalista",
      manager: "Kierownik",
      director: "Dyrektor",
      ceo: "Prezes",
    };

    const invitationLink = `${supabaseUrl.replace('https://', 'https://').replace('.supabase.co', '')}/accept-invitation?token=${invitation.invitation_token}`;

    let emailBody = template.body
      .replace(/\{\{invited_by_name\}\}/g, profile.full_name || profile.email)
      .replace(/\{\{company_name\}\}/g, "Twoja Firma")
      .replace(/\{\{email\}\}/g, email)
      .replace(/\{\{role\}\}/g, roleNames[role] || role)
      .replace(/\{\{invitation_link\}\}/g, invitationLink);

    if (departmentName) {
      emailBody = emailBody.replace(/\{\{#department\}\}/g, "").replace(/\{\{\/department\}\}/g, "");
      emailBody = emailBody.replace(/\{\{department\}\}/g, departmentName);
    } else {
      emailBody = emailBody.replace(/\{\{#department\}\}[\s\S]*?\{\{\/department\}\}/g, "");
    }

    const emailSubject = template.subject
      .replace(/\{\{company_name\}\}/g, "Twoja Firma");

    const sendGridApiKey = Deno.env.get("SENDGRID_API_KEY");

    if (sendGridApiKey) {
      const sendGridResponse = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${sendGridApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email }],
            subject: emailSubject,
          }],
          from: {
            email: Deno.env.get("SENDGRID_FROM_EMAIL") || "noreply@dms.com",
            name: "DMS System",
          },
          content: [{
            type: "text/html",
            value: emailBody,
          }],
        }),
      });

      if (!sendGridResponse.ok) {
        const errorText = await sendGridResponse.text();
        console.error("SendGrid error:", errorText);

        await supabase
          .from("user_invitations")
          .update({ status: "cancelled" })
          .eq("id", invitation.id);

        return new Response(
          JSON.stringify({
            success: false,
            error: "Błąd wysyłania emaila. Sprawdź konfigurację SendGrid.",
            details: errorText.substring(0, 200)
          }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      console.log(`Invitation email sent to ${email} via SendGrid`);
    } else {
      console.log(`SendGrid not configured. Invitation created but email not sent.`);
      console.log(`Invitation link: ${invitationLink}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: sendGridApiKey
          ? "Zaproszenie zostało wysłane"
          : "Zaproszenie utworzone (email nie został wysłany - brak konfiguracji SendGrid)",
        invitation_id: invitation.id,
        invitation_link: invitationLink,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in send-user-invitation:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Nieznany błąd serwera",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
