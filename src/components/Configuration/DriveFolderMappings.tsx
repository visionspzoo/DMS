import { useState, useEffect } from 'react';
import { HardDrive, Plus, Trash2, Edit2, Save, X, CheckCircle, XCircle, FolderOpen, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { getAccessibleDepartments } from '../../lib/departmentUtils';

interface FolderMapping {
  id: string;
  user_id: string;
  folder_name: string;
  google_drive_folder_url: string;
  google_drive_folder_id: string | null;
  department_id: string;
  is_active: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
  department?: {
    name: string;
  };
}

interface Department {
  id: string;
  name: string;
}

export default function DriveFolderMappings() {
  const { user, profile } = useAuth();
  const [folderMappings, setFolderMappings] = useState<FolderMapping[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    folder_name: '',
    google_drive_folder_url: '',
    department_id: '',
    is_active: true,
  });

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFolderMappings();
    loadDepartments();
  }, [user]);

  const loadFolderMappings = async () => {
    try {
      const { data, error } = await supabase
        .from('user_drive_folder_mappings')
        .select(`
          *,
          department:departments(name)
        `)
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setFolderMappings(data || []);
    } catch (error) {
      console.error('Error loading folder mappings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDepartments = async () => {
    try {
      if (!profile) return;

      const accessibleDepts = await getAccessibleDepartments(profile);
      setDepartments(accessibleDepts);
    } catch (error) {
      console.error('Error loading departments:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      folder_name: '',
      google_drive_folder_url: '',
      department_id: '',
      is_active: true,
    });
    setShowAddForm(false);
    setEditingId(null);
    setMessage(null);
  };

  const validateForm = () => {
    if (!formData.folder_name.trim()) {
      setMessage({ type: 'error', text: 'Prosze podac nazwe folderu' });
      return false;
    }

    if (!formData.google_drive_folder_url.trim()) {
      setMessage({ type: 'error', text: 'Prosze podac link do folderu' });
      return false;
    }

    if (!formData.google_drive_folder_url.includes('drive.google.com/drive/folders/')) {
      setMessage({
        type: 'error',
        text: 'Nieprawidlowy format linku. Uzyj: https://drive.google.com/drive/folders/ID_FOLDERU',
      });
      return false;
    }

    if (!formData.department_id) {
      setMessage({ type: 'error', text: 'Prosze wybrac dzial' });
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setSaving(true);
    setMessage(null);

    try {
      if (editingId) {
        const { error } = await supabase
          .from('user_drive_folder_mappings')
          .update({
            folder_name: formData.folder_name,
            google_drive_folder_url: formData.google_drive_folder_url,
            department_id: formData.department_id,
            is_active: formData.is_active,
          })
          .eq('id', editingId);

        if (error) throw error;
        setMessage({ type: 'success', text: 'Mapowanie folderu zaktualizowane' });
      } else {
        const { error } = await supabase
          .from('user_drive_folder_mappings')
          .insert({
            user_id: user?.id,
            folder_name: formData.folder_name,
            google_drive_folder_url: formData.google_drive_folder_url,
            department_id: formData.department_id,
            is_active: formData.is_active,
          });

        if (error) throw error;
        setMessage({ type: 'success', text: 'Mapowanie folderu dodane' });
      }

      await loadFolderMappings();
      resetForm();
    } catch (error: any) {
      console.error('Error saving folder mapping:', error);
      setMessage({ type: 'error', text: 'Blad: ' + error.message });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (mapping: FolderMapping) => {
    setFormData({
      folder_name: mapping.folder_name,
      google_drive_folder_url: mapping.google_drive_folder_url,
      department_id: mapping.department_id,
      is_active: mapping.is_active,
    });
    setEditingId(mapping.id);
    setShowAddForm(true);
    setMessage(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunac to mapowanie folderu?')) return;

    try {
      const { error } = await supabase
        .from('user_drive_folder_mappings')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setMessage({ type: 'success', text: 'Mapowanie folderu usuniete' });
      await loadFolderMappings();
    } catch (error: any) {
      console.error('Error deleting folder mapping:', error);
      setMessage({ type: 'error', text: 'Blad podczas usuwania: ' + error.message });
    }
  };

  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const { error } = await supabase
        .from('user_drive_folder_mappings')
        .update({ is_active: !currentActive })
        .eq('id', id);

      if (error) throw error;
      await loadFolderMappings();
    } catch (error: any) {
      console.error('Error toggling folder mapping:', error);
      setMessage({ type: 'error', text: 'Blad podczas aktualizacji: ' + error.message });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <FolderOpen className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Mapowanie Folderow Google Drive
            </h2>
            <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
              Przypisz foldery Drive do dzialow - faktury beda automatycznie kierowane
            </p>
          </div>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors font-medium text-xs"
          >
            <Plus className="w-3 h-3" />
            Dodaj folder
          </button>
        )}
      </div>

      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 dark:text-blue-300">
            <p className="font-semibold mb-1">Jak to dziala?</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Dodaj wiele folderow Google Drive</li>
              <li>Kazdy folder przypisz do konkretnego dzialu</li>
              <li>Faktury z danego folderu automatycznie trafia do wybranego dzialu</li>
              <li>Mozesz miec dostep do wielu dzialow i konfigurowac rozne foldery dla kazdego</li>
            </ul>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`mb-4 p-2.5 rounded-lg border flex items-start gap-2 ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <p
            className={`text-xs ${
              message.type === 'success'
                ? 'text-green-800 dark:text-green-300'
                : 'text-red-800 dark:text-red-300'
            }`}
          >
            {message.text}
          </p>
        </div>
      )}

      {showAddForm && (
        <div className="mb-4 p-4 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-300 dark:border-slate-600">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              {editingId ? 'Edytuj mapowanie folderu' : 'Dodaj nowe mapowanie folderu'}
            </h3>
            <button
              onClick={resetForm}
              className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
            >
              <X className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                Nazwa folderu
              </label>
              <input
                type="text"
                value={formData.folder_name}
                onChange={(e) => setFormData({ ...formData, folder_name: e.target.value })}
                placeholder="np. Faktury Marketing"
                className="w-full px-3 py-2 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                Link do folderu Google Drive
              </label>
              <input
                type="text"
                value={formData.google_drive_folder_url}
                onChange={(e) => setFormData({ ...formData, google_drive_folder_url: e.target.value })}
                placeholder="https://drive.google.com/drive/folders/ID_FOLDERU"
                className="w-full px-3 py-2 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
                Przypisz do dzialu
              </label>
              <select
                value={formData.department_id}
                onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                className="w-full px-3 py-2 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary"
              >
                <option value="">Wybierz dzial</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
              {departments.length === 0 && (
                <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                  Brak dostepnych dzialow. Skontaktuj sie z administratorem.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="mapping-is-active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4 text-brand-primary bg-light-surface dark:bg-dark-surface border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
              />
              <label htmlFor="mapping-is-active" className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark cursor-pointer">
                Wlacz automatyczny import z tego folderu
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={resetForm}
                className="px-4 py-2 text-text-primary-light dark:text-text-primary-dark hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors font-medium text-sm"
              >
                Anuluj
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-primary hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Zapisywanie...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {editingId ? 'Zaktualizuj' : 'Dodaj'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {folderMappings.length === 0 ? (
        <div className="text-center py-6">
          <HardDrive className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Nie masz jeszcze zadnych mapowa folderow
          </p>
          <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-1">
            Kliknij "Dodaj folder" aby skonfigurowac automatyczny import
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {folderMappings.map((mapping) => (
            <div
              key={mapping.id}
              className="p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-300 dark:border-slate-600"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2 flex-1">
                  <HardDrive className="w-4 h-4 text-brand-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                        {mapping.folder_name}
                      </p>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                          mapping.is_active
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {mapping.is_active ? 'Aktywne' : 'Nieaktywne'}
                      </span>
                    </div>
                    <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                      Dzial: <span className="font-medium">{mapping.department?.name || 'Brak'}</span>
                    </p>
                    <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5 truncate">
                      Folder ID: {mapping.google_drive_folder_id || 'Nie wyodrebniono'}
                    </p>
                    {mapping.last_sync_at && (
                      <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                        Ostatnia synchronizacja: {new Date(mapping.last_sync_at).toLocaleString('pl-PL')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => handleToggleActive(mapping.id, mapping.is_active)}
                    className={`p-1.5 rounded transition-colors ${
                      mapping.is_active
                        ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'
                        : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                    title={mapping.is_active ? 'Wylacz' : 'Wlacz'}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleEdit(mapping)}
                    className="p-1.5 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded transition-colors"
                    title="Edytuj"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(mapping.id)}
                    className="p-1.5 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                    title="Usun"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
