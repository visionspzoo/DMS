import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const INVOICE_STATUSES = ['draft', 'waiting', 'pending', 'in_review', 'approved', 'accepted', 'rejected', 'paid'];
const CONTRACT_STATUSES = ['draft', 'pending_specialist', 'pending_manager', 'pending_director', 'pending_ceo', 'pending_signature', 'signed', 'approved', 'rejected'];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400) {
  return json({ success: false, error: message }, status);
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authenticateToken(supabase: any, authHeader: string) {
  const token = authHeader.replace('Bearer ', '');
  if (!token.startsWith('aurs_')) return null;

  const tokenHash = await sha256(token);
  const { data: tokenRow, error } = await supabase
    .from('api_tokens')
    .select('id, user_id, is_active, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !tokenRow) return null;
  if (!tokenRow.is_active) return null;
  if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) return null;

  await supabase
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenRow.id);

  return tokenRow;
}

function parsePath(url: URL): string[] {
  const raw = url.pathname.replace('/alice-api', '').replace(/^\/+/, '').replace(/\/+$/, '');
  return raw ? raw.split('/') : [];
}

async function getBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// ---- READ helpers ----

async function getInvoicesList(sb: any) {
  const { data } = await sb
    .from('invoices')
    .select(`
      id, invoice_number, supplier_name, supplier_nip,
      net_amount, gross_amount, tax_amount, currency,
      pln_net_amount, pln_gross_amount, exchange_rate,
      issue_date, due_date, status, description,
      department:department_id(id, name),
      uploader:uploaded_by(full_name, email, role),
      created_at, updated_at
    `)
    .order('created_at', { ascending: false });
  return data || [];
}

async function getInvoiceById(sb: any, id: string) {
  const { data: invoice, error } = await sb
    .from('invoices')
    .select(`
      id, invoice_number, supplier_name, supplier_nip,
      net_amount, gross_amount, tax_amount, currency,
      pln_net_amount, pln_gross_amount, exchange_rate,
      issue_date, due_date, status, description, file_url,
      department:department_id(id, name),
      uploader:uploaded_by(full_name, email, role),
      created_at, updated_at
    `)
    .eq('id', id)
    .maybeSingle();

  if (error || !invoice) return null;

  const [tagsResult, historyResult] = await Promise.all([
    sb.from('invoice_tags').select('id, tag:tag_id(id, name, color)').eq('invoice_id', id),
    sb.from('audit_logs').select('id, action, old_values, new_values, description, created_at').eq('invoice_id', id).order('created_at', { ascending: false }),
  ]);

  return {
    ...invoice,
    tags: tagsResult.data || [],
    history: historyResult.data || [],
  };
}

async function getDepartments(sb: any) {
  const { data } = await sb.from('departments').select('id, name, monthly_limit, parent_department_id');
  return data || [];
}

async function getMLData(sb: any) {
  const [tl, tags, pred, it] = await Promise.all([
    sb.from('tag_learning').select('vendor_name, supplier_nip, description_keywords, tag:tag_id(id, name, color), department:department_id(id, name), amount_bucket, frequency').order('frequency', { ascending: false }).limit(200),
    sb.from('tags').select('id, name, color'),
    sb.from('ml_tag_predictions').select('invoice_id, tag:tag_id(id, name), confidence, source, reasoning, applied, dismissed, created_at').order('created_at', { ascending: false }).limit(100),
    sb.from('invoice_tags').select('invoice_id, tag:tag_id(id, name, color)').limit(500),
  ]);
  return {
    tagLearning: tl.data || [],
    tags: tags.data || [],
    predictions: pred.data || [],
    invoiceTags: it.data || [],
  };
}

async function getContractsList(sb: any) {
  const { data } = await sb
    .from('contracts')
    .select('id, title, status, contract_type, start_date, end_date, value, currency, department:department_id(id, name), uploader:uploaded_by(full_name, email), created_at')
    .order('created_at', { ascending: false });
  return data || [];
}

