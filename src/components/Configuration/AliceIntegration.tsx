import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Copy, CheckCircle, XCircle, Eye, EyeOff, Info, Loader, Shield, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface ApiToken {
  id: string;
  token_prefix: string;
  name: string;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'aurs_';
  for (let i = 0; i < 48; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function AliceIntegration() {
  const { user } = useAuth();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showEndpoints, setShowEndpoints] = useState(false);

  const apiBaseUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/alice-api`;

  useEffect(() => {
    loadTokens();
  }, [user]);

  const loadTokens = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('api_tokens')
        .select('id, token_prefix, name, is_active, last_used_at, expires_at, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTokens(data || []);
    } catch (error) {
      console.error('Error loading tokens:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateToken = async () => {
    if (!user || !newTokenName.trim()) return;
    setCreating(true);
    setMessage(null);

    try {
      const rawToken = generateToken();
      const tokenHash = await sha256(rawToken);
      const tokenPrefix = rawToken.substring(0, 13) + '...';

      const { error } = await supabase
        .from('api_tokens')
        .insert({
          user_id: user.id,
          token_hash: tokenHash,
          token_prefix: tokenPrefix,
          name: newTokenName.trim(),
        });

      if (error) throw error;

      setRevealedToken(rawToken);
      setNewTokenName('');
      setShowCreateForm(false);
      setMessage({ type: 'success', text: 'Token został utworzony. Skopiuj go teraz -- nie będzie ponownie widoczny.' });
      await loadTokens();
    } catch (error: any) {
      console.error('Error creating token:', error);
      setMessage({ type: 'error', text: 'Błąd podczas tworzenia tokena: ' + error.message });
    } finally {
      setCreating(false);
    }
  };

  const handleCopyToken = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleToggleToken = async (id: string, currentActive: boolean) => {
    try {
      const { error } = await supabase
        .from('api_tokens')
        .update({ is_active: !currentActive })
        .eq('id', id);

      if (error) throw error;
      await loadTokens();
    } catch (error: any) {
      console.error('Error toggling token:', error);
      setMessage({ type: 'error', text: 'Błąd: ' + error.message });
    }
  };

  const handleDeleteToken = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten token API? Aplikacje korzystające z niego stracą dostęp.')) return;

    try {
      const { error } = await supabase
        .from('api_tokens')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessage({ type: 'success', text: 'Token został usunięty' });
      await loadTokens();
    } catch (error: any) {
      console.error('Error deleting token:', error);
      setMessage({ type: 'error', text: 'Błąd: ' + error.message });
    }
  };

  const readEndpoints = [
    { method: 'GET', path: '/context', desc: 'Pelny kontekst systemu (faktury, ML, dzialy, umowy, powiadomienia)' },
    { method: 'GET', path: '/invoices', desc: 'Lista faktur ze szczegolami' },
    { method: 'GET', path: '/invoices/:id', desc: 'Pojedyncza faktura z tagami i historia zmian' },
    { method: 'GET', path: '/departments', desc: 'Dzialy i limity' },
    { method: 'GET', path: '/ml', desc: 'Dane ML: wzorce tagowania, predykcje, tagi' },
    { method: 'GET', path: '/contracts', desc: 'Umowy' },
    { method: 'GET', path: '/contracts/:id', desc: 'Szczegoly umowy' },
    { method: 'GET', path: '/ksef', desc: 'Faktury KSeF' },
    { method: 'GET', path: '/profiles', desc: 'Profile uzytkownikow' },
    { method: 'GET', path: '/notifications', desc: 'Powiadomienia uzytkownika' },
  ];

  const writeEndpoints = [
    { method: 'PUT', path: '/invoices/:id/status', desc: 'Zmien status faktury {status}' },
    { method: 'PUT', path: '/invoices/:id', desc: 'Aktualizuj pola faktury {description, department_id, ...}' },
    { method: 'POST', path: '/invoices/:id/tags', desc: 'Dodaj tag do faktury {tag} (nazwa lub id)' },
    { method: 'DELETE', path: '/invoices/:id/tags/:tagId', desc: 'Usun tag z faktury' },
    { method: 'PUT', path: '/contracts/:id/status', desc: 'Zmien status umowy {status}' },
    { method: 'PUT', path: '/contracts/:id', desc: 'Aktualizuj pola umowy {title, description, ...}' },
    { method: 'PUT', path: '/notifications/:id/read', desc: 'Oznacz powiadomienie jako przeczytane' },
    { method: 'PUT', path: '/notifications/read-all', desc: 'Oznacz wszystkie jako przeczytane' },
  ];

  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
            <Key className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Integracja z Alice
            </h2>
            <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
              Tokeny API do zewnetrznych aplikacji AI
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setShowCreateForm(true);
            setRevealedToken(null);
            setMessage(null);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors font-medium text-xs"
        >
          <Plus className="w-3 h-3" />
          Nowy token
        </button>
      </div>

      <div className="mb-4 p-3 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800">
        <div className="flex items-start gap-2">
          <Shield className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-teal-800 dark:text-teal-300">
            <p className="font-semibold mb-1">Jak to dziala?</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Wygeneruj token API i dodaj go w aplikacji Alice</li>
              <li>Alice uzyska dostep do faktur, danych ML, dzialow, umow i KSeF</li>
              <li>Token jest wyswietlany jednorazowo -- skopiuj go przy tworzeniu</li>
              <li>Mozesz dezaktywowac lub usunac token w dowolnym momencie</li>
            </ul>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`mb-4 p-2.5 rounded-lg border flex items-start gap-2 ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <p className={`text-xs ${
            message.type === 'success'
              ? 'text-green-800 dark:text-green-300'
              : 'text-red-800 dark:text-red-300'
          }`}>
            {message.text}
          </p>
        </div>
      )}

      {revealedToken && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 mb-2">
            Twoj token API (widoczny tylko teraz):
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-lg text-xs font-mono text-text-primary-light dark:text-text-primary-dark break-all select-all">
              {revealedToken}
            </code>
            <button
              onClick={() => handleCopyToken(revealedToken)}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                copied
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                  : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200'
              }`}
            >
              {copied ? <CheckCircle className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Skopiowano' : 'Kopiuj'}
            </button>
          </div>
          <button
            onClick={() => setRevealedToken(null)}
            className="mt-2 text-[10px] text-amber-600 dark:text-amber-400 hover:underline"
          >
            Ukryj token
          </button>
        </div>
      )}

      {showCreateForm && (
        <div className="mb-4 p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-300 dark:border-slate-600">
          <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
            Nazwa tokena
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="np. Alice Desktop, Alice Mobile..."
              className="flex-1 px-3 py-2 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-teal-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTokenName.trim()) handleCreateToken();
              }}
            />
            <button
              onClick={handleCreateToken}
              disabled={creating || !newTokenName.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition-colors font-medium text-xs disabled:opacity-50"
            >
              {creating ? (
                <Loader className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Key className="w-3.5 h-3.5" />
              )}
              Generuj
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setNewTokenName('');
              }}
              className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader className="w-5 h-5 animate-spin text-teal-600" />
        </div>
      ) : tokens.length === 0 ? (
        <div className="text-center py-6 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          Brak tokenow API. Utworz token aby zintegrowac aplikacje Alice.
        </div>
      ) : (
        <div className="space-y-2">
          {tokens.map((token) => (
            <div
              key={token.id}
              className={`p-3 rounded-lg border transition-colors ${
                token.is_active
                  ? 'bg-light-surface-variant dark:bg-dark-surface-variant border-slate-300 dark:border-slate-600'
                  : 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2.5 flex-1">
                  <Key className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    token.is_active ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
                        {token.name}
                      </p>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        token.is_active
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                      }`}>
                        {token.is_active ? 'Aktywny' : 'Nieaktywny'}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                      {token.token_prefix}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                        Utworzono: {new Date(token.created_at).toLocaleDateString('pl-PL')}
                      </p>
                      {token.last_used_at && (
                        <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          Ostatnie uzycie: {new Date(token.last_used_at).toLocaleString('pl-PL')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleToggleToken(token.id, token.is_active)}
                    className={`p-1.5 rounded transition-colors ${
                      token.is_active
                        ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                        : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                    title={token.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                  >
                    {token.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleDeleteToken(token.id)}
                    className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                    title="Usun"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
        <button
          onClick={() => setShowEndpoints(!showEndpoints)}
          className="flex items-center gap-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
          {showEndpoints ? 'Ukryj' : 'Pokaz'} endpointy API
        </button>

        {showEndpoints && (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                Base URL:
              </p>
              <div className="flex items-center gap-1">
                <code className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-mono text-text-primary-light dark:text-text-primary-dark">
                  {apiBaseUrl}
                </code>
                <button
                  onClick={() => handleCopyToken(apiBaseUrl)}
                  className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                >
                  <Copy className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                </button>
              </div>
            </div>

            <p className="text-[10px] font-bold uppercase text-teal-700 dark:text-teal-400 mb-1.5 tracking-wide">Odczyt</p>
            <div className="bg-slate-50 dark:bg-dark-surface-variant rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden mb-3">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700/30">
                    <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-text-secondary-light dark:text-text-secondary-dark">Metoda</th>
                    <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-text-secondary-light dark:text-text-secondary-dark">Sciezka</th>
                    <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-text-secondary-light dark:text-text-secondary-dark">Opis</th>
                  </tr>
                </thead>
                <tbody>
                  {readEndpoints.map((ep, i) => (
                    <tr key={i} className="border-b last:border-b-0 border-slate-100 dark:border-slate-700/20">
                      <td className="px-3 py-1.5">
                        <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-[9px] font-bold">
                          {ep.method}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <code className="text-[10px] font-mono text-text-primary-light dark:text-text-primary-dark">{ep.path}</code>
                      </td>
                      <td className="px-3 py-1.5 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">{ep.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400 mb-1.5 tracking-wide">Zapis / Komendy</p>
            <div className="bg-slate-50 dark:bg-dark-surface-variant rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden mb-3">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700/30">
                    <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-text-secondary-light dark:text-text-secondary-dark">Metoda</th>
                    <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-text-secondary-light dark:text-text-secondary-dark">Sciezka</th>
                    <th className="text-left px-3 py-1.5 text-[10px] font-bold uppercase text-text-secondary-light dark:text-text-secondary-dark">Opis</th>
                  </tr>
                </thead>
                <tbody>
                  {writeEndpoints.map((ep, i) => (
                    <tr key={i} className="border-b last:border-b-0 border-slate-100 dark:border-slate-700/20">
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          ep.method === 'PUT' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                          : ep.method === 'POST' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                        }`}>
                          {ep.method}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <code className="text-[10px] font-mono text-text-primary-light dark:text-text-primary-dark">{ep.path}</code>
                      </td>
                      <td className="px-3 py-1.5 text-[10px] text-text-secondary-light dark:text-text-secondary-dark">{ep.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <p className="text-[10px] font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">Odczyt kontekstu:</p>
                <code className="block text-[10px] font-mono text-text-secondary-light dark:text-text-secondary-dark whitespace-pre-wrap leading-relaxed">
{`curl -H "Authorization: Bearer aurs_TWOJ_TOKEN" \\
  ${apiBaseUrl}/context`}
                </code>
              </div>
              <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <p className="text-[10px] font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">Zmiana statusu faktury:</p>
                <code className="block text-[10px] font-mono text-text-secondary-light dark:text-text-secondary-dark whitespace-pre-wrap leading-relaxed">
{`curl -X PUT -H "Authorization: Bearer aurs_TWOJ_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"approved"}' \\
  ${apiBaseUrl}/invoices/ID_FAKTURY/status`}
                </code>
              </div>
              <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <p className="text-[10px] font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">Dodanie tagu do faktury:</p>
                <code className="block text-[10px] font-mono text-text-secondary-light dark:text-text-secondary-dark whitespace-pre-wrap leading-relaxed">
{`curl -X POST -H "Authorization: Bearer aurs_TWOJ_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"tag":"pilne"}' \\
  ${apiBaseUrl}/invoices/ID_FAKTURY/tags`}
                </code>
              </div>
              <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <p className="text-[10px] font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">Zmiana statusu umowy:</p>
                <code className="block text-[10px] font-mono text-text-secondary-light dark:text-text-secondary-dark whitespace-pre-wrap leading-relaxed">
{`curl -X PUT -H "Authorization: Bearer aurs_TWOJ_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"approved"}' \\
  ${apiBaseUrl}/contracts/ID_UMOWY/status`}
                </code>
              </div>
              <div className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <p className="text-[10px] font-semibold text-text-primary-light dark:text-text-primary-dark mb-1">Szczegoly umowy:</p>
                <code className="block text-[10px] font-mono text-text-secondary-light dark:text-text-secondary-dark whitespace-pre-wrap leading-relaxed">
{`curl -H "Authorization: Bearer aurs_TWOJ_TOKEN" \\
  ${apiBaseUrl}/contracts/ID_UMOWY`}
                </code>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
