import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { jsPDF } from 'npm:jspdf@2.5.1';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface InvoiceData {
  invoiceNumber: string;
  supplierName: string;
  supplierNip: string;
  issueDate: string;
  dueDate: string;
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
  currency: string;
  description?: string;
}

async function generateInvoicePdf(data: InvoiceData): Promise<Uint8Array> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  // Try to load Roboto font for Polish characters
  const robotoUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf';
  const robotoBoldUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Medium.ttf';

  try {
    const [normalFont, boldFont] = await Promise.all([
      fetch(robotoUrl).then(r => r.arrayBuffer()),
      fetch(robotoBoldUrl).then(r => r.arrayBuffer())
    ]);

    const normalBase64 = btoa(String.fromCharCode(...new Uint8Array(normalFont)));
    const boldBase64 = btoa(String.fromCharCode(...new Uint8Array(boldFont)));

    doc.addFileToVFS('Roboto-Regular.ttf', normalBase64);
    doc.addFileToVFS('Roboto-Bold.ttf', boldBase64);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  } catch (e) {
    console.error('Failed to load fonts, using default', e);
  }

  const formatAmount = (amount: number | string) => {
    const num = parseFloat(String(amount || '0'));
    return num.toLocaleString('pl-PL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return dateStr;
  };

  let y = 40;
  const leftMargin = 40;
  const rightCol = 400;

  // Header
  doc.setFontSize(18);
  doc.setFont('Roboto', 'bold');
  doc.text('Faktura', leftMargin, y);

  doc.setFontSize(12);
  doc.setFont('Roboto', 'normal');
  doc.text(data.invoiceNumber || '-', rightCol, y, { align: 'right' });

  y += 40;

  // Supplier Info
  doc.setFontSize(12);
  doc.setFont('Roboto', 'bold');
  doc.text('Dostawca', leftMargin, y);
  y += 20;

  doc.setFontSize(10);
  doc.setFont('Roboto', 'normal');
  doc.text(data.supplierName || '-', leftMargin, y);
  y += 16;
  doc.text(`NIP: ${data.supplierNip || '-'}`, leftMargin, y);

  y += 40;

  // Dates
  doc.setFontSize(10);
  doc.text(`Data wystawienia: ${formatDate(data.issueDate)}`, leftMargin, y);
  y += 16;
  doc.text(`Termin platnosci: ${formatDate(data.dueDate)}`, leftMargin, y);

  y += 40;

  // Description if exists
  if (data.description) {
    doc.setFontSize(11);
    doc.setFont('Roboto', 'bold');
    doc.text('Opis:', leftMargin, y);
    y += 16;

    doc.setFont('Roboto', 'normal');
    doc.setFontSize(10);
    const descLines = doc.splitTextToSize(data.description, 500);
    doc.text(descLines, leftMargin, y);
    y += (descLines.length * 14) + 20;
  }

  // Amounts Table
  doc.setFontSize(11);
  doc.setFont('Roboto', 'bold');
  doc.text('Podsumowanie', leftMargin, y);
  y += 20;

  // Table header
  doc.setFillColor(240, 240, 240);
  doc.rect(leftMargin, y, 515, 25, 'F');
  doc.setDrawColor(200, 200, 200);
  doc.rect(leftMargin, y, 515, 25);

  doc.setFontSize(9);
  doc.setFont('Roboto', 'bold');
  doc.text('Kwota netto', leftMargin + 10, y + 16);
  doc.text('Podatek VAT', leftMargin + 180, y + 16);
  doc.text('Kwota brutto', leftMargin + 350, y + 16);

  y += 25;

  // Table data
  doc.rect(leftMargin, y, 515, 25);
  doc.setFont('Roboto', 'normal');
  doc.setFontSize(10);
  doc.text(`${formatAmount(data.netAmount)} ${data.currency}`, leftMargin + 10, y + 16);
  doc.text(`${formatAmount(data.taxAmount)} ${data.currency}`, leftMargin + 180, y + 16);
  doc.text(`${formatAmount(data.grossAmount)} ${data.currency}`, leftMargin + 350, y + 16);

  y += 40;

  // Total
  doc.setFontSize(14);
  doc.setFont('Roboto', 'bold');
  doc.text(
    `Suma do zaplaty: ${formatAmount(data.grossAmount)} ${data.currency}`,
    rightCol,
    y,
    { align: 'right' }
  );

  const pdfOutput = doc.output('arraybuffer');
  return new Uint8Array(pdfOutput);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { invoiceId, returnBase64 } = await req.json();

    if (!invoiceId) {
      return new Response(
        JSON.stringify({ error: 'invoiceId is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Fetch invoice data
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .maybeSingle();

    if (invoiceError || !invoice) {
      return new Response(
        JSON.stringify({ error: 'Invoice not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const invoiceData: InvoiceData = {
      invoiceNumber: invoice.invoice_number || '-',
      supplierName: invoice.supplier_name || '-',
      supplierNip: invoice.supplier_nip || '-',
      issueDate: invoice.issue_date || '',
      dueDate: invoice.due_date || '',
      netAmount: invoice.net_amount || 0,
      taxAmount: invoice.tax_amount || 0,
      grossAmount: invoice.gross_amount || 0,
      currency: invoice.currency || 'PLN',
      description: invoice.description || '',
    };

    const pdfBytes = await generateInvoicePdf(invoiceData);

    if (returnBase64) {
      let binary = '';
      for (let i = 0; i < pdfBytes.length; i++) {
        binary += String.fromCharCode(pdfBytes[i]);
      }
      const base64 = btoa(binary);

      // Update invoice with pdf_base64
      await supabase
        .from('invoices')
        .update({ pdf_base64: base64 })
        .eq('id', invoiceId);

      return new Response(
        JSON.stringify({ success: true, base64, sizeBytes: pdfBytes.length }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="faktura-${invoice.invoice_number || invoiceId}.pdf"`,
      },
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate PDF',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