async function getContractById(sb: any, id: string) {
  const { data } = await sb
    .from('contracts')
    .select('id, title, description, status, contract_type, contract_number, start_date, end_date, value, currency, file_url, department:department_id(id, name), uploader:uploaded_by(full_name, email), current_approver, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  return data;
}

async function getKSEFInvoices(sb: any) {
  const { data } = await sb
    .from('ksef_invoices')
    .select('id, ksef_reference_number, invoice_number, seller_name, seller_nip, buyer_name, buyer_nip, net_amount, gross_amount, tax_amount, currency, issue_date, department:department_id(id, name), transferred_to_invoice_id, created_at')
    .order('created_at', { ascending: false });
  return data || [];
}

async function getProfiles(sb: any) {
  const { data } = await sb
    .from('profiles')
    .select('id, full_name, email, role, is_admin, department:department_id(id, name)');
  return data || [];
}

async function getNotifications(sb: any, userId: string) {
  const { data } = await sb
    .from('notifications')
    .select('id, type, title, message, invoice_id, is_read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  return data || [];
}

// ---- WRITE helpers ----

async function updateInvoiceStatus(sb: any, invoiceId: string, newStatus: string) {
  if (!INVOICE_STATUSES.includes(newStatus)) {
    return { error: `Invalid status. Valid: ${INVOICE_STATUSES.join(', ')}` };
  }

  const { data: existing } = await sb.from('invoices').select('id, status').eq('id', invoiceId).maybeSingle();
  if (!existing) return { error: 'Invoice not found' };
  if (existing.status === newStatus) return { error: `Invoice already has status "${newStatus}"` };

  const updateData: any = { status: newStatus };
  if (newStatus === 'paid') {
    updateData.paid_at = new Date().toISOString();
  }

  const { data, error } = await sb.from('invoices').update(updateData).eq('id', invoiceId).select().maybeSingle();
  if (error) return { error: error.message };
  return { data };
}

async function updateInvoiceFields(sb: any, invoiceId: string, fields: Record<string, any>) {
  const allowedFields = ['description', 'department_id', 'supplier_name', 'supplier_nip', 'invoice_number', 'net_amount', 'gross_amount', 'tax_amount', 'issue_date', 'due_date', 'currency'];
  const updateData: Record<string, any> = {};
  for (const key of allowedFields) {
    if (fields[key] !== undefined) {
      updateData[key] = fields[key];
    }
  }
  if (Object.keys(updateData).length === 0) {
    return { error: `No valid fields to update. Allowed: ${allowedFields.join(', ')}` };
  }

  const { data, error } = await sb.from('invoices').update(updateData).eq('id', invoiceId).select().maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'Invoice not found' };
  return { data };
}

async function addTagToInvoice(sb: any, invoiceId: string, tagIdentifier: string) {
  const { data: invoice } = await sb.from('invoices').select('id').eq('id', invoiceId).maybeSingle();
  if (!invoice) return { error: 'Invoice not found' };

  let tagId = tagIdentifier;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tagIdentifier)) {
    const { data: tag } = await sb.from('tags').select('id').ilike('name', tagIdentifier).maybeSingle();
    if (!tag) {
      const { data: newTag, error: createErr } = await sb.from('tags').insert({ name: tagIdentifier }).select('id').maybeSingle();
      if (createErr) return { error: `Could not create tag: ${createErr.message}` };
      tagId = newTag.id;
    } else {
      tagId = tag.id;
    }
  }

  const { data, error } = await sb.from('invoice_tags').upsert({ invoice_id: invoiceId, tag_id: tagId }, { onConflict: 'invoice_id,tag_id' }).select('id, tag:tag_id(id, name, color)').maybeSingle();
  if (error) return { error: error.message };
  return { data };
}

async function removeTagFromInvoice(sb: any, invoiceId: string, tagId: string) {
  const { error } = await sb.from('invoice_tags').delete().eq('invoice_id', invoiceId).eq('tag_id', tagId);
  if (error) return { error: error.message };
  return { data: { removed: true } };
}

