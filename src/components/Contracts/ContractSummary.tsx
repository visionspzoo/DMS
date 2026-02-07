import { useState } from 'react';
import { X, Loader2, FileText, AlertCircle, CheckCircle, Brain } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface ContractSummaryProps {
  contractId: string;
  pdfBase64: string | null;
  onClose: () => void;
}

interface Summary {
  brief: string;
  details: string;
  keyPoints: string;
}

export function ContractSummary({ contractId, pdfBase64, onClose }: ContractSummaryProps) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateSummary = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Nie zalogowano');
      }

      const optimalPrompt = `Przeanalizuj tę umowę i przygotuj szczegółowe podsumowanie w języku polskim. Odpowiedź podziel na 3 sekcje (każda sekcja ma być osobnym akapitem):

**SKRÓT**
Zwięzłe streszczenie umowy (2-4 zdania): jaki typ umowy, kto jest stronami, główny przedmiot umowy, wartość/okres obowiązywania.

**SZCZEGÓŁY**
Rozwinięte informacje o umowie (5-8 wypunktowanych elementów):
• Pełne dane stron umowy
• Przedmiot umowy i zakres świadczeń
• Wartość umowy i warunki płatności
• Okres obowiązywania i warunki przedłużenia
• Główne zobowiązania każdej ze stron
• Kary umowne i klauzule odpowiedzialności
• Warunki rozwiązania umowy

**NA CO ZWRÓCIĆ UWAGĘ**
Kluczowe punkty wymagające szczególnej uwagi (4-6 wypunktowanych elementów):
• Nietypowe lub niekorzystne klauzule
• Ryzyka prawne lub finansowe
• Terminy wymagające pilnej reakcji
• Wątpliwości lub niejasności w zapisach
• Zalecenia przed podpisaniem

Używaj formatowania markdown (nagłówki ##, wypunktowania •, pogrubienia **tekst**).`;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            action: 'analyze_contract',
            prompt: optimalPrompt,
            pdf_base64: pdfBase64,
            chat_history: [],
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Nie udało się wygenerować podsumowania');
      }

      const data = await response.json();
      const sections = parseSummaryResponse(data.response);
      setSummary(sections);
    } catch (err: any) {
      console.error('Error generating summary:', err);
      setError(err.message || 'Wystąpił błąd podczas generowania podsumowania');
    } finally {
      setLoading(false);
    }
  };

  const parseSummaryResponse = (response: string): Summary => {
    const sections = {
      brief: '',
      details: '',
      keyPoints: '',
    };

    const briefMatch = response.match(/\*\*SKRÓT\*\*([\s\S]*?)(?=\*\*SZCZEGÓŁY\*\*|$)/i);
    const detailsMatch = response.match(/\*\*SZCZEGÓŁY\*\*([\s\S]*?)(?=\*\*NA CO ZWRÓCIĆ UWAGĘ\*\*|$)/i);
    const keyPointsMatch = response.match(/\*\*NA CO ZWRÓCIĆ UWAGĘ\*\*([\s\S]*?)$/i);

    if (briefMatch) sections.brief = briefMatch[1].trim();
    if (detailsMatch) sections.details = detailsMatch[1].trim();
    if (keyPointsMatch) sections.keyPoints = keyPointsMatch[1].trim();

    if (!sections.brief && !sections.details && !sections.keyPoints) {
      sections.brief = response;
    }

    return sections;
  };

  const formatText = (text: string) => {
    return text
      .split('\n')
      .map((line, idx) => {
        line = line.trim();
        if (!line) return null;

        if (line.startsWith('##')) {
          const headingText = line.replace(/^##\s*/, '');
          return (
            <h3 key={idx} className="text-base font-bold text-text-primary-light dark:text-text-primary-dark mt-4 mb-2">
              {headingText}
            </h3>
          );
        }

        if (line.match(/^[•\-\*]\s/)) {
          const bulletText = line.replace(/^[•\-\*]\s*/, '');
          return (
            <li key={idx} className="text-sm text-text-secondary-light dark:text-text-secondary-dark ml-4 mb-1.5 leading-relaxed">
              {bulletText.split('**').map((part, i) =>
                i % 2 === 0 ? part : <strong key={i} className="font-semibold text-text-primary-light dark:text-text-primary-dark">{part}</strong>
              )}
            </li>
          );
        }

        return (
          <p key={idx} className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-2 leading-relaxed">
            {line.split('**').map((part, i) =>
              i % 2 === 0 ? part : <strong key={i} className="font-semibold text-text-primary-light dark:text-text-primary-dark">{part}</strong>
            )}
          </p>
        );
      })
      .filter(Boolean);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-700/50">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark">
                Podsumowanie umowy
              </h2>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Analiza AI z wykorzystaniem Claude
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {!summary && !loading && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal-100 to-emerald-100 dark:from-teal-900/30 dark:to-emerald-900/30 flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-teal-600 dark:text-teal-400" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                Wygeneruj podsumowanie
              </h3>
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-6 max-w-md">
                Kliknij przycisk poniżej, aby Claude AI przeanalizował umowę i przygotował szczegółowe podsumowanie z kluczowymi punktami.
              </p>
              <button
                onClick={generateSummary}
                disabled={!pdfBase64}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
              >
                <Brain className="w-5 h-5" />
                Generuj podsumowanie
              </button>
              {!pdfBase64 && (
                <p className="text-xs text-red-500 mt-3">Brak danych PDF do analizy</p>
              )}
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-12 h-12 animate-spin text-teal-600 mb-4" />
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                Analizuję umowę, proszę czekać...
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">
                    Błąd
                  </h4>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          {summary && (
            <div className="space-y-6">
              <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800/30 rounded-lg p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                  <h3 className="text-base font-bold text-teal-800 dark:text-teal-300">
                    SKRÓT
                  </h3>
                </div>
                <div className="prose prose-sm max-w-none">
                  {formatText(summary.brief)}
                </div>
              </div>

              {summary.details && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <h3 className="text-base font-bold text-blue-800 dark:text-blue-300">
                      SZCZEGÓŁY
                    </h3>
                  </div>
                  <ul className="space-y-1 list-none">
                    {formatText(summary.details)}
                  </ul>
                </div>
              )}

              {summary.keyPoints && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-lg p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-base font-bold text-amber-800 dark:text-amber-300">
                      NA CO ZWRÓCIĆ UWAGĘ
                    </h3>
                  </div>
                  <ul className="space-y-1 list-none">
                    {formatText(summary.keyPoints)}
                  </ul>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={generateSummary}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-text-primary-light dark:text-text-primary-dark rounded-lg text-sm font-medium transition-colors"
                >
                  <Brain className="w-4 h-4" />
                  Regeneruj
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
