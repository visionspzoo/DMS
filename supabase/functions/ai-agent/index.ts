import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

type LLMModel = 'claude-sonnet-4' | 'gpt-4o' | 'gemini-2.0-flash';

const CONTRACT_STATUSES = ['draft', 'pending_specialist', 'pending_manager', 'pending_director', 'pending_ceo', 'pending_signature', 'signed', 'approved', 'rejected'];

interface AIAgentRequest {
  message?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  action?: string;
  contract_id?: string;
  pdf_base64?: string;
  prompt?: string;
  chat_history?: Array<{ role: string; content: string; timestamp: Date }>;
  model?: LLMModel;
  status?: string;
  fields?: Record<string, any>;
  customSystemPrompt?: string;
}

const MODEL_CONFIGS: Record<LLMModel, { label: string; envKey: string }> = {
  'claude-sonnet-4': { label: 'Claude Sonnet 4', envKey: 'ANTHROPIC_API_KEY' },
  'gpt-4o': { label: 'GPT-4o', envKey: 'OPENAI_API_KEY' },
  'gemini-2.0-flash': { label: 'Gemini 2.0 Flash', envKey: 'GOOGLE_AI_API_KEY' },
};

function getAvailableModels(): LLMModel[] {
  return (Object.entries(MODEL_CONFIGS) as [LLMModel, { label: string; envKey: string }][])
    .filter(([, cfg]) => !!Deno.env.get(cfg.envKey))
    .map(([id]) => id);
}

function resolveModel(requested?: LLMModel): LLMModel {
  const available = getAvailableModels();
  if (requested && available.includes(requested)) return requested;
  if (available.includes('claude-sonnet-4')) return 'claude-sonnet-4';
  return available[0] || 'claude-sonnet-4';
}

async function callClaude(
  apiKey: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: any }>,
  maxTokens: number,
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.content
    .filter((block: any) => block.type === 'text')
    .map((block: any) => block.text)
    .join('\n');
}

async function callOpenAI(
  apiKey: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: any }>,
  maxTokens: number,
): Promise<string> {
  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => {
      if (Array.isArray(m.content)) {
        const parts: any[] = [];
        for (const block of m.content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text });
          } else if (block.type === 'document' && block.source?.type === 'base64') {
            parts.push({
              type: 'file',
              file: {
                filename: 'document.pdf',
                file_data: `data:application/pdf;base64,${block.source.data}`,
              },
            });
          }
        }
        return { role: m.role, content: parts };
      }
      return { role: m.role, content: m.content };
    }),
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      messages: openaiMessages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: any }>,
  _maxTokens: number,
): Promise<string> {
  const geminiContents: any[] = [];

  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    if (Array.isArray(msg.content)) {
      const parts: any[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text });
        } else if (block.type === 'document' && block.source?.type === 'base64') {
          parts.push({
            inline_data: {
              mime_type: 'application/pdf',
              data: block.source.data,
            },
          });
        }
      }
      geminiContents.push({ role, parts });
    } else {
      geminiContents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: geminiContents,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text)
    .join('\n') || '';
}

async function callLLM(
  model: LLMModel,
  systemPrompt: string,
  messages: Array<{ role: string; content: any }>,
  maxTokens: number,
): Promise<string> {
  const config = MODEL_CONFIGS[model];
  const apiKey = Deno.env.get(config.envKey);
  if (!apiKey) throw new Error(`Klucz API dla ${config.label} nie jest skonfigurowany`);

  switch (model) {
    case 'claude-sonnet-4':
      return callClaude(apiKey, systemPrompt, messages, maxTokens);
    case 'gpt-4o':
      return callOpenAI(apiKey, systemPrompt, messages, maxTokens);
    case 'gemini-2.0-flash':
      return callGemini(apiKey, systemPrompt, messages, maxTokens);
    default:
      throw new Error(`Nieobsługiwany model: ${model}`);
  }
}

async function queryInvoiceDatabase(supabase: any, userRole: string, userId: string) {
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(`
      id,
      invoice_number,
      vendor_name,
      amount,
      currency,
      pln_amount,
      status,
      due_date,
      issue_date,
      department_id
    `)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('Error fetching invoices:', error);
    return [];
  }

  return invoices || [];
}

async function queryMLData(supabase: any) {
  const { data: tags } = await supabase
    .from('tags')
    .select('id, name')
    .limit(20);

  return {
    tagLearning: [],
    tags: tags || [],
    recentPredictions: [],
    invoiceTags: [],
  };
}

async function queryDepartmentStats(supabase: any) {
  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, monthly_limit, parent_department_id');

  return departments || [];
}