async function updateContractStatus(sb: any, contractId: string, newStatus: string) {
  if (!CONTRACT_STATUSES.includes(newStatus)) {
    return { error: `Invalid status. Valid: ${CONTRACT_STATUSES.join(', ')}` };
  }

  const { data: existing } = await sb.from('contracts').select('id, status').eq('id', contractId).maybeSingle();
  if (!existing) return { error: 'Contract not found' };

  const { data, error } = await sb.from('contracts').update({ status: newStatus }).eq('id', contractId).select().maybeSingle();
  if (error) return { error: error.message };
  return { data };
}

async function updateContractFields(sb: any, contractId: string, fields: Record<string, any>) {
  const allowedFields = ['title', 'description', 'department_id', 'current_approver'];
  const updateData: Record<string, any> = {};
  for (const key of allowedFields) {
    if (fields[key] !== undefined) updateData[key] = fields[key];
  }
  if (Object.keys(updateData).length === 0) {
    return { error: `No valid fields. Allowed: ${allowedFields.join(', ')}` };
  }

  const { data, error } = await sb.from('contracts').update(updateData).eq('id', contractId).select().maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'Contract not found' };
  return { data };
}

async function markNotificationRead(sb: any, userId: string, notificationId: string) {
  const { data, error } = await sb.from('notifications').update({ is_read: true }).eq('id', notificationId).eq('user_id', userId).select().maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'Notification not found' };
  return { data };
}

async function markAllNotificationsRead(sb: any, userId: string) {
  const { error } = await sb.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
  if (error) return { error: error.message };
  return { data: { success: true } };
}

// ---- ROUTER ----

