import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, Edit2, Trash2, Save, X, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface CostCenter {
  id: string;
  code: string;
  description: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function CostCentersManagement() {
  const { profile } = useAuth();
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newEntry, setNewEntry] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const isAdmin = profile?.is_admin === true;

  useEffect(() => {
    loadCostCenters();
  }, []);

  const loadCostCenters = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('cost_centers')
        .select('*')
        .order('display_order', { ascending: true });

      if (fetchError) throw fetchError;
      setCostCenters(data || []);
    } catch (err: any) {
      console.error('Error loading cost centers:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const parseEntry = (entry: string): { code: string; description: string } | null => {
    const trimmed = entry.trim();
    const parts = trimmed.split(/\s+/);

    if (parts.length < 2) {
      return null;
    }

    const code = parts[0];
    const description = parts.slice(1).join(' ');

    return { code, description };
  };

  const handleAddCostCenter = async () => {
    if (!newEntry.trim()) {
      setError('Wprowadź kod i opis MPK');
      return;
    }

    const lines = newEntry.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (lines.length === 0) {
      setError('Wprowadź przynajmniej jeden kod MPK');
      return;
    }

    const parsedEntries: Array<{ code: string; description: string }> = [];
    const failedLines: string[] = [];

    for (const line of lines) {
      const parsed = parseEntry(line);
      if (parsed) {
        parsedEntries.push(parsed);
      } else {
        failedLines.push(line);
      }
    }

    if (parsedEntries.length === 0) {
      setError('Nie znaleziono żadnych poprawnych kodów MPK. Użyj formatu: KOD Opis (np. "010-1 Grunty i prawa użytkowania")');
      return;
    }

    try {
      setError('');
      setAdding(true);

      const maxOrder = costCenters.length > 0
        ? Math.max(...costCenters.map(cc => cc.display_order))
        : 0;

      const recordsToInsert = parsedEntries.map((entry, index) => ({
        code: entry.code,
        description: entry.description,
        display_order: maxOrder + index + 1,
        is_active: true,
      }));

      const { error: insertError } = await supabase
        .from('cost_centers')
        .insert(recordsToInsert);

      if (insertError) throw insertError;

      let successMessage = `Dodano ${parsedEntries.length} ${parsedEntries.length === 1 ? 'kod' : parsedEntries.length < 5 ? 'kody' : 'kodów'} MPK`;
      if (failedLines.length > 0) {
        successMessage += `. Pominięto ${failedLines.length} niepoprawnych linii.`;
      }

      setSuccess(successMessage);
      setNewEntry('');
      await loadCostCenters();

      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      console.error('Error adding cost centers:', err);
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleStartEdit = (costCenter: CostCenter) => {
    setEditingId(costCenter.id);
    setEditCode(costCenter.code);
    setEditDescription(costCenter.description);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditCode('');
    setEditDescription('');
  };

  const handleSaveEdit = async (id: string) => {
    if (!editCode.trim() || !editDescription.trim()) {
      setError('Kod i opis nie mogą być puste');
      return;
    }

    try {
      setError('');

      const { error: updateError } = await supabase
        .from('cost_centers')
        .update({
          code: editCode.trim(),
          description: editDescription.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) throw updateError;

      setSuccess('Zaktualizowano kod MPK');
      setEditingId(null);
      await loadCostCenters();

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Error updating cost center:', err);
      setError(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten kod MPK?')) {
      return;
    }

    try {
      setError('');

      const { error: deleteError } = await supabase
        .from('cost_centers')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setSuccess('Usunięto kod MPK');
      await loadCostCenters();

      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Error deleting cost center:', err);
      setError(err.message);
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      setError('');

      const { error: updateError } = await supabase
        .from('cost_centers')
        .update({
          is_active: !currentStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) throw updateError;

      await loadCostCenters();
    } catch (err: any) {
      console.error('Error toggling cost center status:', err);
      setError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-text-secondary-light dark:text-text-secondary-dark">Ładowanie...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
        <p className="text-sm text-red-800 dark:text-red-200">
          Tylko administratorzy mogą zarządzać miejscami powstawania kosztów.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Miejsca Powstawania Kosztów (MPK)
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Zarządzaj kodami MPK dostępnymi dla wszystkich działów. Kody są używane przy klasyfikacji faktur. Możesz dodać wiele kodów jednocześnie - każdy w osobnej linii.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg p-4">
          <p className="text-sm text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}

      <div className="bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg p-5">
        <h4 className="font-medium text-text-primary-light dark:text-text-primary-dark mb-4">
          Dodaj kody MPK (import masowy)
        </h4>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
              Kody i opisy (jeden kod na linię)
            </label>
            <textarea
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              placeholder="Wpisz kody w formacie: KOD Opis (jeden kod na linię)&#10;Przykład:&#10;010-1 Grunty i prawa użytkowania&#10;010-2 Budynki i lokale&#10;010-3 Urządzenia techniczne i maszyny"
              rows={8}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent font-mono"
            />
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Format: KOD Opis (jeden kod na linię). Możesz wkleić wiele kodów jednocześnie - każdy zostanie dodany jako osobny rekord.
            </p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleAddCostCenter}
              disabled={adding || !newEntry.trim()}
              className="px-6 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition font-medium text-sm"
            >
              <Plus className="w-4 h-4" />
              {adding ? 'Dodawanie...' : 'Dodaj kody MPK'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700/50">
          <h4 className="font-medium text-text-primary-light dark:text-text-primary-dark">
            Lista kodów MPK ({costCenters.length})
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Kod
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Opis
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Akcje
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {costCenters.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-text-secondary-light dark:text-text-secondary-dark">
                    Brak kodów MPK. Dodaj pierwszy kod używając formularza powyżej.
                  </td>
                </tr>
              ) : (
                costCenters.map((cc) => (
                  <tr key={cc.id} className="hover:bg-slate-50 dark:hover:bg-dark-surface-variant transition">
                    {editingId === cc.id ? (
                      <>
                        <td className="px-6 py-4">
                          <input
                            type="text"
                            value={editCode}
                            onChange={(e) => setEditCode(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-sm bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <input
                            type="text"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-sm bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                          />
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            cc.is_active
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                              : 'bg-gray-100 dark:bg-gray-900/30 text-gray-800 dark:text-gray-300'
                          }`}>
                            {cc.is_active ? 'Aktywny' : 'Nieaktywny'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleSaveEdit(cc.id)}
                              className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition"
                              title="Zapisz"
                            >
                              <Save className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleCancelEdit}
                              className="p-1.5 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900/20 rounded transition"
                              title="Anuluj"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 text-sm font-mono font-medium text-text-primary-light dark:text-text-primary-dark">
                          {cc.code}
                        </td>
                        <td className="px-6 py-4 text-sm text-text-primary-light dark:text-text-primary-dark">
                          {cc.description}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => handleToggleActive(cc.id, cc.is_active)}
                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full transition ${
                              cc.is_active
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50'
                                : 'bg-gray-100 dark:bg-gray-900/30 text-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-900/50'
                            }`}
                          >
                            {cc.is_active ? 'Aktywny' : 'Nieaktywny'}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleStartEdit(cc)}
                              className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition"
                              title="Edytuj"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(cc.id)}
                              className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition"
                              title="Usuń"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
