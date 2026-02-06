import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { pdf_base64, use_ocr } = await req.json();

    if (!pdf_base64) {
      return new Response(
        JSON.stringify({ error: 'pdf_base64 is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Starting PDF extraction (use_ocr: ${use_ocr})...`);

    if (!use_ocr) {
      try {
        const pdfParse = await import('npm:pdf-parse@1.1.1');
        const buffer = Uint8Array.from(atob(pdf_base64), c => c.charCodeAt(0));
        const pdfData = await pdfParse.default(buffer);

        console.log(`Extracted ${pdfData.text.length} characters using pdf-parse`);

        return new Response(
          JSON.stringify({
            success: true,
            text: pdfData.text,
            length: pdfData.text.length,
            method: 'pdf-parse'
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } catch (error) {
        console.error('pdf-parse failed:', error);
        return new Response(
          JSON.stringify({
            success: true,
            text: '',
            length: 0,
            method: 'pdf-parse',
            error: 'Failed to extract with pdf-parse'
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: 'OpenAI API key not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('OCR requested but not available. Trying pdf-parse as fallback...');

    try {
      const pdfParse = await import('npm:pdf-parse@1.1.1');
      const buffer = Uint8Array.from(atob(pdf_base64), c => c.charCodeAt(0));
      const pdfData = await pdfParse.default(buffer);

      console.log(`Extracted ${pdfData.text.length} characters using pdf-parse (OCR fallback)`);

      return new Response(
        JSON.stringify({
          success: true,
          text: pdfData.text,
          length: pdfData.text.length,
          method: 'pdf-parse-fallback',
          note: 'OCR not available, used pdf-parse instead'
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (fallbackError: any) {
      console.error('Fallback pdf-parse also failed:', fallbackError);
      return new Response(
        JSON.stringify({
          error: 'Both OCR and pdf-parse failed',
          details: fallbackError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error: any) {
    console.error('Error extracting PDF text:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        details: 'Failed to extract text from PDF',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
