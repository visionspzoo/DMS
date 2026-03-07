import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { DollarSign, Save, AlertCircle, X, Users, Zap, CheckCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface Manager {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface ManagerLimit {
  id: string;
  manager_id: string;
  single_invoice_limit: number;
  monthly_limit: number;
  manager?: Manager;
}

interface PurchaseRequestLimit {
  user_id: string;
  auto_approve_limit: number | null;
}

interface ManagerLimitsProps {
  userId: string;
  onBack: () => void;
}

const fmt = (val: number | null | undefined) =>
  val !== null && val !== undefined
    ? new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 }).format(val)
    : null;

export default function ManagerLimits({ userId, onBack }: ManagerLimitsProps) {
  const { user } = useAuth();
  const [managers, setManagers] = useState<Manager[]>([]);
  const [limits, setLimits] = useState<ManagerLimit[]>([]);
  const [prLimits, setPrLimits] = useState<PurchaseRequestLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingManager, setEditingManager] = useState<string | null>(null);
  const [singleLimit, setSingleLimit] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [autoApproveInput, setAutoApproveInput] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      await Promise.all([loadManagers(), loadLimits(), loadPrLimits()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadManagers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('role', 'Kierownik')
      .order('full_name');

    if (error) throw error;
    setManagers(data || []);
  }

  async function loadLimits() {
    const { data, error } = await supabase
      .from('manager_limits')
      .select(`
        id,
        manager_id,
        single_invoice_limit,
        monthly_limit,
        manager:manager_id(id, full_name, email, role)
      `);

    if (error) throw error;
    setLimits(data || []);
  }

  async function loadPrLimits() {
    const { data } = await supabase
      .from('purchase_request_limits')
      .select('user_id, auto_approve_limit');
    setPrLimits(data || []);
  }

  function getManagerLimit(managerId: string): ManagerLimit | undefined {
    return limits.find(l => l.manager_id === managerId);
  }

  function getPrLimit(managerId: string): PurchaseRequestLimit | undefined {
    return prLimits.find(l => l.user_id === managerId);
  }

  function handleEditManager(managerId: string) {
    const limit = getManagerLimit(managerId);
    const prLimit = getPrLimit(managerId);
    setEditingManager(managerId);
    setSingleLimit(limit?.single_invoice_limit.toString() || '0');
    setMonthlyLimit(limit?.monthly_limit.toString() || '0');
    setAutoApproveInput(prLimit?.auto_approve_limit != null ? String(prLimit.auto_approve_limit) : '');
    setError(null);
  }

  async function handleSaveLimit(managerId: string) {
    const singleLimitNum = parseFloat(singleLimit);
    const monthlyLimitNum = parseFloat(monthlyLimit);

    if (isNaN(singleLimitNum) || singleLimitNum < 0) {
      setError('Limit pojedynczej faktury musi być poprawną liczbą nieujemną');
      return;
    }

    if (isNaN(monthlyLimitNum) || monthlyLimitNum < 0) {
      setError('Limit miesięczny musi być poprawną liczbą nieujemną');
      return;
    }

    const autoApproveVal = autoApproveInput.trim() !== '' ? parseFloat(autoApproveInput) : null;
    if (autoApproveVal !== null && (isNaN(autoApproveVal) || autoApproveVal < 0)) {
      setError('Limit auto-akceptacji wniosku musi być poprawną liczbą nieujemną');
      return;
    }

    try {
      setError(null);
      const existingLimit = getManagerLimit(managerId);

      if (existingLimit) {
        const { error } = await supabase
          .from('manager_limits')
          .update({
            single_invoice_limit: singleLimitNum,
            monthly_limit: monthlyLimitNum,
          })
          .eq('manager_id', managerId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('manager_limits')
          .insert({
            manager_id: managerId,
            set_by: userId,
            single_invoice_limit: singleLimitNum,
            monthly_limit: monthlyLimitNum,
          });
        if (error) throw error;
      }

      const existingPrLimit = getPrLimit(managerId);
      if (existingPrLimit) {
        const { error } = await supabase
          .from('purchase_request_limits')
          .update({ auto_approve_limit: autoApproveVal })
          .eq('user_id', managerId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('purchase_request_limits')
          .insert({
            user_id: managerId,
            set_by: user?.id ?? userId,
            auto_approve_limit: autoApproveVal,
          });
        if (error) throw error;
      }

      setSuccess('Limity zostały zaktualizowane');
      setEditingManager(null);
      setSingleLimit('');
      setMonthlyLimit('');
      setAutoApproveInput('');
      await Promise.all([loadLimits(), loadPrLimits()]);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd podczas aktualizacji limitów');
    }
  }

  function handleCancel() {
    setEditingManager(null);
    setSingleLimit('');
    setMonthlyLimit('');
    setAutoApproveInput('');
    setError(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
      </div>
    );
  }

  return (
    <div className="bg-light-surface-variant dark:bg-dark-surface-variant min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <DollarSign className="w-7 h-7 text-brand-primary" />
              <h1 className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">Limity kierowników</h1>
            </div>
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Ustaw limity zatwierdzania faktur oraz auto-akceptacji wniosków zakupowych dla kierowników
            </p>
          </div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-light-surface dark:hover:bg-dark-surface transition-colors"
          >
            <X className="w-4 h-4" />
            Wróć
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-start gap-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-green-800 dark:text-green-300">{success}</p>
          </div>
        )}

        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">Kierownicy</h2>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {managers.map((manager) => {
              const limit = getManagerLimit(manager.id);
              const prLimit = getPrLimit(manager.id);
              const isEditing = editingManager === manager.id;

              return (
                <div key={manager.id} className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                        {manager.full_name}
                      </h3>
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{manager.email}</p>
                    </div>
                    {!isEditing && (
                      <button
                        onClick={() => handleEditManager(manager.id)}
                        className="px-3 py-1.5 text-xs font-medium text-brand-primary hover:bg-brand-primary/10 dark:hover:bg-brand-primary/20 rounded-lg transition-colors"
                      >
                        Edytuj limity
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700/50">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                            Limit pojedynczej faktury (PLN)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={singleLimit}
                            onChange={(e) => setSingleLimit(e.target.value)}
                            className="w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                            Limit miesięczny (PLN)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={monthlyLimit}
                            onChange={(e) => setMonthlyLimit(e.target.value)}
                            className="w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
                            placeholder="0.00"
                          />
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                            Limit auto-akceptacji wniosku zakupowego
                          </span>
                        </div>
                        <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-2">
                          Wnioski zakupowe do tej kwoty będą automatycznie akceptowane bez potrzeby akceptacji przez dyrektora. Pozostaw puste, aby wymagać akceptacji przy każdym wniosku.
                        </p>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={autoApproveInput}
                          onChange={(e) => setAutoApproveInput(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-emerald-300 dark:border-emerald-700 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                          placeholder="np. 5000.00 (puste = zawsze wymagana akceptacja dyrektora)"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveLimit(manager.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white text-xs font-medium rounded-lg hover:bg-brand-primary/90 transition-colors"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Zapisz
                        </button>
                        <button
                          onClick={handleCancel}
                          className="px-3 py-1.5 text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                        >
                          Anuluj
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                        <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Pojedyncza faktura</div>
                        {limit ? (
                          <div className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                            {fmt(limit.single_invoice_limit)}
                          </div>
                        ) : (
                          <div className="text-xs italic text-text-secondary-light dark:text-text-secondary-dark">Brak limitu</div>
                        )}
                      </div>
                      <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                        <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Miesięczny</div>
                        {limit ? (
                          <div className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                            {fmt(limit.monthly_limit)}
                          </div>
                        ) : (
                          <div className="text-xs italic text-text-secondary-light dark:text-text-secondary-dark">Brak limitu</div>
                        )}
                      </div>
                      <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-100 dark:border-emerald-800/30">
                        <div className="flex items-center gap-1 mb-0.5">
                          <Zap className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <div className="text-xs text-emerald-700 dark:text-emerald-400">Auto-akceptacja wniosku</div>
                        </div>
                        {prLimit?.auto_approve_limit != null ? (
                          <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                            {fmt(prLimit.auto_approve_limit)}
                          </div>
                        ) : (
                          <div className="text-xs italic text-text-secondary-light dark:text-text-secondary-dark">Wymagana akceptacja</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {managers.length === 0 && (
            <div className="px-6 py-12 text-center text-text-secondary-light dark:text-text-secondary-dark text-sm">
              Brak kierowników
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