const ENDPOINTS_HELP = [
  '--- READ ---',
  'GET  /context                        Full system context (all data)',
  'GET  /invoices                       All invoices',
  'GET  /invoices/:id                   Single invoice with tags + history',
  'GET  /departments                    Departments list',
  'GET  /ml                             ML data (tags, predictions, learning)',
  'GET  /contracts                      All contracts',
  'GET  /contracts/:id                  Single contract details',
  'GET  /ksef                           KSeF invoices',
  'GET  /profiles                       User profiles',
  'GET  /notifications                  Your notifications',
  '',
  '--- WRITE ---',
  'PUT  /invoices/:id/status            Change invoice status {status}',
  'PUT  /invoices/:id                   Update invoice fields {description, department_id, ...}',
  'POST /invoices/:id/tags              Add tag to invoice {tag} (name or id, auto-creates)',
  'DELETE /invoices/:id/tags/:tagId     Remove tag from invoice',
  'PUT  /contracts/:id/status           Change contract status {status}',
  'PUT  /contracts/:id                  Update contract fields {title, description, ...}',
  'PUT  /notifications/:id/read         Mark notification as read',
  'PUT  /notifications/read-all         Mark all notifications as read',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!supabaseUrl || !serviceKey) throw new Error('Server configuration missing');

    const sb = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return err('Missing Authorization header. Use: Bearer aurs_...', 401);

    const tokenRow = await authenticateToken(sb, authHeader);
    if (!tokenRow) return err('Invalid or expired API token', 401);

    const userId = tokenRow.user_id;
    const url = new URL(req.url);
    const parts = parsePath(url);
    const method = req.method;

    // GET /context or GET /
    if (method === 'GET' && (parts.length === 0 || parts[0] === 'context')) {
      const [invoices, departments, mlData, contracts, ksefInvoices, profiles, notifications] = await Promise.all([
        getInvoicesList(sb),
        getDepartments(sb),
        getMLData(sb),
        getContractsList(sb),
        getKSEFInvoices(sb),
        getProfiles(sb),
        getNotifications(sb, userId),
      ]);

      const invoiceStats = {
        total: invoices.length,
        byStatus: invoices.reduce((acc: Record<string, number>, inv: any) => {
          acc[inv.status] = (acc[inv.status] || 0) + 1;
          return acc;
        }, {}),
        totalGrossPLN: invoices.reduce((s: number, inv: any) => s + (inv.pln_gross_amount || inv.gross_amount || 0), 0),
      };

      return json({
        success: true,
        data: {
          invoices, invoiceStats, departments,
          ml: { tagLearning: mlData.tagLearning, tags: mlData.tags, predictions: mlData.predictions, invoiceTags: mlData.invoiceTags },
          contracts, ksefInvoices, profiles, notifications,
        },
        meta: { generatedAt: new Date().toISOString(), userId },
      });
    }

    // --- INVOICES ---
    if (parts[0] === 'invoices') {
      if (method === 'GET' && parts.length === 1) {
        return json({ success: true, data: await getInvoicesList(sb) });
      }
      if (method === 'GET' && parts.length === 2) {
        const invoice = await getInvoiceById(sb, parts[1]);
        if (!invoice) return err('Invoice not found', 404);
        return json({ success: true, data: invoice });
      }
      if (method === 'PUT' && parts.length === 3 && parts[2] === 'status') {
        const body = await getBody(req);
        if (!body.status) return err('Missing "status" in body');
        const result = await updateInvoiceStatus(sb, parts[1], body.status);
        if (result.error) return err(result.error);
        return json({ success: true, data: result.data });
      }
      if (method === 'PUT' && parts.length === 2) {
        const body = await getBody(req);
        const result = await updateInvoiceFields(sb, parts[1], body);
        if (result.error) return err(result.error);
        return json({ success: true, data: result.data });
      }
      if (method === 'POST' && parts.length === 3 && parts[2] === 'tags') {
        const body = await getBody(req);
        if (!body.tag) return err('Missing "tag" in body (tag name or tag id)');
        const result = await addTagToInvoice(sb, parts[1], body.tag);
        if (result.error) return err(result.error);
        return json({ success: true, data: result.data });
      }
      if (method === 'DELETE' && parts.length === 4 && parts[2] === 'tags') {
        const result = await removeTagFromInvoice(sb, parts[1], parts[3]);
        if (result.error) return err(result.error);
        return json({ success: true, data: result.data });
      }
    }

    // --- CONTRACTS ---
    if (parts[0] === 'contracts') {
      if (method === 'GET' && parts.length === 1) {
        return json({ success: true, data: await getContractsList(sb) });
      }
      if (method === 'GET' && parts.length === 2) {
        const contract = await getContractById(sb, parts[1]);
        if (!contract) return err('Contract not found', 404);
        return json({ success: true, data: contract });
      }
      if (method === 'PUT' && parts.length === 3 && parts[2] === 'status') {
        const body = await getBody(req);
        if (!body.status) return err('Missing "status" in body');
        const result = await updateContractStatus(sb, parts[1], body.status);
        if (result.error) return err(result.error);
        return json({ success: true, data: result.data });
      }
      if (method === 'PUT' && parts.length === 2) {
        const body = await getBody(req);
        const result = await updateContractFields(sb, parts[1], body);
        if (result.error) return err(result.error);
        return json({ success: true, data: result.data });
      }
    }

    // --- DEPARTMENTS ---
    if (method === 'GET' && parts[0] === 'departments') {
      return json({ success: true, data: await getDepartments(sb) });
    }

    // --- ML ---
    if (method === 'GET' && parts[0] === 'ml') {
      return json({ success: true, data: await getMLData(sb) });
    }

    // --- KSEF ---
    if (method === 'GET' && parts[0] === 'ksef') {
      return json({ success: true, data: await getKSEFInvoices(sb) });
    }

    // --- PROFILES ---
    if (method === 'GET' && parts[0] === 'profiles') {
      return json({ success: true, data: await getProfiles(sb) });
    }

    // --- NOTIFICATIONS ---
    if (parts[0] === 'notifications') {
      if (method === 'GET' && parts.length === 1) {
        return json({ success: true, data: await getNotifications(sb, userId) });
      }
      if (method === 'PUT' && parts.length === 2 && parts[1] === 'read-all') {
        const result = await markAllNotificationsRead(sb, userId);
        if (result.error) return err(result.error);
        return json({ success: true, data: result.data });
      }
      if (method === 'PUT' && parts.length === 3 && parts[2] === 'read') {
        const result = await markNotificationRead(sb, userId, parts[1]);
        if (result.error) return err(result.error);
        return json({ success: true, data: result.data });
      }
    }

    return json({ error: 'Unknown endpoint', endpoints: ENDPOINTS_HELP }, 404);
  } catch (error: any) {
    console.error('Alice API error:', error);
    return json({ success: false, error: error.message }, 500);
  }
});
