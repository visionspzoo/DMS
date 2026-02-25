import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Plus, Trash2, Building2, AlertCircle, User, Edit2, Check, X } from 'lucide-react';

interface NIPMapping {
  id: string;
  nip: string;
  supplier_name?: string | null;
  department_id: string;
  department_name?: string;
  assigned_user_id?: string | null;
  assigned_user_name?: string | null;
  created_at: string;
}

interface Department {
  id: string;
  name: string;
}

interface DepartmentUser {
  id: string;
  full_name: string;
  email: string;
}

export function KSEFConfiguration() {
  const { user } = useAuth();
  const [mappings, setMappings] = useState<NIPMapping[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentUsers, setDepartmentUsers] = useState<DepartmentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [newNIP, setNewNIP] = useState('');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [adding, setAdding] = useState(false);

  const [selectedMappings, setSelectedMappings] = useState<Set<string>>(new Set());
  const [bulkDepartment, setBulkDepartment] = useState('');
  const [bulkUser, setBulkUser] = useState('');
  const [bulkDepartmentUsers, setBulkDepartmentUsers] = useState<DepartmentUser[]>([]);
  const [bulkOperating, setBulkOperating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDepartment, setEditDepartment] = useState('');
  const [editUser, setEditUser] = useState('');
  const [editSupplierName, setEditSupplierName] = useState('');
  const [editDepartmentUsers, setEditDepartmentUsers] = useState<DepartmentUser[]>([]);
  const [editing, setEditing] = useState(false);

  const canManageMappings = user?.role !== 'specialist';

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedDepartment) {
      loadDepartmentUsers(selectedDepartment);
    } else {
      setDepartmentUsers([]);
      setSelectedUser('');
    }
  }, [selectedDepartment]);

  useEffect(() => {
    if (bulkDepartment) {
      loadDepartmentUsers(bulkDepartment).then(users => setBulkDepartmentUsers(users || []));
    } else {
      setBulkDepartmentUsers([]);
      setBulkUser('');
    }
  }, [bulkDepartment]);

  useEffect(() => {
    if (editDepartment) {
      loadDepartmentUsers(editDepartment).then(users => setEditDepartmentUsers(users || []));
    } else {
      setEditDepartmentUsers([]);
    }
  }, [editDepartment]);

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
            supplier_name,
            department_id,
            assigned_user_id,
            created_at,
            departments:department_id (
              name
            ),
            assigned_user:assigned_user_id (
              full_name
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
        department_name: m.departments?.name,
        assigned_user_name: m.assigned_user?.full_name
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

  async function loadDepartmentUsers(departmentId: string): Promise<DepartmentUser[]> {
    try {
      const [primaryResult, membersResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('department_id', departmentId)
          .order('full_name'),
        supabase
          .from('department_members')
          .select(`
            user_id,
            profiles:user_id (
              id,
              full_name,
              email
            )
          `)
          .eq('department_id', departmentId)
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

      users.sort((a, b) => a.full_name.localeCompare(b.full_name));
      setDepartmentUsers(users);
      return users;
    } catch (err) {
      console.error('Error loading department users:', err);
      setDepartmentUsers([]);
      return [];
    }
  }

  async function handleAddMapping() {
    if (!newNIP || !selectedDepartment) {
      setError('Proszę podać NIP i wybrać dział');
      return;
    }

    const nips = newNIP.split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(n => n);

    const invalidNips = nips.filter(n => n.length !== 10);
    if (invalidNips.length > 0) {
      setError(`Niektóre numery NIP są nieprawidłowe (muszą zawierać 10 cyfr): ${invalidNips.join(', ')}`);
      return;
    }

    if (nips.length === 0) {
      setError('Proszę podać przynajmniej jeden NIP');
      return;
    }

    try {
      setAdding(true);
      setError(null);
      setSuccess(null);

      const { data: existingMappings } = await supabase
        .from('ksef_nip_department_mappings')
        .select('nip')
        .in('nip', nips);

      if (existingMappings && existingMappings.length > 0) {
        const duplicateNips = [...new Set(existingMappings.map((m: any) => m.nip))];
        setError(`Mapowanie dla NIP ${duplicateNips.join(', ')} już istnieje. Każdy NIP może mieć tylko jedno mapowanie.`);
        setAdding(false);
        return;
      }

      const mappingsToAdd = nips.map(nip => ({
        nip,
        supplier_name: newSupplierName.trim() || null,
        department_id: selectedDepartment,
        assigned_user_id: selectedUser || null,
        created_by: user?.id
      }));

      const { error: insertError } = await supabase
        .from('ksef_nip_department_mappings')
        .insert(mappingsToAdd);

      if (insertError) throw insertError;

      setSuccess(`Pomyślnie dodano ${nips.length} ${nips.length === 1 ? 'mapowanie' : nips.length < 5 ? 'mapowania' : 'mapowań'} NIP`);
      setNewNIP('');
      setNewSupplierName('');
      setSelectedDepartment('');
      setSelectedUser('');
      await loadData();
    } catch (err: any) {
      console.error('Error adding mapping:', err);
      if (err.code === '23505') {
        setError('Jeden lub więcej NIPów jest już przypisanych. Każdy NIP może mieć tylko jedno mapowanie.');
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

  function startEditing(mapping: NIPMapping) {
    setEditingId(mapping.id);
    setEditDepartment(mapping.department_id);
    setEditUser(mapping.assigned_user_id || '');
    setEditSupplierName(mapping.supplier_name || '');
    setError(null);
    setSuccess(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditDepartment('');
    setEditUser('');
    setEditSupplierName('');
    setEditDepartmentUsers([]);
  }

  async function saveEdit(id: string) {
    if (!editDepartment) {
      setError('Wybierz dział');
      return;
    }

    try {
      setEditing(true);
      setError(null);
      setSuccess(null);

      const { error: updateError } = await supabase
        .from('ksef_nip_department_mappings')
        .update({
          department_id: editDepartment,
          assigned_user_id: editUser || null,
          supplier_name: editSupplierName.trim() || null,
        })
        .eq('id', id);

      if (updateError) throw updateError;

      setSuccess('Pomyślnie zaktualizowano mapowanie');
      setEditingId(null);
      setEditDepartment('');
      setEditUser('');
      setEditSupplierName('');
      setEditDepartmentUsers([]);
      await loadData();
    } catch (err) {
      console.error('Error updating mapping:', err);
      setError('Nie udało się zaktualizować mapowania');
    } finally {
      setEditing(false);
    }
  }

  function toggleSelection(id: string) {
    const newSelection = new Set(selectedMappings);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedMappings(newSelection);
  }

  function toggleSelectAll() {
    if (selectedMappings.size === mappings.length) {
      setSelectedMappings(new Set());
    } else {
      setSelectedMappings(new Set(mappings.map(m => m.id)));
    }
  }

  async function handleBulkDelete() {
    if (selectedMappings.size === 0) return;
    if (!confirm(`Czy na pewno chcesz usunąć ${selectedMappings.size} ${selectedMappings.size === 1 ? 'mapowanie' : selectedMappings.size < 5 ? 'mapowania' : 'mapowań'}?`)) return;

    try {
      setBulkOperating(true);
      setError(null);
      setSuccess(null);

      const { error: deleteError } = await supabase
        .from('ksef_nip_department_mappings')
        .delete()
        .in('id', Array.from(selectedMappings));

      if (deleteError) throw deleteError;

      setSuccess(`Pomyślnie usunięto ${selectedMappings.size} ${selectedMappings.size === 1 ? 'mapowanie' : selectedMappings.size < 5 ? 'mapowania' : 'mapowań'}`);
      setSelectedMappings(new Set());
      await loadData();
    } catch (err) {
      console.error('Error bulk deleting:', err);
      setError('Nie udało się usunąć mapowań');
    } finally {
      setBulkOperating(false);
    }
  }

  async function handleBulkUpdate() {
    if (selectedMappings.size === 0) return;
    if (!bulkDepartment) {
      setError('Wybierz dział dla masowej operacji');
      return;
    }

    try {
      setBulkOperating(true);
      setError(null);
      setSuccess(null);

      const { error: updateError } = await supabase
        .from('ksef_nip_department_mappings')
        .update({
          department_id: bulkDepartment,
          assigned_user_id: bulkUser || null,
        })
        .in('id', Array.from(selectedMappings));

      if (updateError) throw updateError;

      setSuccess(`Pomyślnie zaktualizowano ${selectedMappings.size} ${selectedMappings.size === 1 ? 'mapowanie' : selectedMappings.size < 5 ? 'mapowania' : 'mapowań'}`);
      setSelectedMappings(new Set());
      setBulkDepartment('');
      setBulkUser('');
      await loadData();
    } catch (err) {
      console.error('Error bulk updating:', err);
      setError('Nie udało się zaktualizować mapowań');
    } finally {
      setBulkOperating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Konfiguracja automatycznego przypisywania
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Faktury KSEF z poniższymi numerami NIP będą automatycznie przypisywane do wybranych działów i osób.
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

      {canManageMappings && (
        <div className="bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg p-5">
          <h4 className="font-medium text-text-primary-light dark:text-text-primary-dark mb-4">Dodaj nowe mapowanie</h4>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  Numer NIP
                </label>
                <input
                  type="text"
                  value={newNIP}
                  onChange={(e) => setNewNIP(e.target.value)}
                  placeholder="1234567890"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                  Możesz dodać wiele NIPów oddzielonych przecinkami
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  Nazwa (opcjonalnie)
                </label>
                <input
                  type="text"
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="Nazwa dostawcy"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                  Etykieta ułatwiająca identyfikację dostawcy
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  Dział
                </label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                >
                  <option value="">Wybierz dział</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  Osoba (opcjonalnie)
                </label>
                <select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  disabled={!selectedDepartment}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Kierownik działu</option>
                  {departmentUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
                {selectedDepartment && !selectedUser && (
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                    Faktury zostaną przypisane do kierownika działu
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleAddMapping}
                disabled={adding || !newNIP || !selectedDepartment}
                className="px-6 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition font-medium text-sm"
              >
                <Plus className="w-4 h-4" />
                {adding ? 'Dodawanie...' : 'Dodaj mapowanie'}
              </button>
            </div>
          </div>
        </div>
      )}

      {canManageMappings && selectedMappings.size > 0 && (
        <div className="bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50 rounded-lg p-4">
          <h4 className="font-medium text-text-primary-light dark:text-text-primary-dark mb-3">
            Operacje masowe ({selectedMappings.size} {selectedMappings.size === 1 ? 'zaznaczony' : selectedMappings.size < 5 ? 'zaznaczone' : 'zaznaczonych'})
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                Zmień dział
              </label>
              <select
                value={bulkDepartment}
                onChange={(e) => setBulkDepartment(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
              >
                <option value="">Wybierz dział</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                Zmień osobę
              </label>
              <select
                value={bulkUser}
                onChange={(e) => setBulkUser(e.target.value)}
                disabled={!bulkDepartment}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">Kierownik działu</option>
                {bulkDepartmentUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={handleBulkUpdate}
                disabled={bulkOperating || !bulkDepartment}
                className="flex-1 px-3 py-2 text-sm bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition font-medium"
              >
                {bulkOperating ? 'Aktualizacja...' : 'Zaktualizuj'}
              </button>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={handleBulkDelete}
                disabled={bulkOperating}
                className="flex-1 px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                {bulkOperating ? 'Usuwanie...' : 'Usuń'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
              <tr>
                {canManageMappings && (
                  <th className="px-4 py-3 text-center w-12">
                    <input
                      type="checkbox"
                      checked={mappings.length > 0 && selectedMappings.size === mappings.length}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 text-brand-primary bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-brand-primary focus:ring-2"
                    />
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  NIP
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Nazwa
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Dział
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Przypisana osoba
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Data dodania
                </th>
                {canManageMappings && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                    Akcje
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {mappings.length === 0 ? (
                <tr>
                  <td colSpan={canManageMappings ? 7 : 5} className="px-6 py-8 text-center">
                    <Building2 className="w-12 h-12 text-text-secondary-light dark:text-text-secondary-dark mx-auto mb-3" />
                    <p className="text-text-secondary-light dark:text-text-secondary-dark">Brak mapowań NIP</p>
                    {canManageMappings && (
                      <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">
                        Dodaj pierwsze mapowanie powyżej
                      </p>
                    )}
                  </td>
                </tr>
              ) : (
                mappings.map((mapping) => {
                  const isEditing = editingId === mapping.id;

                  return (
                    <tr key={mapping.id} className="hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant/50">
                      {canManageMappings && (
                        <td className="px-4 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={selectedMappings.has(mapping.id)}
                            onChange={() => toggleSelection(mapping.id)}
                            disabled={isEditing}
                            className="w-4 h-4 text-brand-primary bg-slate-100 dark:bg-slate-700 border-slate-300 dark:border-slate-600 rounded focus:ring-brand-primary focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-mono text-sm text-text-primary-light dark:text-text-primary-dark">
                          {mapping.nip}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editSupplierName}
                            onChange={(e) => setEditSupplierName(e.target.value)}
                            placeholder="Nazwa dostawcy"
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                          />
                        ) : (
                          <span className="text-sm text-text-primary-light dark:text-text-primary-dark">
                            {mapping.supplier_name || <span className="text-text-secondary-light dark:text-text-secondary-dark italic">—</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <select
                            value={editDepartment}
                            onChange={(e) => setEditDepartment(e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                          >
                            <option value="">Wybierz dział</option>
                            {departments.map((dept) => (
                              <option key={dept.id} value={dept.id}>
                                {dept.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                            <span className="text-sm text-text-primary-light dark:text-text-primary-dark">
                              {mapping.department_name}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {isEditing ? (
                          <select
                            value={editUser}
                            onChange={(e) => setEditUser(e.target.value)}
                            disabled={!editDepartment}
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <option value="">Kierownik działu</option>
                            {editDepartmentUsers.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.full_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <>
                            {mapping.assigned_user_name ? (
                              <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                                <span className="text-sm text-text-primary-light dark:text-text-primary-dark">
                                  {mapping.assigned_user_name}
                                </span>
                              </div>
                            ) : (
                              <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark italic">
                                Kierownik działu
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text-secondary-light dark:text-text-secondary-dark">
                        {new Date(mapping.created_at).toLocaleDateString('pl-PL')}
                      </td>
                      {canManageMappings && (
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => saveEdit(mapping.id)}
                                disabled={editing || !editDepartment}
                                className="text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 p-2 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Zapisz"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={cancelEditing}
                                disabled={editing}
                                className="text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 p-2 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Anuluj"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => startEditing(mapping)}
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 p-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                title="Edytuj mapowanie"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteMapping(mapping.id)}
                                className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                title="Usuń mapowanie"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!canManageMappings && (
        <div className="bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50 rounded-lg p-4">
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Jako specjalista nie możesz zarządzać mapowaniami NIP. Skontaktuj się z kierownikiem lub dyrektorem.
          </p>
        </div>
      )}
    </div>
  );
}
