import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Plus, Trash2, Building2, AlertCircle } from 'lucide-react';

interface NIPMapping {
  id: string;
  nip: string;
  department_id: string;
  department_name?: string;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
}

export function KSEFConfiguration() {
  const { user } = useAuth();
  const [mappings, setMappings] = useState<NIPMapping[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newNIP, setNewNIP] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [adding, setAdding] = useState(false);

  const canManageMappings = user?.role !== 'specialist';

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);

      const [mappingsResult, departmentsResult] = await Promise.all([
        supabase
          .from('ksef_nip_department_mappings')
          .select(`
            id,
            nip,
            department_id,
            created_at,
            departments:department_id (
              name
            )
          `)
          .order('created_at', { ascending: false }),
        supabase
          .from('departments')
          .select('id, name')
          .order('name')
      ]);

      if (mappingsResult.error) throw mappingsResult.error;
      if (departmentsResult.error) throw departmentsResult.error;

      const formattedMappings = mappingsResult.data.map((m: any) => ({
        ...m,
        department_name: m.departments?.name
      }));

      setMappings(formattedMappings);
      setDepartments(departmentsResult.data || []);
    } catch (err) {
      console.error('Error loading configuration:', err);
      setError('Nie udało się załadować konfiguracji');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMapping() {
    if (!newNIP || !selectedDepartment) {
      setError('Proszę podać NIP i wybrać dział');
      return;
    }

    const cleanNIP = newNIP.replace(/[^0-9]/g, '');
    if (cleanNIP.length !== 10) {
      setError('NIP musi zawierać dokładnie 10 cyfr');
      return;
    }

    try {
      setAdding(true);
      setError(null);
      setSuccess(null);

      const { error: insertError } = await supabase
        .from('ksef_nip_department_mappings')
        .insert({
          nip: cleanNIP,
          department_id: selectedDepartment,
          created_by: user?.id
        });

      if (insertError) throw insertError;

      setSuccess('Pomyślnie dodano mapowanie NIP');
      setNewNIP('');
      setSelectedDepartment('');
      await loadData();
    } catch (err: any) {
      console.error('Error adding mapping:', err);
      if (err.code === '23505') {
        setError('Ten NIP już jest przypisany do działu');
      } else {
        setError('Nie udało się dodać mapowania');
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteMapping(id: string) {
    if (!confirm('Czy na pewno chcesz usunąć to mapowanie?')) return;

    try {
      setError(null);
      setSuccess(null);

      const { error: deleteError } = await supabase
        .from('ksef_nip_department_mappings')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setSuccess('Pomyślnie usunięto mapowanie');
      await loadData();
    } catch (err) {
      console.error('Error deleting mapping:', err);
      setError('Nie udało się usunąć mapowania');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Konfiguracja automatycznego przypisywania
        </h3>
        <p className="text-sm text-gray-600">
          Faktury KSEF z poniższymi numerami NIP będą automatycznie przypisywane do wybranych działów.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800">{success}</p>
        </div>
      )}

      {canManageMappings && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h4 className="font-medium text-gray-900 mb-4">Dodaj nowe mapowanie</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Numer NIP
              </label>
              <input
                type="text"
                value={newNIP}
                onChange={(e) => setNewNIP(e.target.value)}
                placeholder="1234567890"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                maxLength={10}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Dział
              </label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Wybierz dział</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={handleAddMapping}
                disabled={adding || !newNIP || !selectedDepartment}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                {adding ? 'Dodawanie...' : 'Dodaj'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  NIP
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Dział
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Data dodania
                </th>
                {canManageMappings && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Akcje
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {mappings.length === 0 ? (
                <tr>
                  <td colSpan={canManageMappings ? 4 : 3} className="px-6 py-8 text-center">
                    <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-500">Brak mapowań NIP</p>
                    {canManageMappings && (
                      <p className="text-sm text-gray-400 mt-1">
                        Dodaj pierwsze mapowanie powyżej
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                mappings.map((mapping) => (
                  <tr key={mapping.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-mono text-sm text-gray-900">
                        {mapping.nip}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-900">
                          {mapping.department_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(mapping.created_at).toLocaleDateString('pl-PL')}
                    </td>
                    {canManageMappings && (
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => handleDeleteMapping(mapping.id)}
                          className="text-red-600 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors"
                          title="Usuń mapowanie"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canManageMappings && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            Jako specjalista nie możesz zarządzać mapowaniami NIP. Skontaktuj się z kierownikiem lub dyrektorem.
          </p>
        </div>
      )}
    </div>
  );
}
