import { useState, useEffect } from 'react';
import { LogIn } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function LoginForm() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showTestLogin, setShowTestLogin] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const errorCode = params.get('error');
      const errorDescription = params.get('error_description');

      if (errorCode) {
        console.error('OAuth Error:', errorCode, errorDescription);

        // Provide user-friendly error messages
        let friendlyError = decodeURIComponent((errorDescription || errorCode).replace(/\+/g, ' '));

        if (errorCode === 'access_denied') {
          friendlyError = 'Anulowano logowanie przez Google. Spróbuj ponownie.';
        } else if (friendlyError.includes('invitation')) {
          friendlyError = 'Brak aktywnego zaproszenia dla tego konta. Skontaktuj się z administratorem.';
        }

        setError(friendlyError);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) throw error;

      if (!data?.url) {
        throw new Error('Google OAuth nie jest skonfigurowany w Supabase. Skontaktuj się z administratorem.');
      }

      // Log successful OAuth initiation
      console.log('OAuth URL generated, redirecting to Google...');
    } catch (err: any) {
      setError(err.message || 'Błąd logowania przez Google');
      setLoading(false);
    }
  };

  const handleTestLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Błąd logowania');
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="flex items-center justify-center mb-8">
            <div className="bg-slate-900 p-3 rounded-xl">
              <LogIn className="w-8 h-8 text-white" />
            </div>
          </div>

          <h2 className="text-3xl font-bold text-center text-slate-900 mb-2">
            Aura DMS
          </h2>
          <p className="text-center text-slate-600 mb-8">
            {showTestLogin ? 'Logowanie testowe' : 'Zaloguj się przez Google Workspace'}
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          {!showTestLogin ? (
            <>
              <button
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full bg-white border-2 border-slate-300 text-slate-700 py-3 px-4 rounded-lg font-medium hover:bg-slate-50 hover:border-slate-400 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-sm"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                {loading ? 'Przekierowywanie...' : 'Zaloguj się przez Google'}
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-300"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white text-slate-500">lub</span>
                </div>
              </div>

              <button
                onClick={() => setShowTestLogin(true)}
                className="w-full bg-slate-100 border border-slate-300 text-slate-700 py-3 px-4 rounded-lg font-medium hover:bg-slate-200 transition"
              >
                Logowanie testowe
              </button>

              <p className="text-center text-xs text-slate-500 mt-6">
                Użyj konta Google Workspace swojej organizacji
              </p>
            </>
          ) : (
            <>
              <form onSubmit={handleTestLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="test@example.com"
                    required
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Hasło
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-slate-900 text-white py-3 px-4 rounded-lg font-medium hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Logowanie...' : 'Zaloguj się'}
                </button>
              </form>

              <button
                onClick={() => {
                  setShowTestLogin(false);
                  setError('');
                  setEmail('');
                  setPassword('');
                }}
                className="w-full mt-4 text-slate-600 py-2 px-4 rounded-lg font-medium hover:text-slate-900 transition"
              >
                Powrót do logowania Google
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
