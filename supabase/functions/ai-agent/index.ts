import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface AIAgentRequest {
  message?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  action?: string;
  contract_id?: string;
  pdf_base64?: string;
  prompt?: string;
  chat_history?: Array<{ role: string; content: string; timestamp: Date }>;
}

async function queryInvoiceDatabase(supabase: any, userRole: string, userId: string) {
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(`
      *,
      uploader:uploaded_by(full_name, role),
      department:department_id(id, name)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching invoices:', error);
    return [];
  }

  return invoices || [];
}

async function queryMLData(supabase: any) {
  const { data: tagLearning } = await supabase
    .from('tag_learning')
    .select(`
      vendor_name,
      supplier_nip,
      description_keywords,
      tag:tag_id(id, name, color),
      department:department_id(id, name),
      amount_bucket,
      frequency
    `)
    .order('frequency', { ascending: false })
    .limit(100);

  const { data: tags } = await supabase
    .from('tags')
    .select('id, name, color');

  const { data: recentPredictions } = await supabase
    .from('ml_tag_predictions')
    .select(`
      invoice_id,
      tag:tag_id(id, name),
      confidence,
      source,
      applied,
      dismissed,
      created_at
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  const { data: invoiceTags } = await supabase
    .from('invoice_tags')
    .select(`
      invoice_id,
      tag:tag_id(id, name)
    `)
    .limit(200);

  return {
    tagLearning: tagLearning || [],
    tags: tags || [],
    recentPredictions: recentPredictions || [],
    invoiceTags: invoiceTags || [],
  };
}

async function queryDepartmentStats(supabase: any) {
  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, monthly_limit, parent_department_id');

  return departments || [];
}

async function queryWithClaude(
  message: string,
  invoiceData: any[],
  mlData: any,
  departments: any[],
  conversationHistory: Array<{ role: string; content: string }>,
  apiKey: string
) {
  const tagLearningStats = mlData.tagLearning.reduce((acc: any, item: any) => {
    const vendorKey = item.vendor_name || item.supplier_nip || 'unknown';
    if (!acc[vendorKey]) acc[vendorKey] = [];
    acc[vendorKey].push({
      tag: item.tag?.name,
      frequency: item.frequency,
      amount_bucket: item.amount_bucket,
      department: item.department?.name,
    });
    return acc;
  }, {});

  const predictionStats = {
    total: mlData.recentPredictions.length,
    applied: mlData.recentPredictions.filter((p: any) => p.applied).length,
    dismissed: mlData.recentPredictions.filter((p: any) => p.dismissed).length,
    avgConfidence: mlData.recentPredictions.length > 0
      ? (mlData.recentPredictions.reduce((sum: number, p: any) => sum + (p.confidence || 0), 0) / mlData.recentPredictions.length).toFixed(2)
      : 0,
  };

  const tagUsage = mlData.invoiceTags.reduce((acc: any, it: any) => {
    const tagName = it.tag?.name || 'unknown';
    acc[tagName] = (acc[tagName] || 0) + 1;
    return acc;
  }, {});

  const systemPrompt = `Jesteś AuruśAI - zaawansowanym asystentem AI do zarządzania fakturami i analizy danych finansowych.
Masz dostęp do pełnej bazy danych faktur, danych uczenia maszynowego (ML) i statystyk systemu.

Możesz odpowiadać na pytania dotyczące:
- Liczby faktur według statusu, działu, dostawcy
- Sum wartości faktur (w PLN i innych walutach)
- Dat wystawienia i terminów płatności
- Statusów faktur (draft=robocza, waiting=oczekujące, accepted=zaakceptowana, rejected=odrzucona, paid=opłacona)
- Działów, limitów miesięcznych i hierarchii
- Dostawców i ich numerów NIP/VAT ID
- Tagów i kategorii faktur
- Danych ML: wzorców tagowania, predykcji, trafności sugestii
- Analizy trendów i wzorców w danych

DANE SYSTEMU ML:
1. Wzorce tagowania (nauka z akcji użytkowników):
${JSON.stringify(tagLearningStats, null, 2)}

2. Statystyki predykcji ML:
${JSON.stringify(predictionStats, null, 2)}

3. Popularne tagi i ich użycie:
${JSON.stringify(tagUsage, null, 2)}

4. Dostępne tagi w systemie:
${JSON.stringify(mlData.tags.map((t: any) => t.name), null, 2)}

DANE FAKTUR (JSON):
${JSON.stringify(invoiceData.slice(0, 200), null, 2)}

DANE DZIAŁÓW:
${JSON.stringify(departments, null, 2)}

Odpowiadaj w języku polskim, zwięźle i konkretnie.
Używaj formatowania markdown gdy to pomaga czytelności.
Zawsze podawaj źródło informacji (liczba faktur, suma wartości itp.).
Gdy pytanie dotyczy ML/tagów, uwzględnij dane z systemu uczenia maszynowego.
Jeśli nie masz wystarczających danych, powiedz o tym.`;

  const validHistory = conversationHistory
    .filter(({ role }) => role === 'user' || role === 'assistant')
    .reduce((acc: any[], msg) => {
      const mappedRole = msg.role === 'assistant' ? 'assistant' : 'user';
      if (acc.length > 0 && acc[acc.length - 1].role === mappedRole) {
        acc[acc.length - 1].content += '\n' + msg.content;
      } else {
        acc.push({ role: mappedRole, content: msg.content });
      }
      return acc;
    }, []);

  while (validHistory.length > 0 && validHistory[0].role === 'assistant') {
    validHistory.shift();
  }

  if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
    validHistory.pop();
  }

  const messages: any[] = [
    ...validHistory,
    { role: 'user', content: message },
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');

  return content;
}

async function analyzeContractWithClaude(
  prompt: string,
  pdfBase64: string | null,
  chatHistory: Array<{ role: string; content: string }>,
  apiKey: string
) {
  const systemPrompt = `Jesteś ekspertem prawnym analizującym umowy. Odpowiadaj w języku polskim, zwięźle i konkretnie.
Wypunktuj najważniejsze informacje. Używaj formatowania markdown.`;

  const userContent: any[] = [];

  if (pdfBase64) {
    userContent.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdfBase64,
      },
    });
  }

  userContent.push({ type: 'text', text: prompt });

  const validHistory = chatHistory
    .filter(({ role }) => role === 'user' || role === 'assistant')
    .reduce((acc: any[], msg) => {
      const mappedRole = msg.role === 'assistant' ? 'assistant' : 'user';
      if (acc.length > 0 && acc[acc.length - 1].role === mappedRole) {
        acc[acc.length - 1].content += '\n' + msg.content;
      } else {
        acc.push({ role: mappedRole, content: msg.content });
      }
      return acc;
    }, []);

  while (validHistory.length > 0 && validHistory[0].role === 'assistant') {
    validHistory.shift();
  }

  if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
    validHistory.pop();
  }

  const messages: any[] = [
    ...validHistory,
    { role: 'user', content: userContent },
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Claude API error:', errorText);
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');

  return { response: content };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const userRole = profile?.role || 'kierownik';

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({
          error: 'Anthropic API key not configured',
          message: 'AuruśAI wymaga konfiguracji klucza Anthropic API',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const requestData: AIAgentRequest = await req.json();
    const { action = 'invoice_query', message, conversationHistory = [], prompt, pdf_base64, chat_history = [] } = requestData;

    if (action === 'analyze_contract' || action === 'chat') {
      if (!prompt) {
        return new Response(
          JSON.stringify({ error: 'Prompt is required for contract analysis' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const historyFormatted = chat_history.map(({ role, content }: any) => ({ role, content }));
      const result = await analyzeContractWithClaude(prompt, pdf_base64 || null, historyFormatted, anthropicApiKey);

      return new Response(
        JSON.stringify({
          success: true,
          ...result,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!message) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const [invoiceData, mlData, departments] = await Promise.all([
      queryInvoiceDatabase(supabase, userRole, user.id),
      queryMLData(supabase),
      queryDepartmentStats(supabase),
    ]);

    const aiResponse = await queryWithClaude(
      message,
      invoiceData,
      mlData,
      departments,
      conversationHistory,
      anthropicApiKey
    );

    return new Response(
      JSON.stringify({
        success: true,
        response: aiResponse,
        invoiceCount: invoiceData.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error in AI Agent:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        details: 'Failed to process AI request',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
