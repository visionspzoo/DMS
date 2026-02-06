import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    const claudeKey = Deno.env.get("ANTHROPIC_API_KEY");

    const allEnvVars = Object.keys(Deno.env.toObject());
    const apiRelatedVars = allEnvVars.filter(k =>
      k.includes('API') || k.includes('KEY') || k.includes('OPENAI') || k.includes('MISTRAL') || k.includes('ANTHROPIC')
    );

    return new Response(
      JSON.stringify({
        openai: openaiKey ? `Configured (${openaiKey.substring(0, 10)}...${openaiKey.substring(openaiKey.length - 4)})` : "NOT CONFIGURED",
        mistral: mistralKey ? `Configured (${mistralKey.substring(0, 10)}...${mistralKey.substring(mistralKey.length - 4)})` : "NOT CONFIGURED",
        claude: claudeKey ? `Configured (${claudeKey.substring(0, 10)}...${claudeKey.substring(claudeKey.length - 4)})` : "NOT CONFIGURED",
        apiRelatedEnvVars: apiRelatedVars,
        allEnvVarsCount: allEnvVars.length,
        timestamp: new Date().toISOString(),
      }, null, 2),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
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
