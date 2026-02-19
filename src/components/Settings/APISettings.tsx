import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Key, Plus, Trash2, Copy, Eye, EyeOff, AlertCircle, CheckCircle,
  Terminal, BookOpen, RefreshCw, Clock, X
} from 'lucide-react';

interface ApiToken {
  id: string;
  name: string;
  token_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const BASE_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/invoices-export-api';
const PAID_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/mark-invoice-paid';

export default function APISettings() {
  const { profile } = useAuth();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenExpiry, setNewTokenExpiry] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'tokens' | 'docs'>('tokens');

  useEffect(() => {
    loadTokens();
  }, []);

  async function loadTokens() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('api_tokens')
        .select('id, name, token_prefix, is_active, last_used_at, expires_at, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTokens(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się załadować tokenów');
    } finally {
      setLoading(false);
    }
  }

  async function createToken() {
    if (!newTokenName.trim()) {
      setError('Nazwa tokenu jest wymagana');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const rawToken = 'aurs_' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      const msgBuffer = new TextEncoder().encode(rawToken);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const tokenHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      const tokenPrefix = rawToken.slice(0, 12) + '...';

      const insertData: any = {
        user_id: profile?.id,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        name: newTokenName.trim(),
        is_active: true,
      };
      if (newTokenExpiry) {
        insertData.expires_at = new Date(newTokenExpiry).toISOString();
      }

      const { error } = await supabase.from('api_tokens').insert(insertData);
      if (error) throw error;

      setNewlyCreatedToken(rawToken);
      setShowToken(false);
      setShowCreateForm(false);
      setNewTokenName('');
      setNewTokenExpiry('');
      loadTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć tokenu');
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(id: string) {
    if (!confirm('Czy na pewno chcesz unieważnić ten token? Nie będzie można go przywrócić.')) return;
    try {
      const { error } = await supabase.from('api_tokens').delete().eq('id', id);
      if (error) throw error;
      setTokens(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się unieważnić tokenu');
    }
  }

  async function copyToClipboard(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('pl-PL', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  }

  const exampleResponse = `{
  "success": true,
  "data": [
    {
      "invoice_number": "FV/2024/001",
      "supplier_name": "Przykładowa Sp. z o.o.",
      "supplier_nip": "1234567890",
      "issue_date": "2024-01-15",
      "due_date": "2024-02-14",
      "mpk_code": "MPK-001",
      "department_name": "Ecommerce",
      "currency": "PLN",
      "description": "Usługi marketingowe",
      "mpk_description": "Marketing i reklama",
      "net_amount": 1000.00,
      "tax_amount": 230.00,
      "gross_amount": 1230.00,
      "pln_gross_amount": 1230.00,
      "exchange_rate": 1,
      "status": "paid",
      "paid_at": "2024-01-20T12:00:00Z",
      "updated_at": "2024-01-20T12:00:00Z",
      "pz_number": "PZ/2024/001"
    }
  ],
  "meta": {
    "total": 1,
    "limit": 100,
    "offset": 0,
    "statuses_included": ["paid", "accepted"]
  }
}`;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setActiveSection('tokens')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            activeSection === 'tokens'
              ? 'bg-brand-primary text-white'
              : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          Tokeny API
        </button>
        <button
          onClick={() => setActiveSection('docs')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            activeSection === 'docs'
              ? 'bg-brand-primary text-white'
              : 'bg-light-surface-variant dark:bg-dark-surface-variant text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          Dokumentacja
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4 text-red-400" />
          </button>
        </div>
      )}

      {newlyCreatedToken && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-lg p-4">
          <div className="flex items-start gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-green-800 dark:text-green-300 font-semibold text-sm">Token utworzony pomyslnie</p>
              <p className="text-green-700 dark:text-green-400 text-xs mt-0.5">
                Skopiuj ten token teraz — nie zostanie wyswietlony ponownie.
              </p>
            </div>
            <button onClick={() => setNewlyCreatedToken(null)} className="ml-auto">
              <X className="w-4 h-4 text-green-600 dark:text-green-400" />
            </button>
          </div>
          <div className="flex items-center gap-2 bg-white dark:bg-dark-surface rounded-lg p-2 border border-green-200 dark:border-green-700">
            <code className="flex-1 text-xs font-mono text-text-primary-light dark:text-text-primary-dark break-all">
              {showToken ? newlyCreatedToken : '•'.repeat(40)}
            </code>
            <button
              onClick={() => setShowToken(v => !v)}
              className="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            <button
              onClick={() => copyToClipboard(newlyCreatedToken, 'new')}
              className="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-brand-primary"
            >
              {copied === 'new' ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {activeSection === 'tokens' && (
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Tokeny API
              </h2>
              <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                ({tokens.length})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadTokens}
                className="p-1.5 text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark rounded-lg hover:bg-light-surface dark:hover:bg-dark-surface transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowCreateForm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary/90 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                Nowy token
              </button>
            </div>
          </div>

          {showCreateForm && (
            <div className="p-4 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/30">
              <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-3">
                Utworz nowy token API
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                    Nazwa tokenu *
                  </label>
                  <input
                    type="text"
                    value={newTokenName}
                    onChange={e => setNewTokenName(e.target.value)}
                    placeholder="np. System ERP, Integracja SAP"
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                    Data wygasniecia (opcjonalnie)
                  </label>
                  <input
                    type="date"
                    value={newTokenExpiry}
                    onChange={e => setNewTokenExpiry(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={createToken}
                  disabled={creating || !newTokenName.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                  Generuj token
                </button>
                <button
                  onClick={() => { setShowCreateForm(false); setNewTokenName(''); setNewTokenExpiry(''); setError(null); }}
                  className="px-4 py-2 text-sm text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                >
                  Anuluj
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-primary" />
            </div>
          ) : tokens.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Key className="w-8 h-8 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-2 opacity-40" />
              <p className="text-text-secondary-light dark:text-text-secondary-dark text-sm">
                Brak tokenow API. Utworz pierwszy token, aby umozliwic dostep zewnetrznym systemom.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {tokens.map(token => (
                <div key={token.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-brand-primary/10 dark:bg-brand-primary/20 flex items-center justify-center flex-shrink-0">
                    <Key className="w-4 h-4 text-brand-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                        {token.name}
                      </span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                        token.is_active
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        {token.is_active ? 'Aktywny' : 'Nieaktywny'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <code className="text-xs text-text-secondary-light dark:text-text-secondary-dark font-mono">
                        {token.token_prefix}
                      </code>
                      {token.last_used_at && (
                        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Ostatnio: {formatDate(token.last_used_at)}
                        </span>
                      )}
                      {token.expires_at && (
                        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                          Wygasa: {formatDate(token.expires_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => revokeToken(token.id)}
                    className="p-1.5 text-text-secondary-light dark:text-text-secondary-dark hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Uniewazni token"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSection === 'docs' && (
        <div className="space-y-4">
          <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Endpoint eksportu faktur
              </h2>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  URL
                </p>
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700/50">
                  <code className="flex-1 text-xs font-mono text-text-primary-light dark:text-text-primary-dark break-all">
                    GET {BASE_URL}
                  </code>
                  <button
                    onClick={() => copyToClipboard(BASE_URL, 'url')}
                    className="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-brand-primary flex-shrink-0"
                  >
                    {copied === 'url' ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Autoryzacja
                </p>
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-2">
                  Przekaz token w naglowku HTTP:
                </p>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700/50">
                  <code className="text-xs font-mono text-text-primary-light dark:text-text-primary-dark">
                    Authorization: Bearer aurs_...
                  </code>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Parametry zapytania (opcjonalne)
                </p>
                <div className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-light-surface-variant dark:bg-dark-surface-variant">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Parametr</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Opis</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Przyklad</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {[
                        { param: 'status', desc: 'Filtruj po statusie: paid, accepted lub obie (domyslnie obie)', example: 'status=paid' },
                        { param: 'from_date', desc: 'Faktury od daty wystawienia (YYYY-MM-DD)', example: 'from_date=2024-01-01' },
                        { param: 'to_date', desc: 'Faktury do daty wystawienia (YYYY-MM-DD)', example: 'to_date=2024-12-31' },
                        { param: 'limit', desc: 'Liczba wynikow (max 500, domyslnie 100)', example: 'limit=50' },
                        { param: 'offset', desc: 'Przesuniecie dla paginacji', example: 'offset=100' },
                        { param: 'include_pdf', desc: 'Dolacz PDF w base64 (true/false, domyslnie false)', example: 'include_pdf=true' },
                      ].map(row => (
                        <tr key={row.param} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="px-3 py-2">
                            <code className="text-xs font-mono text-brand-primary">{row.param}</code>
                          </td>
                          <td className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">{row.desc}</td>
                          <td className="px-3 py-2">
                            <code className="text-xs font-mono text-text-secondary-light dark:text-text-secondary-dark">{row.example}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Przyklad zapytania
                </p>
                <div className="relative bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <button
                    onClick={() => copyToClipboard(`curl -H "Authorization: Bearer aurs_..." \\\n  "${BASE_URL}?status=paid&from_date=2024-01-01&include_pdf=false"`, 'curl')}
                    className="absolute top-3 right-3 p-1 text-slate-400 hover:text-white"
                  >
                    {copied === 'curl' ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
{`curl -H "Authorization: Bearer aurs_..." \\
  "${BASE_URL}?status=paid&from_date=2024-01-01&include_pdf=false"`}
                  </pre>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Przykladowa odpowiedz
                </p>
                <div className="relative bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <button
                    onClick={() => copyToClipboard(exampleResponse, 'resp')}
                    className="absolute top-3 right-3 p-1 text-slate-400 hover:text-white"
                  >
                    {copied === 'resp' ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <pre className="text-xs font-mono text-slate-300 overflow-x-auto">
                    {exampleResponse}
                  </pre>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Pola odpowiedzi
                </p>
                <div className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-light-surface-variant dark:bg-dark-surface-variant">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Pole</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Opis</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {[
                        { field: 'invoice_number', desc: 'Numer faktury' },
                        { field: 'supplier_name', desc: 'Nazwa dostawcy' },
                        { field: 'supplier_nip', desc: 'NIP dostawcy' },
                        { field: 'issue_date', desc: 'Data wystawienia (YYYY-MM-DD)' },
                        { field: 'due_date', desc: 'Termin platnosci (YYYY-MM-DD)' },
                        { field: 'mpk_code', desc: 'Numer MPK przypisanego dzialu' },
                        { field: 'department_name', desc: 'Nazwa dzialu' },
                        { field: 'currency', desc: 'Waluta (np. PLN, EUR, USD)' },
                        { field: 'description', desc: 'Opis faktury' },
                        { field: 'mpk_description', desc: 'Opis centrum kosztow (MPK)' },
                        { field: 'net_amount', desc: 'Kwota netto' },
                        { field: 'tax_amount', desc: 'Kwota VAT' },
                        { field: 'gross_amount', desc: 'Kwota brutto' },
                        { field: 'pln_gross_amount', desc: 'Kwota brutto w PLN (po przeliczeniu kursu)' },
                        { field: 'exchange_rate', desc: 'Kurs waluty do PLN' },
                        { field: 'status', desc: 'Status faktury (paid / accepted)' },
                        { field: 'paid_at', desc: 'Data i czas oznaczenia jako oplacona' },
                        { field: 'pz_number', desc: 'Numer PZ powiazany z faktura' },
                        { field: 'pdf_base64', desc: 'PDF faktury zakodowany w Base64 (tylko przy include_pdf=true)' },
                      ].map(row => (
                        <tr key={row.field} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="px-3 py-2">
                            <code className="text-xs font-mono text-brand-primary">{row.field}</code>
                          </td>
                          <td className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">{row.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
            <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Endpoint oznaczania faktury jako oplacona
              </h2>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  URL
                </p>
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700/50">
                  <code className="flex-1 text-xs font-mono text-text-primary-light dark:text-text-primary-dark break-all">
                    POST {PAID_URL}
                  </code>
                  <button
                    onClick={() => copyToClipboard(PAID_URL, 'paid-url')}
                    className="p-1 text-text-secondary-light dark:text-text-secondary-dark hover:text-brand-primary flex-shrink-0"
                  >
                    {copied === 'paid-url' ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Autoryzacja
                </p>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700/50">
                  <code className="text-xs font-mono text-text-primary-light dark:text-text-primary-dark">
                    Authorization: Bearer aurs_...
                  </code>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Body (JSON)
                </p>
                <div className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-light-surface-variant dark:bg-dark-surface-variant">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Pole</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Wymagane</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">Opis</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {[
                        { field: 'invoice_number', required: 'tak*', desc: 'Numer faktury (wymagane jesli brak invoice_id)' },
                        { field: 'invoice_id', required: 'tak*', desc: 'UUID faktury (wymagane jesli brak invoice_number)' },
                        { field: 'paid_at', required: 'nie', desc: 'Data i czas oplacenia (ISO 8601). Domyslnie: czas wywolania' },
                      ].map(row => (
                        <tr key={row.field} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="px-3 py-2">
                            <code className="text-xs font-mono text-brand-primary">{row.field}</code>
                          </td>
                          <td className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">{row.required}</td>
                          <td className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">{row.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1.5">
                  * Wymagane jest podanie co najmniej jednego: <code className="font-mono">invoice_number</code> lub <code className="font-mono">invoice_id</code>
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Przyklad zapytania
                </p>
                <div className="relative bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <button
                    onClick={() => copyToClipboard(`curl -X POST \\\n  -H "Authorization: Bearer aurs_..." \\\n  -H "Content-Type: application/json" \\\n  -d '{"invoice_number": "FV/2024/001", "paid_at": "2024-02-01T10:00:00Z"}' \\\n  "${PAID_URL}"`, 'paid-curl')}
                    className="absolute top-3 right-3 p-1 text-slate-400 hover:text-white"
                  >
                    {copied === 'paid-curl' ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
{`curl -X POST \\
  -H "Authorization: Bearer aurs_..." \\
  -H "Content-Type: application/json" \\
  -d '{"invoice_number": "FV/2024/001", "paid_at": "2024-02-01T10:00:00Z"}' \\
  "${PAID_URL}"`}
                  </pre>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider mb-2">
                  Przykladowa odpowiedz
                </p>
                <div className="relative bg-slate-900 rounded-lg p-4 border border-slate-700">
                  <pre className="text-xs font-mono text-slate-300 overflow-x-auto">
{`{
  "success": true,
  "data": {
    "invoice_id": "uuid-faktury",
    "invoice_number": "FV/2024/001",
    "status": "paid",
    "paid_at": "2024-02-01T10:00:00.000Z"
  }
}`}
                  </pre>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Endpoint zmienia status tylko faktur z aktualnym statusem <code className="font-mono font-semibold">accepted</code>. Faktury w innym statusie zwroca blad 404.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
