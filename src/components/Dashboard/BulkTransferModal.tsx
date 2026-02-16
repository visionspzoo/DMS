import { useState, useEffect } from 'react';
import { X, ArrowRight, Building2, User, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

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

interface BulkTransferModalProps {
  invoiceIds: string[];
  onClose: () => void;
  onTransferComplete: () => void;
}

export function BulkTransferModal({
  invoiceIds,
  onClose,
  onTransferComplete,
}: BulkTransferModalProps) {
  const { profile } = useAuth();
  const [transferMode, setTransferMode] = useState<'approval' | 'department' | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentUsers, setDepartmentUsers] = useState<DepartmentUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setDepartments(data || []);
    } catch (err) {
      console.error('Error loading departments:', err);
      setError('Nie udało się załadować działów');
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
        for (const member of membersResult.data) {
          const prof = (member as any).profiles;
          if (prof && !users.some(u => u.id === prof.id)) {
            users.push(prof);
          }
        }
      }

      if (!departmentResult.error && departmentResult.data) {
        if (departmentResult.data.manager_id && !users.some(u => u.id === departmentResult.data.manager_id)) {
          const { data: managerData } = await supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .eq('id', departmentResult.data.manager_id)
            .single();
          if (managerData) users.push(managerData);
        }
        if (departmentResult.data.director_id && !users.some(u => u.id === departmentResult.data.director_id)) {
          const { data: directorData } = await supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .eq('id', departmentResult.data.director_id)
            .single();
          if (directorData) users.push(directorData);
        }
      }

      users.sort((a, b) => a.full_name.localeCompare(b.full_name));
      setDepartmentUsers(users);
    } catch (err) {
      console.error('Error loading department users:', err);
      setError('Nie udało się załadować użytkowników działu');
    }
  }

  async function handleTransferToApproval() {
    setLoading(true);
    setError(null);

    try {
      for (const invoiceId of invoiceIds) {
        const { data: invoice, error: fetchError } = await supabase
          .from('invoices')
          .select('department_id')
          .eq('id', invoiceId)
          .single();

        if (fetchError) throw fetchError;

        if (!invoice.department_id) {
          throw new Error('Faktura nie ma przypisanego działu');
        }

        const { data: dept } = await supabase
          .from('departments')
          .select('manager_id')
          .eq('id', invoice.department_id)
          .single();

        if (!dept?.manager_id) {
          throw new Error('Dział nie ma przypisanego kierownika');
        }

        const { error: updateError } = await supabase
          .from('invoices')
          .update({
            status: 'waiting',
            current_approver_id: dept.manager_id,
          })
          .eq('id', invoiceId);

        if (updateError) throw updateError;
      }

      onTransferComplete();
    } catch (err: any) {
      console.error('Error transferring invoices to approval:', err);
      setError(err.message || 'Nie udało się przesłać faktur do akceptacji');
    } finally {
      setLoading(false);
    }
  }

  async function handleTransferToDepartment() {
    if (!selectedDepartment || !selectedUser) {
      setError('Wybierz dział i użytkownika');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      for (const invoiceId of invoiceIds) {
        const { error } = await supabase.rpc('transfer_invoice', {
          p_invoice_id: invoiceId,
          p_target_department_id: selectedDepartment,
          p_target_user_id: selectedUser,
        });

        if (error) {
          const { error: fallbackError } = await supabase
            .from('invoices')
            .update({
              department_id: selectedDepartment,
              current_approver_id: selectedUser,
              status: 'draft',
            })
            .eq('id', invoiceId);

          if (fallbackError) throw fallbackError;
        }
      }

      onTransferComplete();
    } catch (err: any) {
      console.error('Error transferring invoices to department:', err);
      setError(err.message || 'Nie udało się przesłać faktur do działu');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-light-surface dark:bg-dark-surface border-b border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark">
            Prześlij faktury ({invoiceIds.length})
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {!transferMode ? (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
                Wybierz sposób przesłania faktur:
              </p>

              <button
                onClick={() => setTransferMode('approval')}
                className="w-full p-4 border-2 border-slate-200 dark:border-slate-700 rounded-lg hover:border-brand-primary dark:hover:border-brand-primary transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-lg group-hover:bg-brand-primary/20">
                    <ArrowRight className="w-5 h-5 text-brand-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Prześlij do akceptacji
                    </h3>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      Przekaż faktury do kierownika działu do zatwierdzenia
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setTransferMode('department')}
                className="w-full p-4 border-2 border-slate-200 dark:border-slate-700 rounded-lg hover:border-brand-primary dark:hover:border-brand-primary transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 dark:bg-blue-500/20 rounded-lg group-hover:bg-blue-500/20">
                    <Building2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Prześlij do innego działu
                    </h3>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      Przenieś faktury do wybranego działu i użytkownika
                    </p>
                  </div>
                </div>
              </button>
            </div>
          ) : transferMode === 'approval' ? (
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Faktury zostaną przesłane do kierownika odpowiedniego działu z prośbą o akceptację.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setTransferMode(null)}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-medium"
                >
                  Wstecz
                </button>
                <button
                  onClick={handleTransferToApproval}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg transition-colors font-medium disabled:opacity-50"
                >
                  {loading ? 'Przesyłanie...' : 'Prześlij'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  <Building2 className="w-4 h-4 inline mr-1" />
                  Wybierz dział
                </label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark"
                >
                  <option value="">-- Wybierz dział --</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedDepartment && (
                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                    <User className="w-4 h-4 inline mr-1" />
                    Wybierz użytkownika
                  </label>
                  <select
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark"
                  >
                    <option value="">-- Wybierz użytkownika --</option>
                    {departmentUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name} ({user.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setTransferMode(null)}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-medium"
                >
                  Wstecz
                </button>
                <button
                  onClick={handleTransferToDepartment}
                  disabled={loading || !selectedDepartment || !selectedUser}
                  className="flex-1 px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-lg transition-colors font-medium disabled:opacity-50"
                >
                  {loading ? 'Przesyłanie...' : 'Prześlij'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
