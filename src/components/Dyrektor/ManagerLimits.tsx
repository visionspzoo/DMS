import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { DollarSign, Save, AlertCircle, X, Users } from 'lucide-react';

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

interface ManagerLimitsProps {
  userId: string;
  onBack: () => void;
}

export default function ManagerLimits({ userId, onBack }: ManagerLimitsProps) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [limits, setLimits] = useState<ManagerLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingManager, setEditingManager] = useState<string | null>(null);
  const [singleLimit, setSingleLimit] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      await Promise.all([loadManagers(), loadLimits()]);
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

  function getManagerLimit(managerId: string): ManagerLimit | undefined {
    return limits.find(l => l.manager_id === managerId);
  }

  function handleEditManager(managerId: string) {
    const limit = getManagerLimit(managerId);
    setEditingManager(managerId);
    setSingleLimit(limit?.single_invoice_limit.toString() || '0');
    setMonthlyLimit(limit?.monthly_limit.toString() || '0');
    setError(null);
  }

  async function handleSaveLimit(managerId: string) {
    const singleLimitNum = parseFloat(singleLimit);
    const monthlyLimitNum = parseFloat(monthlyLimit);

    if (isNaN(singleLimitNum) || singleLimitNum < 0) {
      setError('Single invoice limit must be a valid positive number');
      return;
    }

    if (isNaN(monthlyLimitNum) || monthlyLimitNum < 0) {
      setError('Monthly limit must be a valid positive number');
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
            monthly_limit: monthlyLimitNum
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
            monthly_limit: monthlyLimitNum
          });

        if (error) throw error;
      }

      setSuccess('Limits updated successfully');
      setEditingManager(null);
      setSingleLimit('');
      setMonthlyLimit('');
      loadLimits();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update limits');
    }
  }

  function handleCancel() {
    setEditingManager(null);
    setSingleLimit('');
    setMonthlyLimit('');
    setError(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <DollarSign className="w-8 h-8 text-slate-700" />
              <h1 className="text-3xl font-bold text-slate-900">Manager Limits</h1>
            </div>
            <p className="text-slate-600">Set spending limits for managers</p>
          </div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-600 text-white font-medium rounded-lg hover:bg-slate-700 transition-all"
          >
            <X className="w-4 h-4" />
            Back
          </button>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Error</h3>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
            <DollarSign className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-900">Success</h3>
              <p className="text-green-700 text-sm">{success}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-600" />
              <h2 className="text-lg font-semibold text-slate-900">Managers</h2>
            </div>
          </div>

          <div className="divide-y divide-slate-200">
            {managers.map((manager) => {
              const limit = getManagerLimit(manager.id);
              const isEditing = editingManager === manager.id;

              return (
                <div key={manager.id} className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{manager.full_name}</h3>
                      <p className="text-sm text-slate-500">{manager.email}</p>
                    </div>
                    {!isEditing && (
                      <button
                        onClick={() => handleEditManager(manager.id)}
                        className="px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition-colors"
                      >
                        Edit Limits
                      </button>
                    )}
                  </div>

                  {isEditing ? (
                    <div className="space-y-4 bg-slate-50 rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Single Invoice Limit (PLN)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={singleLimit}
                            onChange={(e) => setSingleLimit(e.target.value)}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0.00"
                          />
                          <p className="text-xs text-slate-500 mt-1">
                            Maximum amount for a single invoice
                          </p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Monthly Limit (PLN)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={monthlyLimit}
                            onChange={(e) => setMonthlyLimit(e.target.value)}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0.00"
                          />
                          <p className="text-xs text-slate-500 mt-1">
                            Maximum total amount per month
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleSaveLimit(manager.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all"
                        >
                          <Save className="w-4 h-4" />
                          Save Limits
                        </button>
                        <button
                          onClick={handleCancel}
                          className="px-4 py-2 text-slate-600 font-medium hover:text-slate-900 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-blue-50 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <DollarSign className="w-4 h-4 text-blue-600" />
                          <h4 className="text-sm font-medium text-blue-900">Single Invoice Limit</h4>
                        </div>
                        <p className="text-2xl font-bold text-blue-900">
                          {limit?.single_invoice_limit.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) || '0.00'}
                          <span className="text-sm font-normal ml-1">PLN</span>
                        </p>
                        {!limit && (
                          <p className="text-xs text-blue-600 mt-1">No limit set</p>
                        )}
                      </div>
                      <div className="bg-green-50 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <DollarSign className="w-4 h-4 text-green-600" />
                          <h4 className="text-sm font-medium text-green-900">Monthly Limit</h4>
                        </div>
                        <p className="text-2xl font-bold text-green-900">
                          {limit?.monthly_limit.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) || '0.00'}
                          <span className="text-sm font-normal ml-1">PLN</span>
                        </p>
                        {!limit && (
                          <p className="text-xs text-green-600 mt-1">No limit set</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {managers.length === 0 && (
            <div className="px-6 py-12 text-center text-slate-500">
              No managers found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
