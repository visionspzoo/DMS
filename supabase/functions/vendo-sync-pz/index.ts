import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const VENDO_BASE_URL = "https://api.auraherbals.pl/json/reply";
const VENDO_CONTEXT_USER_ID = 96;

let cachedToken: string | null = null;
let tokenExpiry: Date | null = null;

async function getVendoToken(): Promise<string> {
  const login = Deno.env.get("VENDO_LOGIN");
  const password = Deno.env.get("VENDO_PASSWORD");

  if (!login || !password) {
    throw new Error("Brak konfiguracji Vendo (VENDO_LOGIN / VENDO_PASSWORD)");
  }

  const now = new Date();
  if (cachedToken && tokenExpiry && tokenExpiry.getTime() - now.getTime() > 5 * 60 * 1000) {
    return cachedToken;
  }

  const res = await fetch(`${VENDO_BASE_URL}/Autoryzacja_Zaloguj`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Login: login, Haslo: password }),
  });

  const data = await res.json();
  if (!data?.Wynik?.Token) {
    throw new Error(`Błąd logowania do Vendo: ${data?.ResponseStatus?.Message || "Nieznany błąd"}`);
  }

  cachedToken = data.Wynik.Token;
  tokenExpiry = new Date(data.Wynik.DataCzasWaznosci);
  return cachedToken!;
}

