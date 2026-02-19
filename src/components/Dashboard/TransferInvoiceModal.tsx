import { useState, useEffect } from 'react';
import { X, ArrowRight, Building2, User, AlertCircle, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getAccessibleDepartments } from '../../lib/departmentUtils';

interface Department {
  id: string;
  name: string;
}

interface DepartmentUser {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface TransferInvoiceModalProps {
  invoiceId: string;
  currentDepartmentId: string | null;
  currentInvoiceStatus: string;
  uploadedBy: string;
  onClose: () => void;
  onTransferToApproval: () => Promise<void>;
  onTransferToDepartment: (departmentId: string, userId: string) => Promise<void>;
  onDirectApproval?: () => Promise<void>;
  onAdminApproval?: () => Promise<void>;
}

export function TransferInvoiceModal({
  invoiceId,
  currentDepartmentId,
  currentInvoiceStatus,
  uploadedBy,
  onClose,
  onTransferToApproval,
  onTransferToDepartment,
  onDirectApproval,
  onAdminApproval,
}: TransferInvoiceModalProps) {
  const { profile } = useAuth();
  const [transferMode, setTransferMode] = useState<'approval' | 'department' | 'direct_approval' | 'admin_approval' | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentUsers, setDepartmentUsers] = useState<DepartmentUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaderRole, setUploaderRole] = useState<string | null>(null);

  useEffect(() => {
    if (uploadedBy && uploadedBy !== profile?.id) {
      loadUploaderRole();
    }
  }, [uploadedBy, profile?.id]);

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDepartment) {
      loadDepartmentUsers(selectedDepartment);
    } else {
      setDepartmentUsers([]);
      setSelectedUser('');
    }
  }, [selectedDepartment]);

  async function loadDepartments() {
    try {
      const depts = await getAccessibleDepartments(profile);
      setDepartments(depts);
    } catch (err) {
      console.error('Error loading departments:', err);
      setError('Nie udało się załadować działów');
    }
  }

  async function loadUploaderRole() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', uploadedBy)
        .single();

      if (error) throw error;
      setUploaderRole(data?.role || null);
    } catch (err) {
      console.error('Error loading uploader role:', err);
      setUploaderRole(null);
    }
  }

  async function loadDepartmentUsers(departmentId: string) {
    try {
      const [primaryResult, membersResult, departmentResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .eq('department_id', departmentId)
          .order('full_name'),
        supabase
          .from('department_members')
          .select(`
            user_id,
            profiles:user_id (
              id,
              full_name,
              email,
              role
            )
          `)
          .eq('department_id', departmentId),
        supabase
          .from('departments')
          .select('manager_id, director_id')
          .eq('id', departmentId)
          .single()
      ]);

      if (primaryResult.error) throw primaryResult.error;

      const users: DepartmentUser[] = [...(primaryResult.data || [])];

      if (!membersResult.error && membersResult.data) {
        membersResult.data.forEach((member: any) => {
          if (member.profiles && !users.find(u => u.id === member.profiles.id)) {
            users.push(member.profiles);
          }
        });
      }

      // Dodaj kierownika i dyrektora jeśli nie są już na liście
      if (departmentResult.data?.manager_id) {
        const { data: manager } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .eq('id', departmentResult.data.manager_id)
          .single();

        if (manager && !users.find(u => u.id === manager.id)) {
          users.push(manager);
        }
      }

      if (departmentResult.data?.director_id) {
        const { data: director } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .eq('id', departmentResult.data.director_id)
          .single();

        if (director && !users.find(u => u.id === director.id)) {
          users.push(director);
        }
      }

      users.sort((a, b) => a.full_name.localeCompare(b.full_name));

      // Domyślnie wybierz kierownika, potem dyrektora, potem pierwszego użytkownika
      if (departmentResult.data?.manager_id) {
        setSelectedUser(departmentResult.data.manager_id);
      } else if (departmentResult.data?.director_id) {
        setSelectedUser(departmentResult.data.director_id);
      } else if (users.length > 0) {
        setSelectedUser(users[0].id);
      }

      setDepartmentUsers(users);
    } catch (err) {
      console.error('Error loading department users:', err);
      setDepartmentUsers([]);
    }
  }

  async function handleSubmit() {
    if (transferMode === 'approval') {
      setLoading(true);
      try {
        await onTransferToApproval();
        onClose();
      } catch (err) {
        setError('Nie udało się przesłać do akceptacji');
      } finally {
        setLoading(false);
      }
    } else if (transferMode === 'department') {
      if (!selectedDepartment || !selectedUser) {
        setError('Proszę wybrać dział i osobę');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        await onTransferToDepartment(selectedDepartment, selectedUser);
        onClose();
      } catch (err: any) {
        console.error('Transfer error details:', err);
        const errorMessage = err?.message || err?.toString() || 'Nie udało się przesłać do innego działu';
        setError(`Błąd: ${errorMessage}`);
      } finally {
        setLoading(false);
      }
    } else if (transferMode === 'direct_approval') {
      if (!onDirectApproval) {
        setError('Funkcja akceptacji nie jest dostępna');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        await onDirectApproval();
        onClose();
      } catch (err: any) {
        console.error('Direct approval error details:', err);
        const errorMessage = err?.message || err?.toString() || 'Nie udało się zaakceptować faktury';
        setError(`Błąd: ${errorMessage}`);
      } finally {
        setLoading(false);
      }
    } else if (transferMode === 'admin_approval') {
      if (!onAdminApproval) {
        setError('Funkcja akceptacji administracyjnej nie jest dostępna');
        return;
      }

      setLoading(true);
      setError(null);
      try {
        await onAdminApproval();
        onClose();
      } catch (err: any) {
        console.error('Admin approval error:', err);
        const errorMessage = err?.message || err?.toString() || 'Nie udało się wykonać akceptacji administracyjnej';
        setError(`Błąd: ${errorMessage}`);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
      <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold text-text-primary-light dark:text-text-primary-dark">
            Prześlij fakturę
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
          >
            <X className="w-5 h-5 text-text-primary-light dark:text-text-primary-dark" />
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {!transferMode ? (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
              Wybierz sposób przesłania faktury:
            </p>

            <button
              onClick={() => setTransferMode('approval')}
              className="w-full flex items-center gap-3 p-4 border-2 border-slate-300 dark:border-slate-600 rounded-lg hover:border-brand-primary dark:hover:border-brand-primary hover:bg-brand-primary/5 dark:hover:bg-brand-primary/10 transition group"
            >
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-900/50 transition">
                <ArrowRight className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium text-text-primary-light dark:text-text-primary-dark">
                  Prześlij do akceptacji
                </p>
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                  Normalny proces akceptacji w Twoim dziale
                </p>
              </div>
            </button>

            <button
              onClick={() => setTransferMode('department')}
              className="w-full flex items-center gap-3 p-4 border-2 border-slate-300 dark:border-slate-600 rounded-lg hover:border-brand-primary dark:hover:border-brand-primary hover:bg-brand-primary/5 dark:hover:bg-brand-primary/10 transition group"
            >
              <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg group-hover:bg-purple-200 dark:group-hover:bg-purple-900/50 transition">
                <Building2 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-medium text-text-primary-light dark:text-text-primary-dark">
                  Prześlij do innego działu
                </p>
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                  Wybierz dział i osobę do której ma trafić
                </p>
              </div>
            </button>

            {onDirectApproval &&
              currentInvoiceStatus === 'draft' &&
              uploadedBy !== profile?.id &&
              (
                (profile?.role === 'Kierownik' && uploaderRole === 'Specjalista') ||
                (profile?.role === 'Dyrektor' && (uploaderRole === 'Specjalista' || uploaderRole === 'Kierownik'))
              ) && (
              <button
                onClick={() => setTransferMode('direct_approval')}
                className="w-full flex items-center gap-3 p-4 border-2 border-slate-300 dark:border-slate-600 rounded-lg hover:border-brand-primary dark:hover:border-brand-primary hover:bg-brand-primary/5 dark:hover:bg-brand-primary/10 transition group"
              >
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg group-hover:bg-emerald-200 dark:group-hover:bg-emerald-900/50 transition">
                  <User className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-text-primary-light dark:text-text-primary-dark">
                    Zaakceptuj fakturę
                  </p>
                  <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                    Zaakceptuj w imieniu podwładnego i w swoim
                  </p>
                </div>
              </button>
            )}

            {onAdminApproval && (
              <button
                onClick={() => setTransferMode('admin_approval')}
                className="w-full flex items-center gap-3 p-4 border-2 border-amber-300 dark:border-amber-700 rounded-lg hover:border-amber-500 dark:hover:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition group"
              >
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg group-hover:bg-amber-200 dark:group-hover:bg-amber-900/50 transition">
                  <ShieldCheck className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-text-primary-light dark:text-text-primary-dark">
                    Akceptacja administracyjna
                  </p>
                  <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
                    Zatwierdz z pominięciem obiegu dokumentów
                  </p>
                </div>
              </button>
            )}
          </div>
        ) : transferMode === 'department' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                Wybierz dział
              </label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                disabled={loading}
              >
                <option value="">Wybierz dział</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedDepartment && departmentUsers.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Wybierz osobę
                </label>
                <select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                  disabled={loading}
                >
                  {departmentUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name} ({user.role})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-2">
                  Domyślnie wybrany jest kierownik działu lub dyrektor jeśli nie ma kierownika
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setTransferMode(null);
                  setSelectedDepartment('');
                  setSelectedUser('');
                  setError(null);
                }}
                disabled={loading}
                className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium disabled:opacity-50"
              >
                Wstecz
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !selectedDepartment || !selectedUser}
                className="flex-1 px-4 py-2.5 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Przesyłanie...</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4" />
                    <span>Prześlij</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : transferMode === 'approval' ? (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Faktura zostanie przesłana do następnej osoby w hierarchii akceptacji w Twoim dziale.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setTransferMode(null)}
                disabled={loading}
                className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium disabled:opacity-50"
              >
                Wstecz
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Przesyłanie...</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4" />
                    <span>Prześlij do akceptacji</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : transferMode === 'direct_approval' ? (
          <div className="space-y-4">
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
              <p className="text-sm text-emerald-800 dark:text-emerald-200">
                <strong>Bezpośrednia akceptacja</strong>
              </p>
              <p className="text-sm text-emerald-700 dark:text-emerald-300 mt-2">
                {profile?.role === 'Dyrektor'
                  ? 'Faktura zostanie zaakceptowana automatycznie w imieniu Kierownika i w Twoim imieniu jako Dyrektor. Przejdzie dalej w workflow jeśli wymagana jest jeszcze akceptacja CEO.'
                  : 'Faktura zostanie zaakceptowana w Twoim imieniu jako Kierownik i przejdzie dalej do Dyrektora.'}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setTransferMode(null)}
                disabled={loading}
                className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium disabled:opacity-50"
              >
                Wstecz
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Akceptuję...</span>
                  </>
                ) : (
                  <>
                    <User className="w-4 h-4" />
                    <span>Zaakceptuj</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : transferMode === 'admin_approval' ? (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">
                Akceptacja administracyjna
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Faktura zostanie natychmiast zatwierdzona z pominięciem całego obiegu dokumentów.
                Zostaną automatycznie dodane wpisy akceptacji dla wszystkich pominiętych osób.
                Kwota faktury zostanie wliczona w limity działu.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setTransferMode(null)}
                disabled={loading}
                className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium disabled:opacity-50"
              >
                Wstecz
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Akceptuję...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Zatwierdz administracyjnie</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