async function queryContractsDatabase(supabase: any) {
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('id, contract_number, title, status, department_id')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error fetching contracts:', error);
    return { contracts: [], summaries: [], approvals: [] };
  }

  return {
    contracts: contracts || [],
    summaries: [],
    approvals: [],
  };
}

async function getContractById(supabase: any, id: string) {
  const { data } = await supabase
    .from('contracts')
    .select(`
      id, contract_number, title, description, status, file_url,
      department:department_id(id, name),
      uploader:uploaded_by(full_name, role),
      current_approver, created_at, updated_at
    `)
    .eq('id', id)
    .maybeSingle();

  if (!data) return null;

  const [summaryResult, approvalsResult, commentsResult] = await Promise.all([
    supabase.from('contract_summaries').select('brief, details, key_points').eq('contract_id', id).maybeSingle(),
    supabase.from('contract_approvals').select('approver_role, status, comment, approved_at').eq('contract_id', id).order('approved_at', { ascending: true }),
    supabase.from('contract_comments').select('comment, comment_type, highlighted_text, created_at').eq('contract_id', id).order('created_at', { ascending: false }).limit(20),
  ]);

  return {
    ...data,
    summary: summaryResult.data || null,
    approvals: approvalsResult.data || [],
    comments: commentsResult.data || [],
  };
}

async function updateContractStatus(supabase: any, contractId: string, newStatus: string) {
  if (!CONTRACT_STATUSES.includes(newStatus)) {
    return { error: `Nieprawidlowy status. Dozwolone: ${CONTRACT_STATUSES.join(', ')}` };
  }

  const { data: existing } = await supabase.from('contracts').select('id, status').eq('id', contractId).maybeSingle();
  if (!existing) return { error: 'Umowa nie znaleziona' };

  const { data, error } = await supabase
    .from('contracts')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', contractId)
    .select('id, title, status')
    .maybeSingle();

  if (error) return { error: error.message };
  return { data };
}

async function updateContractFields(supabase: any, contractId: string, fields: Record<string, any>) {
  const allowedFields = ['title', 'description', 'department_id', 'current_approver'];
  const updateData: Record<string, any> = {};
  for (const key of allowedFields) {
    if (fields[key] !== undefined) updateData[key] = fields[key];
  }
  if (Object.keys(updateData).length === 0) {
    return { error: `Brak prawidlowych pol. Dozwolone: ${allowedFields.join(', ')}` };
  }

  updateData.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('contracts')
    .update(updateData)
    .eq('id', contractId)
    .select('id, title, status, description')
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: 'Umowa nie znaleziona' };
  return { data };
}

function buildSystemPrompt(
  invoiceData: any[],
  mlData: any,
  departments: any[],
  contractsData: { contracts: any[]; summaries: any[]; approvals: any[] },
  modelLabel: string,
): string {
  const contractStats = {
    total: contractsData.contracts.length,
    byStatus: contractsData.contracts.reduce((acc: Record<string, number>, c: any) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {}),
  };

  const invoiceStats = {
    total: invoiceData.length,
    byStatus: invoiceData.reduce((acc: Record<string, number>, inv: any) => {
      acc[inv.status] = (acc[inv.status] || 0) + 1;
      return acc;
    }, {}),
    totalPLN: invoiceData.reduce((sum: number, inv: any) => sum + (inv.pln_amount || 0), 0),
  };

  return `Jesteś AuruśAI - zaawansowanym asystentem AI do zarządzania dokumentami: fakturami i umowami.
Aktualnie korzystasz z modelu: ${modelLabel}.
Masz dostęp do bazy danych faktur i umów.

Możesz odpowiadać na pytania dotyczące:
FAKTURY:
- Liczby faktur według statusu, działu, dostawcy
- Sum wartości faktur (w PLN i innych walutach)
- Dat wystawienia i terminów płatności
- Statusów faktur (draft=robocza, waiting=oczekujące, accepted=zaakceptowana, rejected=odrzucona, paid=opłacona)
- Dostawców i ich numerów NIP/VAT ID

UMOWY:
- Liczby umów według statusu i działu
- Statusów umów (draft=robocza, pending_specialist, pending_manager, pending_director, pending_ceo, pending_signature, signed=podpisana, approved=zatwierdzona, rejected=odrzucona)

OGÓLNE:
- Działów, limitów miesięcznych i hierarchii
- Analizy trendów i wzorców w danych

STATYSTYKI FAKTUR:
${JSON.stringify(invoiceStats, null, 2)}

DANE FAKTUR (ostatnie 30):
${JSON.stringify(invoiceData, null, 2)}

STATYSTYKI UMÓW:
${JSON.stringify(contractStats, null, 2)}

DANE UMÓW (ostatnie 10):
${JSON.stringify(contractsData.contracts, null, 2)}

DANE DZIAŁÓW:
${JSON.stringify(departments, null, 2)}

Dostępne tagi: ${mlData.tags.map((t: any) => t.name).join(', ')}

Odpowiadaj w języku polskim, zwięźle i konkretnie.
Używaj formatowania markdown gdy to pomaga czytelności.
Zawsze podawaj źródło informacji (liczba faktur/umów, suma wartości itp.).
Jeśli nie masz wystarczających danych, powiedz o tym.`;
}

