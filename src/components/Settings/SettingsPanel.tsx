import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Settings, Users, Shield, AlertCircle, Save, Trash2, UserPlus, X, Building2, Plus, Sparkles, MessageSquare, Mail, Hash, Code2 } from 'lucide-react';
import DepartmentManagement from './DepartmentManagement';
import AIPromptsSettings from './AIPromptsSettings';
import SlackSettings from './SlackSettings';
import UserInvitations from './UserInvitations';
import { CostCentersManagement } from './CostCentersManagement';
import APISettings from './APISettings';
import { useAuth } from '../../contexts/AuthContext';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  department_id: string | null;
  is_admin: boolean;
  can_access_ksef_config: boolean;
  mpk_override_bez_mpk: boolean;
  monthly_invoice_limit: number | null;
  single_invoice_limit: number | null;
  created_at: string;
  last_login_at: string | null;
  department?: {
    id: string;
    name: string;
  } | null;
}

const roles = ['CEO', 'Dyrektor', 'Kierownik', 'Specjalista'];

interface Department {
  id: string;
  name: string;
  created_at: string;
}

interface DepartmentAccess {
  id: string;
  user_id: string;
  department_id: string;
  access_type: 'view' | 'workflow';
  granted_by: string | null;
  created_at: string;
}

export default function SettingsPanel() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editedFullName, setEditedFullName] = useState('');
  const [showAddDepartment, setShowAddDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'departments' | 'invitations' | 'ai_prompts' | 'slack' | 'mpk' | 'api'>('users');
  const [userAccess, setUserAccess] = useState<DepartmentAccess[]>([]);
  const [selectedAccessDept, setSelectedAccessDept] = useState('');
  const [selectedAccessType, setSelectedAccessType] = useState<'view' | 'workflow'>('view');

  useEffect(() => {
    loadUsers();
    loadDepartments();
  }, [profile?.id]);

  async function loadUsers() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          role,
          department_id,
          is_admin,
          can_access_ksef_config,
          mpk_override_bez_mpk,
          monthly_invoice_limit,
          single_invoice_limit,
          created_at,
          last_login_at,
          department:department_id(id, name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się załadować użytkowników');
    } finally {
      setLoading(false);
    }
  }

  async function loadDepartments() {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .order('name');

      if (error) throw error;
      setDepartments(data || []);
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  }

  async function loadUserAccess(userId: string) {
    try {
      const { data, error } = await supabase
        .from('user_department_access')
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;
      setUserAccess(data || []);
    } catch (err) {
      console.error('Error loading user access:', err);
    }
  }

  async function addUserAccess() {
    if (!editingUser || !selectedAccessDept) return;

    try {
      const { error } = await supabase
        .from('user_department_access')
        .insert({
          user_id: editingUser.id,
          department_id: selectedAccessDept,
          access_type: selectedAccessType,
          granted_by: profile?.id
        });

      if (error) throw error;

      setSuccess('Uprawnienie dodane pomyślnie');
      setSelectedAccessDept('');
      loadUserAccess(editingUser.id);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się dodać uprawnienia');
    }
  }

  async function removeUserAccess(accessId: string) {
    if (!editingUser) return;

    try {
      const { error } = await supabase
        .from('user_department_access')
        .delete()
        .eq('id', accessId);

      if (error) throw error;

      setSuccess('Uprawnienie usunięte pomyślnie');
      loadUserAccess(editingUser.id);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć uprawnienia');
    }
  }

  async function updateUser(userId: string, updates: Partial<Profile>) {
    try {
      setError(null);
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

      if (error) throw error;

      setSuccess('Użytkownik zaktualizowany pomyślnie');
      setEditingUser(null);
      setEditedFullName('');
      loadUsers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zaktualizować użytkownika');
    }
  }

  function openEditModal(user: Profile) {
    setEditingUser({ ...user });
    setEditedFullName(user.full_name);
    setError(null);
    loadUserAccess(user.id);
  }

  function closeEditModal() {
    setEditingUser(null);
    setEditedFullName('');
    setError(null);
    setUserAccess([]);
    setSelectedAccessDept('');
    setSelectedAccessType('view');
  }

  async function deleteUser(userId: string) {
    if (!confirm('Czy na pewno chcesz usunąć tego użytkownika? Ta akcja nie może zostać cofnięta.')) {
      return;
    }

    try {
      setError(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak sesji użytkownika');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: userId }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Błąd usuwania użytkownika');
      }

      setSuccess('Użytkownik usunięty pomyślnie');
      loadUsers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć użytkownika');
    }
  }

  function handleRoleChange(newRole: string) {
    if (editingUser) {
      setEditingUser({ ...editingUser, role: newRole });
    }
  }

  function handleDepartmentChange(newDepartmentId: string) {
    if (editingUser) {
      setEditingUser({ ...editingUser, department_id: newDepartmentId || null });
    }
  }

  function handleAdminChange(isAdmin: boolean) {
    if (editingUser) {
      setEditingUser({ ...editingUser, is_admin: isAdmin });
    }
  }

  function handleKsefConfigAccessChange(canAccess: boolean) {
    if (editingUser) {
      setEditingUser({ ...editingUser, can_access_ksef_config: canAccess });
    }
  }

  function handleMpkOverrideBezMpkChange(value: boolean) {
    if (editingUser) {
      setEditingUser({ ...editingUser, mpk_override_bez_mpk: value });
    }
  }

  function handleMonthlyLimitChange(value: string) {
    if (editingUser) {
      const numValue = value === '' ? null : parseFloat(value);
      setEditingUser({ ...editingUser, monthly_invoice_limit: numValue });
    }
  }

  function handleSingleLimitChange(value: string) {
    if (editingUser) {
      const numValue = value === '' ? null : parseFloat(value);
      setEditingUser({ ...editingUser, single_invoice_limit: numValue });
    }
  }

  function handleSaveUser() {
    if (!editingUser) return;

    updateUser(editingUser.id, {
      full_name: editedFullName,
      role: editingUser.role,
      department_id: editingUser.department_id,
      is_admin: editingUser.is_admin,
      can_access_ksef_config: editingUser.can_access_ksef_config,
      mpk_override_bez_mpk: editingUser.mpk_override_bez_mpk,
      monthly_invoice_limit: editingUser.monthly_invoice_limit,
      single_invoice_limit: editingUser.single_invoice_limit
    });
  }


  async function handleCreateDepartment(e: React.FormEvent) {
    e.preventDefault();

    if (!newDepartmentName.trim()) {
      setError('Nazwa działu jest wymagana');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('departments')
        .insert({
          name: newDepartmentName.trim(),
          created_by: user?.id
        });

      if (error) throw error;

      setSuccess('Dział utworzony pomyślnie');
      setShowAddDepartment(false);
      setNewDepartmentName('');
      loadDepartments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć działu');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteDepartment(departmentId: string) {
    if (!confirm('Czy na pewno chcesz usunąć ten dział?')) {
      return;
    }

    try {
      setError(null);
      const { error } = await supabase
        .from('departments')
        .delete()
        .eq('id', departmentId);

      if (error) throw error;

      setSuccess('Dział usunięty pomyślnie');
      loadDepartments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć działu');
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
    <div className="h-full bg-light-bg dark:bg-dark-bg p-4 overflow-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">
            Ustawienia Systemu
          </h1>
          <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
            Zarządzanie użytkownikami, rolami i konfiguracją systemu
          </p>
        </div>
        {activeTab === 'departments' && (
          <button
            onClick={() => setShowAddDepartment(true)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary/90 transition-all text-sm"
          >
            <Plus className="w-4 h-4" />
            Dodaj Dział
          </button>
        )}
      </div>

      <div className="mb-4 flex items-center gap-1 bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-1">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
            activeTab === 'users'
              ? 'bg-brand-primary text-white shadow-sm'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Users className="w-4 h-4" />
          Użytkownicy
        </button>
        <button
          onClick={() => setActiveTab('invitations')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
            activeTab === 'invitations'
              ? 'bg-brand-primary text-white shadow-sm'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Mail className="w-4 h-4" />
          Zaproszenia
        </button>
        <button
          onClick={() => setActiveTab('departments')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
            activeTab === 'departments'
              ? 'bg-brand-primary text-white shadow-sm'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Dzialy
        </button>
        <button
          onClick={() => setActiveTab('ai_prompts')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
            activeTab === 'ai_prompts'
              ? 'bg-brand-primary text-white shadow-sm'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          AI Umowy
        </button>
        <button
          onClick={() => setActiveTab('slack')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
            activeTab === 'slack'
              ? 'bg-brand-primary text-white shadow-sm'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          Slack
        </button>
        <button
          onClick={() => setActiveTab('mpk')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
            activeTab === 'mpk'
              ? 'bg-brand-primary text-white shadow-sm'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Hash className="w-4 h-4" />
          MPK
        </button>
        <button
          onClick={() => setActiveTab('api')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
            activeTab === 'api'
              ? 'bg-brand-primary text-white shadow-sm'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Code2 className="w-4 h-4" />
          API
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-900 dark:text-red-400 text-sm">Błąd</h3>
            <p className="text-red-700 dark:text-red-300 text-xs">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-start gap-2">
          <Shield className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-green-900 dark:text-green-400 text-sm">Sukces</h3>
            <p className="text-green-700 dark:text-green-300 text-xs">{success}</p>
          </div>
        </div>
      )}

      {activeTab === 'users' && (
        <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
          <div className="px-3 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">
                Zarządzanie Użytkownikami
              </h2>
            </div>
          </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Użytkownik
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Rola
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Dział
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Admin
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Ostatnio zalogowany
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Utworzono
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {users.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => openEditModal(user)}
                  className="hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <div>
                      <div className="font-medium text-text-primary-light dark:text-text-primary-dark text-sm">{user.full_name}</div>
                      <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{user.email}</div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-primary/10 text-brand-primary dark:bg-brand-primary/20">
                      {user.role}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {user.department?.name || '-'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {user.is_admin ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-ai-accent/10 text-ai-accent dark:bg-ai-accent/20">
                        <Shield className="w-3 h-3 mr-0.5" />
                        Admin
                      </span>
                    ) : (
                      <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleString('pl-PL', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : 'Nigdy'}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                </tr>
                ))}
              </tbody>
            </table>
          </div>

        {users.length === 0 && (
          <div className="px-3 py-8 text-center text-text-secondary-light dark:text-text-secondary-dark text-sm">
            Nie znaleziono użytkowników
          </div>
        )}
      </div>
      )}

        {editingUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl max-w-lg w-full border border-slate-200 dark:border-slate-700/50">
              <div className="px-6 py-4 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
                  <h2 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">Edytuj Użytkownika</h2>
                </div>
                <button
                  onClick={closeEditModal}
                  className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors"
                >
                  <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-red-900 dark:text-red-400">Błąd</h3>
                      <p className="text-red-700 dark:text-red-300 text-sm">{error}</p>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={editingUser.email}
                    disabled
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg bg-slate-100 dark:bg-slate-800 text-text-secondary-light dark:text-text-secondary-dark cursor-not-allowed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                    Imię i Nazwisko *
                  </label>
                  <input
                    type="text"
                    value={editedFullName}
                    onChange={(e) => setEditedFullName(e.target.value)}
                    placeholder="Wpisz imię i nazwisko"
                    required
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                    Rola
                  </label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => handleRoleChange(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                    Dział
                  </label>
                  <select
                    value={editingUser.department_id || ''}
                    onChange={(e) => handleDepartmentChange(e.target.value)}
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                  >
                    <option value="">Brak przypisania</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_admin"
                    checked={editingUser.is_admin}
                    onChange={(e) => handleAdminChange(e.target.checked)}
                    className="w-4 h-4 text-brand-primary border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
                  />
                  <label
                    htmlFor="is_admin"
                    className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark cursor-pointer"
                  >
                    Uprawnienia administratora
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="can_access_ksef_config"
                    checked={editingUser.can_access_ksef_config}
                    onChange={(e) => handleKsefConfigAccessChange(e.target.checked)}
                    className="w-4 h-4 text-brand-primary border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
                  />
                  <label
                    htmlFor="can_access_ksef_config"
                    className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark cursor-pointer"
                  >
                    Dostęp do konfiguracji KSEF
                  </label>
                </div>

                <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg">
                  <input
                    type="checkbox"
                    id="mpk_override_bez_mpk"
                    checked={editingUser.mpk_override_bez_mpk}
                    onChange={(e) => handleMpkOverrideBezMpkChange(e.target.checked)}
                    className="w-4 h-4 mt-0.5 text-brand-primary border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary flex-shrink-0"
                  />
                  <div>
                    <label
                      htmlFor="mpk_override_bez_mpk"
                      className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark cursor-pointer"
                    >
                      Dostęp BEZ MPK
                    </label>
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                      Faktury tego użytkownika będą eksportowane przez API z kodem MPK i nazwą działu zastąpionymi przez "BEZ MPK"
                    </p>
                  </div>
                </div>

                {editingUser.role === 'Dyrektor' && (
                  <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                        Limity zatwierdzania faktur
                      </h3>
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-3">
                        Jeśli faktura mieści się w limitach, Dyrektor może ją zatwierdzić bez przekazywania do CEO
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                        Limit miesięczny (PLN)
                      </label>
                      <input
                        type="number"
                        value={editingUser.monthly_invoice_limit ?? ''}
                        onChange={(e) => handleMonthlyLimitChange(e.target.value)}
                        placeholder="np. 50000"
                        step="0.01"
                        min="0"
                        className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
                      />
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                        Maksymalna suma faktur w PLN którą Dyrektor może zatwierdzić w miesiącu
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                        Limit pojedynczej faktury (PLN)
                      </label>
                      <input
                        type="number"
                        value={editingUser.single_invoice_limit ?? ''}
                        onChange={(e) => handleSingleLimitChange(e.target.value)}
                        placeholder="np. 10000"
                        step="0.01"
                        min="0"
                        className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
                      />
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                        Maksymalna kwota pojedynczej faktury w PLN którą Dyrektor może zatwierdzić
                      </p>
                    </div>
                  </div>
                )}

                <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
                  <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                    Dostęp do działów
                  </h3>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-3">
                    Przyznaj użytkownikowi dostęp do faktur wybranych działów
                  </p>

                  <div className="space-y-2 mb-3">
                    {userAccess.map((access) => {
                      const dept = departments.find(d => d.id === access.department_id);
                      return (
                        <div key={access.id} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                            <div>
                              <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                                {dept?.name || 'Nieznany dział'}
                              </div>
                              <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                                {access.access_type === 'view' ? 'Tylko podgląd' : 'Dostęp do obiegu'}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => removeUserAccess(access.id)}
                            className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                          >
                            <X className="w-4 h-4 text-red-600 dark:text-red-400" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex gap-2">
                    <select
                      value={selectedAccessDept}
                      onChange={(e) => setSelectedAccessDept(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                    >
                      <option value="">Wybierz dział</option>
                      {departments.filter(d => !userAccess.some(a => a.department_id === d.id && a.access_type === selectedAccessType)).map(dept => (
                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                      ))}
                    </select>
                    <select
                      value={selectedAccessType}
                      onChange={(e) => setSelectedAccessType(e.target.value as 'view' | 'workflow')}
                      className="px-3 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                    >
                      <option value="view">Podgląd</option>
                      <option value="workflow">Obieg</option>
                    </select>
                    <button
                      onClick={addUserAccess}
                      disabled={!selectedAccessDept}
                      className="px-4 py-2 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary/90 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-4">
                  <button
                    onClick={handleSaveUser}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary/90 transition-all shadow-md"
                  >
                    <Save className="w-5 h-5" />
                    Zapisz zmiany
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteUser(editingUser.id)}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-all shadow-md"
                  >
                    <Trash2 className="w-5 h-5" />
                    Usuń
                  </button>
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="px-6 py-3 text-text-secondary-light dark:text-text-secondary-dark font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAddDepartment && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl max-w-md w-full border border-slate-200 dark:border-slate-700/50">
              <div className="px-6 py-4 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plus className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
                  <h2 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">Dodaj Nowy Dział</h2>
                </div>
                <button
                  onClick={() => {
                    setShowAddDepartment(false);
                    setError(null);
                  }}
                  className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors"
                >
                  <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
                </button>
              </div>

              <form onSubmit={handleCreateDepartment} className="p-6 space-y-6">
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-red-900">Błąd</h3>
                      <p className="text-red-700 text-sm">{error}</p>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                    Nazwa Działu *
                  </label>
                  <input
                    type="text"
                    value={newDepartmentName}
                    onChange={(e) => setNewDepartmentName(e.target.value)}
                    placeholder="Wpisz nazwę działu"
                    required
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                  >
                    {creating ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        Tworzenie...
                      </>
                    ) : (
                      <>
                        <Plus className="w-5 h-5" />
                        Utwórz Dział
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddDepartment(false);
                      setError(null);
                    }}
                    disabled={creating}
                    className="px-6 py-3 text-text-secondary-light dark:text-text-secondary-dark font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors disabled:opacity-50"
                  >
                    Anuluj
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'invitations' && (
          <UserInvitations />
        )}

        {activeTab === 'departments' && (
          <DepartmentManagement />
        )}

        {activeTab === 'ai_prompts' && (
          <AIPromptsSettings />
        )}

        {activeTab === 'slack' && (
          <SlackSettings />
        )}

        {activeTab === 'mpk' && (
          <CostCentersManagement />
        )}

        {activeTab === 'api' && (
          <APISettings />
        )}


    </div>
  );
}
