const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const KSEF_PROXY_URL = `${SUPABASE_URL}/functions/v1/ksef-proxy`;

interface KSEFInvoice {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  invoicingDate: string;
  acquisitionDate: string;
  seller: {
    nip: string;
    name: string;
  };
  buyer: {
    identifier: { type: string; value: string };
    name: string;
  };
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  currency: string;
  invoiceType: string;
  hasAttachment: boolean;
  isSelfInvoicing: boolean;
}

interface KSEFInvoicesResponse {
  success: boolean;
  data: {
    invoices: KSEFInvoice[];
    numberOfElements: number;
    hasMore: boolean;
    pageSize: number;
    pageOffset: number;
  };
  meta: {
    nip: string;
    requestedAt: string;
    filters: {
      dateFrom: string;
      dateTo: string;
      subjectType: string;
      invoiceType: string;
    };
  };
}

interface FetchInvoicesParams {
  dateFrom: string;
  dateTo: string;
  subjectType?: 'subject1' | 'subject2';
  invoiceType?: 'all' | 'VAT' | 'KOR' | 'ZAL';
  pageSize?: number;
  pageOffset?: number;
}

export async function fetchKSEFInvoices(params: FetchInvoicesParams): Promise<KSEFInvoicesResponse> {
  const queryParams = new URLSearchParams({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    subjectType: params.subjectType || 'subject2',
    invoiceType: params.invoiceType || 'all',
    pageSize: String(params.pageSize || 25),
    pageOffset: String(params.pageOffset || 0),
  });

  const proxyParams = new URLSearchParams({
    path: '/api/external/invoices',
    query: queryParams.toString(),
  });

  const url = `${KSEF_PROXY_URL}?${proxyParams}`;
  console.log('KSEF API Request via proxy:', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('KSEF API Response status:', response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('KSEF API Error:', errorData);
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log('KSEF API Success:', data);
    return data;
  } catch (error) {
    console.error('KSEF API Fetch Error:', error);
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Nie można połączyć się z serwerem KSEF. Sprawdź połączenie internetowe.');
    }
    throw error;
  }
}

export async function fetchKSEFInvoicePDF(ksefNumber: string): Promise<Blob> {
  const proxyParams = new URLSearchParams({
    path: `/api/external/invoices/${encodeURIComponent(ksefNumber)}/pdf`,
  });

  const response = await fetch(`${KSEF_PROXY_URL}?${proxyParams}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Nie udało się pobrać PDF: ${response.status}`);
  }

  return response.blob();
}

export async function fetchKSEFInvoiceXML(ksefNumber: string): Promise<string> {
  const proxyParams = new URLSearchParams({
    path: `/api/external/invoices/${encodeURIComponent(ksefNumber)}/xml`,
  });

  const response = await fetch(`${KSEF_PROXY_URL}?${proxyParams}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Nie udało się pobrać XML: ${response.status}`);
  }

  return response.text();
}

export async function checkKSEFStatus() {
  const proxyParams = new URLSearchParams({
    path: '/api/external/status',
  });

  const url = `${KSEF_PROXY_URL}?${proxyParams}`;
  console.log('KSEF Status Check via proxy:', url);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('KSEF Status Response:', response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('KSEF Status Error:', errorData);
      throw new Error(`Status check failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('KSEF Status Success:', data);
    return data;
  } catch (error) {
    console.error('KSEF Status Check Error:', error);
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error('Nie można połączyć się z serwerem KSEF.');
    }
    throw error;
  }
}
