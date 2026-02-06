import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface ExchangeRateRequest {
  currency: string;
  date: string;
}

async function fetchNBPRate(currency: string, date: string): Promise<{ rate: number; date: string }> {
  if (currency === 'PLN') {
    return { rate: 1.0, date };
  }

  const formattedDate = date.replace(/\//g, '-');

  try {
    const response = await fetch(
      `https://api.nbp.pl/api/exchangerates/rates/a/${currency}/${formattedDate}/?format=json`
    );

    if (!response.ok) {
      if (response.status === 404) {
        const todayResponse = await fetch(
          `https://api.nbp.pl/api/exchangerates/rates/a/${currency}/?format=json`
        );

        if (!todayResponse.ok) {
          throw new Error(`NBP API error: ${todayResponse.status}`);
        }

        const todayData = await todayResponse.json();
        return {
          rate: todayData.rates[0].mid,
          date: todayData.rates[0].effectiveDate,
        };
      }
      throw new Error(`NBP API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      rate: data.rates[0].mid,
      date: data.rates[0].effectiveDate,
    };
  } catch (error) {
    console.error('Error fetching NBP rate:', error);
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { currency, date }: ExchangeRateRequest = await req.json();

    if (!currency) {
      return new Response(
        JSON.stringify({ error: 'Currency is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const effectiveDate = date || new Date().toISOString().split('T')[0];

    const result = await fetchNBPRate(currency.toUpperCase(), effectiveDate);

    return new Response(
      JSON.stringify({
        success: true,
        currency: currency.toUpperCase(),
        rate: result.rate,
        effectiveDate: result.date,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error in get-exchange-rate function:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        details: 'Failed to fetch exchange rate from NBP API'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
