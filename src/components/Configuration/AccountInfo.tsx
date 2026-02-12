import { useState, useEffect } from 'react';
import { User, Building2, Shield, Key, Clock, Calendar } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface DepartmentAccess {
  id: string;
  department_id: string;
  access_type: 'view' | 'workflow';
  created_at: string;
  department?: {
    name: string;
  };
}

export default function AccountInfo() {
  const { profile } = useAuth();
  const [departmentAccess, setDepartmentAccess] = useState<DepartmentAccess[]>([]);
  const [mainDepartment, setMainDepartment] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAccountInfo();
  }, [profile?.id]);

  async function loadAccountInfo() {
    if (!profile?.id) return;

    try {
      setLoading(true);

      if (profile.department_id) {
        const { data: deptData } = await supabase
          .from('departments')
          .select('id, name')
          .eq('id', profile.department_id)
          .maybeSingle();

        if (deptData) {
          setMainDepartment(deptData);
        }
      }

      const { data: accessData } = await supabase
        .from('user_department_access')
        .select(`
          id,
          department_id,
          access_type,
          created_at,
          department:department_id(name)
        `)
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false });

      if (accessData) {
        setDepartmentAccess(accessData as any);
      }
    } catch (err) {
      console.error('Error loading account info:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">
              Podstawowe informacje
            </h2>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Imię i nazwisko
              </label>
              <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                {profile?.full_name || '-'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Email
              </label>
              <div className="text-sm text-text-primary-light dark:text-text-primary-dark">
                {profile?.email || '-'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Rola
              </label>
              <div className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-brand-primary/10 text-brand-primary dark:bg-brand-primary/20">
                {profile?.role || '-'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Status
              </label>
              <div className="flex items-center gap-2">
                {profile?.is_admin && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-ai-accent/10 text-ai-accent dark:bg-ai-accent/20">
                    <Shield className="w-3 h-3 mr-1" />
                    Administrator
                  </span>
                )}
                {profile?.can_access_ksef_config && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    <Key className="w-3 h-3 mr-1" />
                    KSEF
                  </span>
                )}
                {!profile?.is_admin && !profile?.can_access_ksef_config && (
                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    Użytkownik standardowy
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                <Calendar className="w-3 h-3 inline mr-1" />
                Data utworzenia
              </label>
              <div className="text-sm text-text-primary-light dark:text-text-primary-dark">
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString('pl-PL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })
                  : '-'}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                <Clock className="w-3 h-3 inline mr-1" />
                Ostatnie logowanie
              </label>
              <div className="text-sm text-text-primary-light dark:text-text-primary-dark">
                {profile?.last_login_at
                  ? new Date(profile.last_login_at).toLocaleString('pl-PL', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : 'Nigdy'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">
              Przypisanie do działów
            </h2>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-2">
              Główny dział
            </label>
            {mainDepartment ? (
              <div className="inline-flex items-center gap-2 px-3 py-2 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-lg border border-brand-primary/30">
                <Building2 className="w-4 h-4 text-brand-primary" />
                <span className="text-sm font-medium text-brand-primary">
                  {mainDepartment.name}
                </span>
              </div>
            ) : (
              <div className="text-sm text-text-secondary-light dark:text-text-secondary-dark italic">
                Nie przypisano do żadnego działu
              </div>
            )}
          </div>

          {departmentAccess.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-2">
                Dodatkowe uprawnienia
              </label>
              <div className="space-y-2">
                {departmentAccess.map((access) => (
                  <div
                    key={access.id}
                    className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700/50"
                  >
                    <div className="flex items-center gap-3">
                      <Building2 className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                      <div>
                        <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                          {access.department?.name || 'Nieznany dział'}
                        </div>
                        <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                          Dodano {new Date(access.created_at).toLocaleDateString('pl-PL')}
                        </div>
                      </div>
                    </div>
                    <div>
                      {access.access_type === 'view' ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          Tylko podgląd
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Dostęp do obiegu
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {departmentAccess.length === 0 && !mainDepartment && (
            <div className="text-center py-8">
              <Building2 className="w-12 h-12 mx-auto text-text-secondary-light dark:text-text-secondary-dark opacity-30 mb-3" />
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                Nie jesteś przypisany do żadnego działu
              </p>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                Skontaktuj się z administratorem aby otrzymać dostęp do działów
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-1">
              O uprawnieniach
            </h3>
            <ul className="text-xs text-blue-800 dark:text-blue-400 space-y-1">
              <li>
                <strong>Główny dział</strong> - Dział do którego jesteś bezpośrednio przypisany. Masz pełny dostęp do faktur tego działu.
              </li>
              <li>
                <strong>Tylko podgląd</strong> - Możesz przeglądać faktury działu, ale nie możesz ich edytować ani zatwierdzać.
              </li>
              <li>
                <strong>Dostęp do obiegu</strong> - Możesz przeglądać, edytować i brać udział w obiegu faktur działu.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
