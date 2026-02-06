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

async function queryWithOpenAI(
  message: string,
  invoiceData: any[],
  conversationHistory: Array<{ role: string; content: string }>,
  apiKey: string
) {
  const systemPrompt = `Jesteś asystentem AI pomagającym w zarządzaniu fakturami.
Masz dostęp do bazy danych faktur i możesz odpowiadać na pytania dotyczące:
- Liczby faktur według statusu, działu, dostawcy
- Sum wartości faktur (w PLN i innych walutach)
- Dat wystawienia i terminów płatności
- Statusów faktur (draft, waiting, accepted, rejected, paid)
- Działów i limitów miesięcznych
- Dostawców i ich numerów NIP/VAT ID

Odpowiadaj w języku polskim, zwięźle i konkretnie.
Zawsze podawaj źródło informacji (liczba faktur, suma wartości itp.).
Jeśli nie masz wystarczających danych, powiedz o tym.

Dane faktur (JSON):
${JSON.stringify(invoiceData, null, 2)}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: message },
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: 0.3,
      max_tokens: 1500,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
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

  const messages: any[] = [
    ...chatHistory.map(({ role, content }) => ({
      role: role === 'assistant' ? 'assistant' : 'user',
      content,
    })),
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

    const requestData: AIAgentRequest = await req.json();
    const { action = 'invoice_query', message, conversationHistory = [], prompt, pdf_base64, chat_history = [] } = requestData;

    if (action === 'analyze_contract' || action === 'chat') {
      const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
      if (!anthropicApiKey) {
        return new Response(
          JSON.stringify({
            error: 'Anthropic API key not configured',
            message: 'Analiza umów wymaga konfiguracji klucza Anthropic API',
          }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

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

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({
          error: 'OpenAI API key not configured',
          message: 'Agent AI wymaga konfiguracji klucza OpenAI API',
        }),
        {
          status: 500,
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

    const invoiceData = await queryInvoiceDatabase(supabase, userRole, user.id);

    const aiResponse = await queryWithOpenAI(
      message,
      invoiceData,
      conversationHistory,
      openaiApiKey
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
