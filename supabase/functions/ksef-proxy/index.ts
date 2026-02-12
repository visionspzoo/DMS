import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const KSEF_API_URL = 'https://ksef-invoice-fetch.replit.app';
const KSEF_API_KEY = 'e33611b31b84e9cc52a26493af9c0aa9f2ab7b35990117ca8d955317b87433e3';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path') || '/api/external/status';
    const queryParams = url.searchParams.get('query') || '';

    const targetUrl = `${KSEF_API_URL}${path}${queryParams ? '?' + queryParams : ''}`;

    console.log('=== KSEF Proxy Request ===');
    console.log('Method:', req.method);
    console.log('Path:', path);
    console.log('Target URL:', targetUrl);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'x-api-key': KSEF_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    console.log('Response status:', response.status);
    console.log('Content-Type:', contentType);

    if (!response.ok) {
      let errorData;
      try {
        const errorText = await response.text();
        console.error('Error response body:', errorText);
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: 'Unknown error' };
      }
      console.error('KSEF Proxy - Error:', errorData);

      return new Response(
        JSON.stringify({
          success: false,
          error: errorData.error || errorData.message || `HTTP ${response.status}`,
          details: errorData,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (contentType.includes('application/pdf')) {
      console.log('Returning PDF data');
      const pdfData = await response.arrayBuffer();
      console.log('PDF size:', pdfData.byteLength, 'bytes');
      return new Response(pdfData, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/pdf',
          'Content-Length': pdfData.byteLength.toString(),
        },
      });
    }

    if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
      const xmlData = await response.text();
      return new Response(xmlData, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/xml',
        },
      });
    }

    const data = await response.json();
    console.log('KSEF Proxy - Success');

    return new Response(
      JSON.stringify(data),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('KSEF Proxy - Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Nie można połączyć się z serwerem KSEF',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