async function vendoPost(endpoint: string, model: Record<string, unknown>, token: string): Promise<unknown> {
  const res = await fetch(`${VENDO_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Token: token, ContextUserID: VENDO_CONTEXT_USER_ID, Model: model }),
  });
  return await res.json();
}

async function findPZDocument(pzNumber: string, token: string): Promise<{ id: number; numer: string } | null> {
  const variants = [
    { NumerPelny: pzNumber, Typ: { Kod: "PZ" }, LiczbaRekordow: 5, NumerStrony: 1 },
    { Numer: pzNumber, Typ: { Kod: "PZ" }, LiczbaRekordow: 5, NumerStrony: 1 },
    { NumerObcy: pzNumber, Typ: { Kod: "PZ" }, LiczbaRekordow: 5, NumerStrony: 1 },
    { Typ: { Kod: "PZ" }, Filtr: { NumerPelny: pzNumber }, LiczbaRekordow: 5, NumerStrony: 1 },
  ];

  for (const model of variants) {
    const data = await vendoPost("Dokumenty_Dokumenty_Lista", model, token) as Record<string, unknown>;
    const wynik = (data as Record<string, unknown>)?.Wynik as Record<string, unknown> | undefined;
    const rekordy = wynik?.Rekordy as Array<Record<string, unknown>> | undefined;

    if (!rekordy || rekordy.length === 0) continue;
    if (rekordy.length > 20) continue;

    const exact = rekordy.find((r) => r.NumerPelny === pzNumber);
    if (exact) return { id: exact.ID as number, numer: exact.NumerPelny as string };
    if (rekordy.length === 1) return { id: rekordy[0].ID as number, numer: rekordy[0].NumerPelny as string };
  }

  return null;
}

async function closePZ(pzId: number, token: string): Promise<void> {
  const data = await vendoPost("Dokumenty_Dokumenty_Zamknij", { ID: pzId }, token) as Record<string, unknown>;
  const err = (data as Record<string, unknown>)?.ResponseStatus as Record<string, unknown> | undefined;
  if (err?.ErrorCode && !(err.Message as string)?.includes("już zamknięty")) {
    throw new Error(`Błąd zamykania PZ: ${err.Message}`);
  }
}

async function generateFZFromPZ(pzId: number, token: string): Promise<{ id: number; numer: string }> {
  const data = await vendoPost("Dokumenty_Dokumenty_ZafakturujPZ", { DokumentyZrodlowe: [pzId] }, token) as Record<string, unknown>;
  const err = (data as Record<string, unknown>)?.ResponseStatus as Record<string, unknown> | undefined;
  if (err?.ErrorCode) throw new Error(`Błąd generowania FZ: ${err.Message}`);

  const wynik = (data as Record<string, unknown>)?.Wynik as Record<string, unknown> | undefined;
  const fz = (wynik?.DokumentFZ as Record<string, unknown>) || wynik;
  if (!fz?.ID) throw new Error("Nie otrzymano ID wygenerowanego FZ");

  return { id: fz.ID as number, numer: fz.NumerPelny as string };
}

async function attachPdfToDocument(docId: number, filename: string, pdfBase64: string, token: string): Promise<void> {
  const res = await fetch(`${VENDO_BASE_URL}/Dokumenty_Zalaczniki_Pobierz`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Token: token,
      ContextUserID: VENDO_CONTEXT_USER_ID,
      DokumentID: docId,
      NazwaPliku: filename,
      Plik: pdfBase64,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  const err = data?.ResponseStatus as Record<string, unknown> | undefined;
  if (err?.ErrorCode) throw new Error(`Błąd załączania PDF: ${err.Message}`);
}

async function getFZDetails(fzId: number, token: string): Promise<{ brutto: number; klientId: number; waluta: string } | null> {
  const data = await vendoPost("Dokumenty_Dokumenty_Dokument", { ID: fzId }, token) as Record<string, unknown>;
  const wynik = (data as Record<string, unknown>)?.Wynik as Record<string, unknown> | undefined;
  if (!wynik) return null;

  return {
    brutto: wynik.WartoscBrutto as number,
    klientId: (wynik.Klient1 as Record<string, unknown>)?.ID as number,
    waluta: ((wynik.Waluta as Record<string, unknown>)?.Kod as string) || "PLN",
  };
}

async function registerPayment(fzId: number, kwota: number, klientId: number, waluta: string, fzNumer: string, token: string): Promise<void> {
  const dataOp = `/Date(${Date.now()})/`;

  const data = await vendoPost("Platnosci_Platnosci_Dodaj", {
    Zamknij: true,
    Strona: "Wplata",
    Klient: { ID: klientId },
    Rejestr: { Kod: "BANK" },
    FormaPlatnosci: { ID: 26 },
    DataOperacji: dataOp,
    Kwota: kwota,
    Waluta: { Kod: waluta },
    Opis: `Płatność za FZ ${fzNumer}`,
    Rozliczenia: [{ Kwota: kwota, Dokument: { ID: fzId } }],
  }, token) as Record<string, unknown>;

  const err = (data as Record<string, unknown>)?.ResponseStatus as Record<string, unknown> | undefined;
  if (err?.ErrorCode) throw new Error(`Błąd rejestracji płatności: ${err.Message}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Brak autoryzacji" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { invoiceId } = await req.json();
    if (!invoiceId) {
      return new Response(JSON.stringify({ error: "Brak invoiceId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select("id, pz_number, pdf_base64, file_url, invoice_number, bez_mpk")
      .eq("id", invoiceId)
      .maybeSingle();

    if (invErr || !invoice) {
      return new Response(JSON.stringify({ error: "Nie znaleziono faktury" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pzNumber = (invoice as Record<string, unknown>).pz_number as string | null;
    if (!pzNumber) {
      return new Response(JSON.stringify({ error: "Faktura nie ma przypisanego numeru PZ" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let pdfBase64 = (invoice as Record<string, unknown>).pdf_base64 as string | null;

    if (!pdfBase64 && (invoice as Record<string, unknown>).file_url) {
      const pdfRes = await fetch((invoice as Record<string, unknown>).file_url as string);
      if (pdfRes.ok) {
        const buf = await pdfRes.arrayBuffer();
        pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      }
    }

    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: "Brak pliku PDF faktury — nie można załączyć do FZ" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getVendoToken();

    const pzDoc = await findPZDocument(pzNumber, token);
    if (!pzDoc) {
      return new Response(JSON.stringify({ error: `Nie znaleziono dokumentu PZ o numerze "${pzNumber}" w Vendo` }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await closePZ(pzDoc.id, token);

    const fz = await generateFZFromPZ(pzDoc.id, token);

    const invoiceNumber = (invoice as Record<string, unknown>).invoice_number as string | null;
    const pdfFilename = `${invoiceNumber || invoiceId}.pdf`;
    await attachPdfToDocument(fz.id, pdfFilename, pdfBase64, token);

    const fzDetails = await getFZDetails(fz.id, token);
    if (fzDetails?.brutto && fzDetails?.klientId) {
      await registerPayment(fz.id, fzDetails.brutto, fzDetails.klientId, fzDetails.waluta, fz.numer, token);
    }

    await supabase.from("audit_logs").insert({
      invoice_id: invoiceId,
      action: "vendo_sync",
      description: `Zsynchronizowano z Vendo: PZ ${pzNumber} → FZ ${fz.numer}`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        fzDocumentId: fz.id,
        fzDocumentNumber: fz.numer,
        message: `Pomyślnie zsynchronizowano: ${pzNumber} → ${fz.numer}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nieznany błąd";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
