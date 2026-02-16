import { useState, useEffect } from 'react';
import { UserPlus, LogIn } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function AcceptInvitation() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [invitation, setInvitation] = useState<any>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setError('Nieprawidłowy link zaproszenia. Skontaktuj się z administratorem.');
      setLoading(false);
      return;
    }

    verifyInvitation(token);
  }, []);

  const verifyInvitation = async (token: string) => {
    try {
      const { data, error } = await supabase
        .from('user_invitations')
        .select(`
          *,
          department:departments(name),
          inviter:profiles!invited_by(full_name, email)
        `)
        .eq('invitation_token', token)
        .eq('status', 'pending')
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setError('Zaproszenie nie istnieje, wygasło lub zostało już wykorzystane.');
        setLoading(false);
        return;
      }

      if (new Date(data.expires_at) < new Date()) {
        setError('To zaproszenie wygasło. Poproś administratora o wysłanie nowego zaproszenia.');
        setLoading(false);
        return;
      }

      setInvitation(data);
      setLoading(false);
    } catch (err: any) {
      console.error('Error verifying invitation:', err);
      setError('Błąd weryfikacji zaproszenia. Spróbuj ponownie później.');
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setSigningIn(true);

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
        throw new Error('Google OAuth nie jest skonfigurowany. Skontaktuj się z administratorem.');
      }
    } catch (err: any) {
      setError(err.message || 'Błąd logowania przez Google');
      setSigningIn(false);
    }
  };

  const getRoleName = (role: string) => {
    const roleNames: { [key: string]: string } = {
      specialist: 'Specjalista',
      manager: 'Kierownik',
      director: 'Dyrektor',
      ceo: 'Prezes',
    };
    return roleNames[role] || role;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center p-4">
        <div className="text-text-secondary-dark">Ładowanie...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-dark-surface rounded-2xl shadow-2xl p-8 border border-gray-700/50">
            <div className="flex items-center justify-center mb-6">
              <div className="bg-red-900/20 p-4 rounded-xl">
                <UserPlus className="w-8 h-8 text-red-400" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center text-text-primary-dark mb-4">
              Problem z zaproszeniem
            </h2>
            <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
            <a
              href="/"
              className="block text-center text-brand-primary hover:text-brand-primary-hover transition"
            >
              Powrót do strony głównej
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-dark-surface rounded-2xl shadow-2xl p-8 border border-gray-700/50">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-to-br from-brand-primary to-brand-primary-hover p-4 rounded-xl shadow-lg shadow-brand-primary/20">
              <UserPlus className="w-8 h-8 text-white" />
            </div>
          </div>

          <h2 className="text-3xl font-bold text-center text-text-primary-dark mb-2">
            Witaj w Aura DMS
          </h2>
          <p className="text-center text-text-secondary-dark mb-8">
            Zostałeś zaproszony do systemu
          </p>

          {error && (
            <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-3 rounded-lg mb-6">
              {error}
            </div>
          )}

          <div className="bg-dark-surface-variant border border-gray-700 rounded-lg p-6 mb-6">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary-dark">Email:</span>
                <span className="text-text-primary-dark font-medium">{invitation.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary-dark">Rola:</span>
                <span className="text-text-primary-dark font-medium">{getRoleName(invitation.role)}</span>
              </div>
              {invitation.department && (
                <div className="flex justify-between">
                  <span className="text-text-secondary-dark">Dział:</span>
                  <span className="text-text-primary-dark font-medium">{invitation.department.name}</span>
                </div>
              )}
              {invitation.inviter && (
                <div className="flex justify-between">
                  <span className="text-text-secondary-dark">Zaprosił(a):</span>
                  <span className="text-text-primary-dark font-medium">{invitation.inviter.full_name}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-blue-900/20 border border-blue-800 text-blue-300 px-4 py-3 rounded-lg mb-6 text-sm">
            <p className="font-medium mb-2">Aby aktywować swoje konto:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Kliknij przycisk poniżej</li>
              <li>Zaloguj się przez Google Workspace używając adresu <strong>{invitation.email}</strong></li>
              <li>Twoje konto zostanie automatycznie utworzone</li>
            </ol>
          </div>

          <button
            onClick={handleGoogleSignIn}
            disabled={signingIn}
            className="w-full bg-dark-surface-variant border-2 border-gray-600 text-text-primary-dark py-3 px-4 rounded-lg font-medium hover:bg-dark-surface hover:border-gray-500 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-sm"
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
            {signingIn ? 'Przekierowywanie...' : 'Zaloguj się przez Google'}
          </button>

          <p className="text-center text-xs text-text-secondary-dark mt-6">
            Upewnij się, że logujesz się kontem Google Workspace z adresem <strong className="text-text-primary-dark">{invitation.email}</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
