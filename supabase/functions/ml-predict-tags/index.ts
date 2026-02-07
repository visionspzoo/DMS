import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PredictRequest {
  invoice_id: string;
  supplier_name?: string;
  supplier_nip?: string;
  description?: string;
  gross_amount?: number;
  currency?: string;
  department_id?: string;
  force_refresh?: boolean;
}

interface Prediction {
  tag_id: string;
  tag_name: string;
  confidence: number;
  reasoning: string;
  source: string;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function predictWithClaude(
  apiKey: string,
  allLearning: any[],
  recentInvoices: any[],
  allTags: any[],
  existingTagIds: string[],
  existingTagNames: string[],
  invoice: PredictRequest
): Promise<Prediction[]> {
  const availableTagNames = allTags
    .filter((t: any) => !existingTagIds.includes(t.id))
    .map((t: any) => `"${t.name}" (id: ${t.id})`);

  if (availableTagNames.length === 0) return [];

  let historyContext = "(brak danych historycznych)";
  if (allLearning.length > 0) {
    const grouped: Record<string, string[]> = {};
    for (const entry of allLearning) {
      const key = entry.vendor_name || "(nieznany)";
      if (!grouped[key]) grouped[key] = [];
      const nipInfo = entry.supplier_nip ? ` [NIP: ${entry.supplier_nip}]` : "";
      grouped[key].push(
        `${entry.tags?.name} (${entry.frequency}x, zakres: ${entry.amount_bucket || "?"}${nipInfo})`
      );
    }
    historyContext = Object.entries(grouped)
      .map(([vendor, tags]) => `- "${vendor}": ${tags.join(", ")}`)
      .join("\n");
  }

  let recentContext = "(brak podobnych faktur)";
  if (recentInvoices.length > 0) {
    recentContext = recentInvoices
      .map(
        (inv: any) =>
          `- Kwota: ${inv.gross_amount || "?"} ${inv.currency || "PLN"}, Opis: "${inv.description || "-"}", Tagi: [${(inv.tags || []).join(", ")}]`
      )
      .join("\n");
  }

  const prompt = `Jestes systemem ML do predykcji tagow faktur. Przeanalizuj wzorce historyczne i zasugeruj tagi.

WZORCE HISTORYCZNE (dostawca -> tagi z czestotliwoscia):
${historyContext}

OSTATNIE FAKTURY OD TEGO SAMEGO DOSTAWCY:
${recentContext}

NOWA FAKTURA:
- Dostawca: ${invoice.supplier_name || "(nieznany)"}
- NIP: ${invoice.supplier_nip || "(brak)"}
- Opis: ${invoice.description || "(brak)"}
- Kwota brutto: ${invoice.gross_amount || "(brak)"} ${invoice.currency || "PLN"}

JUZ PRZYPISANE TAGI: [${existingTagNames.join(", ") || "brak"}]

DOSTEPNE TAGI:
${availableTagNames.join("\n")}

Zasady:
- NIE sugeruj tagow juz przypisanych
- Minimum pewnosc 0.5
- Maksymalnie 5 sugestii
- Sortuj malejaco wg pewnosci
- reason po polsku, krotko (max 15 slow)

Zwroc TYLKO tablice JSON:
[{"tag_id":"uuid","tag_name":"nazwa","confidence":0.85,"reason":"krotkie uzasadnienie"}]

Jesli brak danych, zwroc: []`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    console.error("Claude API error:", await response.text());
    return [];
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "[]";
  const cleanText = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleanText);
    return parsed
      .filter(
        (p: any) =>
          p.tag_id &&
          p.confidence >= 0.5 &&
          allTags.some((t: any) => t.id === p.tag_id) &&
          !existingTagIds.includes(p.tag_id)
      )
      .map((p: any) => ({
        tag_id: p.tag_id,
        tag_name: p.tag_name,
        confidence: Math.min(p.confidence, 0.99),
        reasoning: p.reason || "Sugestia AI",
        source: "ml_claude",
      }));
  } catch {
    console.error("Failed to parse Claude response:", cleanText);
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase configuration missing");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ error: "Invalid token" }, 401);
    }

    const body: PredictRequest = await req.json();
    const { invoice_id, force_refresh } = body;

    if (!invoice_id) {
      return jsonResponse({ error: "invoice_id is required" }, 400);
    }

    if (!force_refresh) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: cached } = await supabase
        .from("ml_tag_predictions")
        .select(
          "id, invoice_id, tag_id, confidence, source, reasoning, applied, dismissed, tags:tag_id(id, name, color)"
        )
        .eq("invoice_id", invoice_id)
        .eq("dismissed", false)
        .eq("applied", false)
        .gte("created_at", cutoff);

      if (cached && cached.length > 0) {
        return jsonResponse({ predictions: cached, cached: true });
      }
    }

    const { data: existingTags } = await supabase
      .from("invoice_tags")
      .select("tag_id, tags:tag_id(id, name)")
      .eq("invoice_id", invoice_id);

    const existingTagIds = (existingTags || []).map((t: any) => t.tag_id);
    const existingTagNames = (existingTags || [])
      .map((t: any) => t.tags?.name)
      .filter(Boolean);

    const { data: allTags } = await supabase
      .from("tags")
      .select("id, name, color")
      .order("name");

    if (!allTags || allTags.length === 0) {
      return jsonResponse({ predictions: [], message: "No tags available" });
    }

    let predictions: Prediction[] = [];
    const { supplier_name, supplier_nip } = body;

    if (supplier_name?.trim()) {
      const { data: vendorLearning } = await supabase
        .from("tag_learning")
        .select(
          "vendor_name, supplier_nip, tag_id, frequency, tags:tag_id(id, name, color)"
        )
        .ilike("vendor_name", supplier_name.trim())
        .order("frequency", { ascending: false });

      if (vendorLearning) {
        for (const entry of vendorLearning) {
          if (existingTagIds.includes(entry.tag_id) || !entry.tags) continue;
          const conf = Math.min(0.9, 0.6 + entry.frequency * 0.05);
          if (conf >= 0.5) {
            predictions.push({
              tag_id: entry.tags.id,
              tag_name: entry.tags.name,
              confidence: conf,
              reasoning: `Dostawca "${entry.vendor_name}" - ${entry.frequency}x`,
              source: "vendor_match",
            });
          }
        }
      }
    }

    if (supplier_nip?.trim()) {
      const { data: nipLearning } = await supabase
        .from("tag_learning")
        .select(
          "vendor_name, supplier_nip, tag_id, frequency, tags:tag_id(id, name, color)"
        )
        .eq("supplier_nip", supplier_nip.trim())
        .order("frequency", { ascending: false });

      if (nipLearning) {
        for (const entry of nipLearning) {
          if (existingTagIds.includes(entry.tag_id) || !entry.tags) continue;
          const existing = predictions.find((p) => p.tag_id === entry.tag_id);
          const conf = Math.min(0.95, 0.7 + entry.frequency * 0.05);
          if (existing) {
            existing.confidence = Math.max(existing.confidence, conf);
            existing.source = "nip_match";
            existing.reasoning = `NIP ${supplier_nip} - ${entry.frequency}x`;
          } else if (conf >= 0.5) {
            predictions.push({
              tag_id: entry.tags.id,
              tag_name: entry.tags.name,
              confidence: conf,
              reasoning: `NIP ${supplier_nip} - ${entry.frequency}x`,
              source: "nip_match",
            });
          }
        }
      }
    }

    if (
      anthropicApiKey &&
      predictions.length < 3 &&
      (supplier_name || supplier_nip || body.description)
    ) {
      try {
        const { data: allLearning } = await supabase
          .from("tag_learning")
          .select(
            "vendor_name, supplier_nip, tag_id, frequency, amount_bucket, tags:tag_id(name)"
          )
          .gt("frequency", 0)
          .order("frequency", { ascending: false })
          .limit(50);

        let recentInvoices: any[] = [];
        if (supplier_name) {
          const { data: recent } = await supabase
            .from("invoices")
            .select(
              "id, supplier_name, description, gross_amount, currency"
            )
            .eq("supplier_name", supplier_name.trim())
            .neq("id", invoice_id)
            .order("created_at", { ascending: false })
            .limit(10);

          if (recent) {
            for (const inv of recent) {
              const { data: invTags } = await supabase
                .from("invoice_tags")
                .select("tags:tag_id(name)")
                .eq("invoice_id", inv.id);
              inv.tags = (invTags || [])
                .map((t: any) => t.tags?.name)
                .filter(Boolean);
            }
            recentInvoices = recent;
          }
        }

        const claudePredictions = await predictWithClaude(
          anthropicApiKey,
          allLearning || [],
          recentInvoices,
          allTags,
          existingTagIds,
          existingTagNames,
          body
        );

        for (const cp of claudePredictions) {
          const existing = predictions.find((p) => p.tag_id === cp.tag_id);
          if (existing) {
            existing.confidence = Math.min(
              0.99,
              Math.max(existing.confidence, cp.confidence)
            );
            existing.reasoning += ` | AI: ${cp.reasoning}`;
          } else {
            predictions.push(cp);
          }
        }
      } catch (claudeErr) {
        console.error("Claude ML prediction error:", claudeErr);
      }
    }

    predictions.sort((a, b) => b.confidence - a.confidence);
    predictions = predictions.slice(0, 5);

    if (predictions.length > 0) {
      await supabase
        .from("ml_tag_predictions")
        .delete()
        .eq("invoice_id", invoice_id)
        .eq("applied", false)
        .eq("dismissed", false);

      const rows = predictions.map((p) => ({
        invoice_id,
        tag_id: p.tag_id,
        confidence: p.confidence,
        source: p.source,
        reasoning: p.reasoning,
      }));

      await supabase
        .from("ml_tag_predictions")
        .upsert(rows, { onConflict: "invoice_id,tag_id" });
    }

    const { data: finalPredictions } = await supabase
      .from("ml_tag_predictions")
      .select(
        "id, invoice_id, tag_id, confidence, source, reasoning, applied, dismissed, tags:tag_id(id, name, color)"
      )
      .eq("invoice_id", invoice_id)
      .eq("dismissed", false)
      .eq("applied", false)
      .order("confidence", { ascending: false });

    return jsonResponse({
      predictions: finalPredictions || [],
      cached: false,
    });
  } catch (error: any) {
    console.error("ML Predict Tags Error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});