function prepareConversationHistory(
  history: Array<{ role: string; content: string }>,
): Array<{ role: string; content: string }> {
  const validHistory = history
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

  return validHistory;
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

    if (req.method === 'GET') {
      const available = getAvailableModels();
      const models = available.map(id => ({
        id,
        label: MODEL_CONFIGS[id].label,
      }));

      return new Response(
        JSON.stringify({ models }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
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
      .select('role, preferred_llm_model')
      .eq('id', user.id)
      .single();

    const userRole = profile?.role || 'kierownik';

    const requestData: AIAgentRequest = await req.json();
    const {
      action = 'invoice_query',
      message,
      conversationHistory = [],
      prompt,
      pdf_base64,
      chat_history = [],
      model: requestedModel,
    } = requestData;

    const selectedModel = resolveModel(requestedModel || profile?.preferred_llm_model);
    const modelLabel = MODEL_CONFIGS[selectedModel].label;

    if (action === 'get_contract') {
      if (!requestData.contract_id) {
        return new Response(
          JSON.stringify({ error: 'contract_id is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const contract = await getContractById(supabase, requestData.contract_id);
      if (!contract) {
        return new Response(
          JSON.stringify({ error: 'Umowa nie znaleziona' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data: contract }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'update_contract_status') {
      if (!requestData.contract_id || !requestData.status) {
        return new Response(
          JSON.stringify({ error: 'contract_id and status are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await updateContractStatus(supabase, requestData.contract_id, requestData.status);
      if (result.error) {
        return new Response(
          JSON.stringify({ success: false, error: result.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data: result.data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'update_contract_fields') {
      if (!requestData.contract_id || !requestData.fields) {
        return new Response(
          JSON.stringify({ error: 'contract_id and fields are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await updateContractFields(supabase, requestData.contract_id, requestData.fields);
      if (result.error) {
        return new Response(
          JSON.stringify({ success: false, error: result.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, data: result.data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

      const contractSystemPrompt = `Jesteś ekspertem prawnym analizującym umowy. Odpowiadaj w języku polskim, zwięźle i konkretnie.
Wypunktuj najważniejsze informacje. Używaj formatowania markdown.
Aktualnie korzystasz z modelu: ${modelLabel}.`;

      const historyFormatted = prepareConversationHistory(
        chat_history.map(({ role, content }: any) => ({ role, content }))
      );

      const userContent: any[] = [];
      if (pdf_base64) {
        userContent.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: pdf_base64,
          },
        });
      }
      userContent.push({ type: 'text', text: prompt });

      const messages: any[] = [
        ...historyFormatted,
        { role: 'user', content: userContent },
      ];

      const content = await callLLM(selectedModel, contractSystemPrompt, messages, 4096);

      return new Response(
        JSON.stringify({
          success: true,
          response: content,
          model: selectedModel,
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

    const [invoiceData, mlData, departments, contractsData] = await Promise.all([
      queryInvoiceDatabase(supabase, userRole, user.id),
      queryMLData(supabase),
      queryDepartmentStats(supabase),
      queryContractsDatabase(supabase),
    ]);

    const baseSystemPrompt = buildSystemPrompt(invoiceData, mlData, departments, contractsData, modelLabel);
    const systemPrompt = requestData.customSystemPrompt
      ? `${requestData.customSystemPrompt}\n\n--- DANE SYSTEMOWE ---\n\n${baseSystemPrompt}`
      : baseSystemPrompt;
    const validHistory = prepareConversationHistory(conversationHistory);
    const llmMessages = [
      ...validHistory,
      { role: 'user', content: message },
    ];

    const aiResponse = await callLLM(selectedModel, systemPrompt, llmMessages, 2048);

    return new Response(
      JSON.stringify({
        success: true,
        response: aiResponse,
        invoiceCount: invoiceData.length,
        contractCount: contractsData.contracts.length,
        model: selectedModel,
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
