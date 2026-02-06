import { useState, useEffect, useRef } from 'react';
import { Sparkles, Send, Loader, FileText, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface AIAssistantProps {
  contractId: string;
  contractTitle: string;
  pdfBase64: string | null;
}

export function AIAssistant({ contractId, contractTitle, pdfBase64 }: AIAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Welcome message
    setMessages([{
      role: 'assistant',
      content: `Witaj! Jestem asystentem AI do analizy umów. Mogę pomóc Ci zrozumieć dokument "${contractTitle}". Zadaj mi pytanie lub kliknij "Analizuj umowę" aby uzyskać podsumowanie.`,
      timestamp: new Date()
    }]);
  }, [contractTitle]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const extractTextFromPDF = async (base64: string): Promise<string> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

      console.log('Extracting text from PDF (using extract-pdf-text function)...');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-text`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pdf_base64: base64,
            use_ocr: false
          }),
        }
      );

      const responseText = await response.text();
      console.log('Extraction response status:', response.status);

      if (!response.ok) {
        console.error('Extraction failed:', responseText);
        return '';
      }

      const data = JSON.parse(responseText);
      console.log('Extracted text length:', data.text?.length || 0);
      console.log('Extraction method:', data.method);

      return data.text || '';
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      return '';
    }
  };

  const extractTextWithOCR = async (base64: string): Promise<string> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

      console.log('Starting OCR extraction...');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-text`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pdf_base64: base64,
            use_ocr: true
          }),
        }
      );

      const responseText = await response.text();
      console.log('OCR Response status:', response.status);
      console.log('OCR Response:', responseText.substring(0, 200));

      if (!response.ok) {
        const errorData = JSON.parse(responseText);
        throw new Error(`OCR error: ${errorData.error || errorData.details || 'Unknown error'}`);
      }

      const data = JSON.parse(responseText);
      console.log('OCR extracted text length:', data.text?.length || 0);
      return data.text || '';
    } catch (error) {
      console.error('Error with OCR:', error);
      throw error;
    }
  };

  const analyzeContract = async () => {
    if (!pdfBase64) {
      alert('Brak danych PDF do analizy');
      return;
    }

    setAnalyzing(true);
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

      setMessages(prev => [...prev, {
        role: 'system',
        content: 'Ekstrakcja tekstu z dokumentu...',
        timestamp: new Date()
      }]);

      let pdfText = await extractTextFromPDF(pdfBase64);
      console.log('First extraction result length:', pdfText?.length || 0);

      if (!pdfText || pdfText.length < 200) {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Tekst za krótki (${pdfText?.length || 0} znaków). Używam OCR do dokładniejszego odczytu...`,
          timestamp: new Date()
        }]);

        pdfText = await extractTextWithOCR(pdfBase64);
        console.log('OCR extraction result length:', pdfText?.length || 0);
      }

      if (!pdfText || pdfText.length < 50) {
        console.error('Final text too short:', pdfText?.length || 0);
        console.error('Text preview:', pdfText?.substring(0, 200) || 'EMPTY');
        throw new Error(`Nie udało się wyekstraktować tekstu z dokumentu (długość: ${pdfText?.length || 0})`);
      }

      setMessages(prev => [...prev, {
        role: 'system',
        content: `Wyekstraktowano ${pdfText.length} znaków. Analizuję umowę...`,
        timestamp: new Date()
      }]);

      console.log('Sending to AI - text preview:', pdfText.substring(0, 500));
      console.log('Text length being sent:', pdfText.length);

      const simplePrompt = `Przeanalizuj umowę "${contractTitle}" i wypunktuj najważniejsze informacje:\n- Strony umowy\n- Daty\n- Kwoty\n- Kluczowe zobowiązania\n- Terminy\n- Inne istotne klauzule`;

      const requestBody = {
        action: 'analyze_contract',
        contract_id: contractId,
        pdf_text: pdfText,
        prompt: simplePrompt,
        chat_history: []
      };

      console.log('AI request body keys:', Object.keys(requestBody));
      console.log('pdf_text type:', typeof requestBody.pdf_text);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      const aiResponseText = await response.text();
      console.log('AI Response status:', response.status);
      console.log('AI Response full:', aiResponseText);

      if (!response.ok) {
        let errorMessage = 'Unknown error';
        try {
          const errorData = JSON.parse(aiResponseText);
          errorMessage = errorData.error || errorData.details || JSON.stringify(errorData);
        } catch {
          errorMessage = aiResponseText || 'Failed to parse error';
        }
        throw new Error(`AI analysis failed (${response.status}): ${errorMessage}`);
      }

      const data = JSON.parse(aiResponseText);

      setMessages(prev => prev.filter(m => m.role !== 'system'));

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response || 'Analiza zakończona',
        timestamp: new Date()
      }]);

      if (data.key_points && data.key_points.length > 0) {
        setKeyPoints(data.key_points);
      }
    } catch (error) {
      console.error('Error analyzing contract:', error);
      console.error('Full error details:', JSON.stringify(error, null, 2));

      const errorMessage = error instanceof Error ? error.message : String(error);

      setMessages(prev => prev.filter(m => m.role !== 'system'));
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Przepraszam, wystąpił błąd podczas analizy umowy:\n\n${errorMessage}\n\nSprawdź konsolę przeglądarki (F12) aby zobaczyć więcej szczegółów.`,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
      setAnalyzing(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji');

      const pdfText = pdfBase64 ? await extractTextFromPDF(pdfBase64) : '';

      const contextualPrompt = pdfText
        ? `KONTEKST - Treść umowy "${contractTitle}":\n${pdfText.substring(0, 8000)}\n\n---\n\nPYTANIE UŻYTKOWNIKA: ${userMessage.content}\n\nOdpowiedz na pytanie na podstawie powyższej umowy.`
        : userMessage.content;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'chat',
            contract_id: contractId,
            pdf_text: pdfText,
            prompt: contextualPrompt,
            chat_history: messages.slice(-5)
          }),
        }
      );

      if (!response.ok) throw new Error('Błąd odpowiedzi AI');

      const data = await response.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response || 'Przepraszam, nie mogłem wygenerować odpowiedzi.',
        timestamp: new Date()
      }]);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Przepraszam, wystąpił błąd. Spróbuj ponownie.',
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-4">
        <div className="flex items-center gap-2 text-white">
          <Sparkles className="w-5 h-5" />
          <h3 className="font-semibold">Asystent AI</h3>
        </div>
        <p className="text-purple-100 text-xs mt-1">Zadaj pytanie o umowę</p>
      </div>

      {/* Key Points */}
      {keyPoints.length > 0 && (
        <div className="p-4 bg-blue-50 border-b border-blue-200">
          <h4 className="font-semibold text-slate-900 text-sm mb-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            Najważniejsze punkty:
          </h4>
          <ul className="space-y-1">
            {keyPoints.map((point, idx) => (
              <li key={idx} className="text-sm text-slate-700 flex gap-2">
                <span className="text-blue-600 font-bold">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px] max-h-[500px]">
        {messages.map((message, idx) => (
          <div
            key={idx}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-900'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p className={`text-xs mt-1 ${
                message.role === 'user' ? 'text-blue-100' : 'text-slate-500'
              }`}>
                {message.timestamp.toLocaleTimeString('pl-PL', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-lg px-4 py-2">
              <Loader className="w-5 h-5 animate-spin text-slate-500" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      <div className="p-3 bg-slate-50 border-t border-slate-200">
        <div className="flex gap-2 mb-3">
          <button
            onClick={analyzeContract}
            disabled={analyzing || !pdfBase64}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-purple-600 text-white hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 text-xs font-medium"
          >
            <Sparkles className="w-4 h-4" />
            {analyzing ? 'Analizuję...' : 'Analizuj umowę'}
          </button>
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setInput('Jakie są kluczowe terminy w umowie?')}
            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 rounded text-xs text-slate-700"
          >
            Terminy
          </button>
          <button
            onClick={() => setInput('Jakie są kwoty i płatności?')}
            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 rounded text-xs text-slate-700"
          >
            Płatności
          </button>
          <button
            onClick={() => setInput('Kto jest stroną umowy?')}
            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 rounded text-xs text-slate-700"
          >
            Strony
          </button>
        </div>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-200">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            rows={2}
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent text-sm resize-none"
            placeholder="Zadaj pytanie o umowę..."
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="px-4 bg-purple-600 text-white hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 self-end"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
