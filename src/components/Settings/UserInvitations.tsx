import { useState, useEffect } from 'react';
import { Mail, UserPlus, Send, XCircle, CheckCircle, Clock, AlertCircle, Trash2, Copy, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface Department {
  id: string;
  name: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  invitation_token: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  department_id: string | null;
  invited_by: string;
  inviter?: {
    full_name: string;
    email: string;
  };
  department?: {
    name: string;
  };
}

export default function UserInvitations() {
  const { user, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('specialist');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadDepartments();
    loadInvitations();
  }, []);

  const loadDepartments = async () => {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setDepartments(data || []);
    } catch (error) {
      console.error('Error loading departments:', error);
    }
  };

  const loadInvitations = async () => {
    try {
      const { data, error } = await supabase
        .from('user_invitations')
        .select(`
          *,
          inviter:profiles!invited_by(full_name, email),
          department:departments(name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInvitations(data || []);
    } catch (error) {
      console.error('Error loading invitations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji użytkownika');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-user-invitation`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email,
            role,
            department_id: departmentId || undefined,
          }),
        }
      );

      let result;
      const contentType = response.headers.get('content-type');

      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        console.error('Non-JSON response:', text);
        throw new Error(`Serwer zwrócił nieprawidłową odpowiedź: ${text.substring(0, 100)}`);
      }

      console.log('Response status:', response.status);
      console.log('Response result:', result);

      if (!response.ok || !result.success) {
        throw new Error(result.error || result.details || 'Błąd wysyłania zaproszenia');
      }

      setMessage({
        type: 'success',
        text: result.message || 'Zaproszenie zostało wysłane',
      });

      setEmail('');
      setRole('specialist');
      setDepartmentId('');
      await loadInvitations();
    } catch (error: any) {
      console.error('Error sending invitation:', error);
      setMessage({
        type: 'error',
        text: error.message || 'Błąd wysyłania zaproszenia',
      });
    } finally {
      setSending(false);
    }
  };

  const handleCancelInvitation = async (id: string) => {
    if (!confirm('Czy na pewno chcesz anulować to zaproszenie?')) return;

    try {
      const { error } = await supabase
        .from('user_invitations')
        .update({ status: 'cancelled' })
        .eq('id', id);

      if (error) throw error;

      setMessage({ type: 'success', text: 'Zaproszenie zostało anulowane' });
      await loadInvitations();
    } catch (error: any) {
      console.error('Error cancelling invitation:', error);
      setMessage({ type: 'error', text: 'Błąd anulowania zaproszenia' });
    }
  };

  const copyInvitationLink = (token: string) => {
    const link = `${window.location.origin}/accept-invitation?token=${token}`;
    navigator.clipboard.writeText(link);
    setMessage({ type: 'success', text: 'Link skopiowany do schowka' });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'accepted':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'expired':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      case 'cancelled':
        return <XCircle className="w-4 h-4 text-gray-600" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'Oczekuje';
      case 'accepted':
        return 'Zaakceptowane';
      case 'expired':
        return 'Wygasłe';
      case 'cancelled':
        return 'Anulowane';
      default:
        return status;
    }
  };

  const getRoleText = (role: string) => {
    const roles: { [key: string]: string } = {
      specialist: 'Specjalista',
      manager: 'Kierownik',
      director: 'Dyrektor',
      ceo: 'Prezes',
    };
    return roles[role] || role;
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  if (!profile?.is_admin && profile?.role !== 'director') {
    return (
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-6">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Brak uprawnień do zarządzania zaproszeniami
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader className="w-6 h-6 animate-spin text-brand-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
            <UserPlus className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">
              Zaproś użytkownika
            </h2>
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Wyślij zaproszenie do systemu DMS
            </p>
          </div>
        </div>

        {message && (
          <div
            className={`mb-4 p-3 rounded-lg border flex items-start gap-2 ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            )}
            <p
              className={`text-sm ${
                message.type === 'success'
                  ? 'text-green-800 dark:text-green-300'
                  : 'text-red-800 dark:text-red-300'
              }`}
            >
              {message.text}
            </p>
          </div>
        )}

        <form onSubmit={handleSendInvitation} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
              Adres email
            </label>
            <div className="relative">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="uzytkownik@firma.pl"
                className="w-full px-4 py-2 pl-10 bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
              <Mail className="absolute left-3 top-2.5 w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
              Rola
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              required
              className="w-full px-4 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              <option value="specialist">Specjalista</option>
              <option value="manager">Kierownik</option>
              {profile?.is_admin && (
                <>
                  <option value="director">Dyrektor</option>
                  <option value="ceo">Prezes</option>
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
              Dział (opcjonalnie)
            </label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full px-4 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
            >
              <option value="">Brak przypisania</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={sending}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Wysyłanie...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Wyślij zaproszenie
              </>
            )}
          </button>
        </form>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-6">
        <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark mb-4">
          Wysłane zaproszenia
        </h3>

        {invitations.length === 0 ? (
          <div className="text-center py-8">
            <Mail className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Brak wysłanych zaproszeń
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="p-4 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-300 dark:border-slate-600"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getStatusIcon(invitation.status)}
                      <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                        {invitation.email}
                      </span>
                      <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-xs font-medium">
                        {getRoleText(invitation.role)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          invitation.status === 'pending'
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                            : invitation.status === 'accepted'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : invitation.status === 'expired'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            : 'bg-gray-100 dark:bg-gray-900/30 text-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {getStatusText(invitation.status)}
                      </span>
                    </div>

                    <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark space-y-1">
                      {invitation.department && (
                        <p>Dział: {invitation.department.name}</p>
                      )}
                      <p>
                        Wysłane: {new Date(invitation.created_at).toLocaleString('pl-PL')}
                      </p>
                      {invitation.status === 'pending' && (
                        <p className={isExpired(invitation.expires_at) ? 'text-red-600' : ''}>
                          Wygasa: {new Date(invitation.expires_at).toLocaleString('pl-PL')}
                        </p>
                      )}
                      {invitation.accepted_at && (
                        <p className="text-green-600">
                          Zaakceptowane: {new Date(invitation.accepted_at).toLocaleString('pl-PL')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 ml-4">
                    {invitation.status === 'pending' && (
                      <>
                        <button
                          onClick={() => copyInvitationLink(invitation.invitation_token)}
                          className="p-2 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
                          title="Kopiuj link"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleCancelInvitation(invitation.id)}
                          className="p-2 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                          title="Anuluj zaproszenie"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
