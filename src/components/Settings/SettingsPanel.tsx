import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Settings, Users, Shield, AlertCircle, Save, Trash2, UserPlus, X, Building2, Plus } from 'lucide-react';
import DepartmentManagement from './DepartmentManagement';
import { useAuth } from '../../contexts/AuthContext';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  department_id: string | null;
  is_admin: boolean;
  created_at: string;
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

export default function SettingsPanel() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddDepartment, setShowAddDepartment] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    role: 'Specjalista',
    department_id: '',
    is_admin: false
  });
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [creating, setCreating] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'departments'>('users');

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
          created_at,
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
      loadUsers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się zaktualizować użytkownika');
    }
  }

  async function deleteUser(userId: string) {
    if (!confirm('Czy na pewno chcesz usunąć tego użytkownika? Ta akcja nie może zostać cofnięta.')) {
      return;
    }

    try {
      setError(null);
      const { error } = await supabase.auth.admin.deleteUser(userId);

      if (error) throw error;

      setSuccess('Użytkownik usunięty pomyślnie');
      loadUsers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się usunąć użytkownika');
    }
  }

  function handleNameChange(userId: string, newName: string) {
    setUsers(users.map(u => u.id === userId ? { ...u, full_name: newName } : u));
  }

  function handleRoleChange(userId: string, newRole: string) {
    setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
  }

  function handleDepartmentChange(userId: string, newDepartmentId: string) {
    setUsers(users.map(u => u.id === userId ? { ...u, department_id: newDepartmentId } : u));
  }

  function handleAdminChange(userId: string, isAdmin: boolean) {
    setUsers(users.map(u => u.id === userId ? { ...u, is_admin: isAdmin } : u));
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();

    if (!newUser.email) {
      setError('Email jest wymagany');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: newUser.email,
        password: crypto.randomUUID(),
      });

      if (signUpError) throw signUpError;

      if (authData.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            id: authData.user.id,
            email: newUser.email,
            full_name: newUser.email.split('@')[0],
            role: newUser.role,
            department_id: newUser.department_id || null,
            is_admin: newUser.is_admin
          });

        if (profileError) throw profileError;

        setSuccess('Użytkownik utworzony pomyślnie');
        setShowAddUser(false);
        setNewUser({
          email: '',
          role: 'Specjalista',
          department_id: '',
          is_admin: false
        });
        loadUsers();
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się utworzyć użytkownika');
    } finally {
      setCreating(false);
    }
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
    <div className="min-h-full bg-light-bg dark:bg-dark-bg p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">
            Ustawienia Systemu
          </h1>
          <p className="text-text-secondary-light dark:text-text-secondary-dark mt-0.5 text-sm">
            Zarządzanie użytkownikami, rolami i konfiguracją systemu
          </p>
        </div>
        {activeTab === 'users' && (
          <button
            onClick={() => setShowAddUser(true)}
            className="inline-flex items-center gap-2 px-3 py-2 bg-brand-primary text-white font-medium rounded-lg hover:bg-brand-primary/90 transition-all text-sm"
          >
            <UserPlus className="w-4 h-4" />
            Dodaj Użytkownika
          </button>
        )}
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

      <div className="mb-4 flex items-center gap-2 bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 p-1">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
            activeTab === 'users'
              ? 'bg-brand-primary text-white'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Users className="w-4 h-4" />
          Użytkownicy
        </button>
        <button
          onClick={() => setActiveTab('departments')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
            activeTab === 'departments'
              ? 'bg-brand-primary text-white'
              : 'text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Działy
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

        {showAddUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700/50">
              <div className="px-6 py-4 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between sticky top-0">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
                  <h2 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">Dodaj Nowego Użytkownika</h2>
                </div>
                <button
                  onClick={() => {
                    setShowAddUser(false);
                    setError(null);
                  }}
                  className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors"
                >
                  <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
                </button>
              </div>

              <form onSubmit={handleCreateUser} className="p-6 space-y-6">
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-red-900">Błąd</h3>
                      <p className="text-red-700 text-sm">{error}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                      Email Google Workspace *
                    </label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      placeholder="uzytkownik@auraherbals.pl"
                      required
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
                    />
                    <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                      Użytkownik zaloguje się przez Google Workspace
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                        Rola *
                      </label>
                      <select
                        value={newUser.role}
                        onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
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
                        value={newUser.department_id}
                        onChange={(e) => setNewUser({ ...newUser, department_id: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      >
                        <option value="">Wybierz dział</option>
                        {departments.map((dept) => (
                          <option key={dept.id} value={dept.id}>
                            {dept.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                      Uprawnienia Administratora
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer mt-2">
                      <input
                        type="checkbox"
                        checked={newUser.is_admin}
                        onChange={(e) => setNewUser({ ...newUser, is_admin: e.target.checked })}
                        className="w-4 h-4 text-brand-primary border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
                      />
                      <span className="text-sm text-text-primary-light dark:text-text-primary-dark">Przyznaj uprawnienia administratora</span>
                    </label>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-4">
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
                        <UserPlus className="w-5 h-5" />
                        Utwórz Użytkownika
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddUser(false);
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
                  Utworzono
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
                  Akcje
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors">
                  <td className="px-3 py-2">
                      {editingUser === user.id ? (
                        <div>
                          <input
                            type="text"
                            value={user.full_name}
                            onChange={(e) => handleNameChange(user.id, e.target.value)}
                            placeholder="Imię i nazwisko"
                            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark mb-1"
                          />
                          <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{user.email}</div>
                        </div>
                      ) : (
                        <div>
                          <div className="font-medium text-text-primary-light dark:text-text-primary-dark text-sm">{user.full_name}</div>
                          <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{user.email}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingUser === user.id ? (
                        <select
                          value={user.role}
                          onChange={(e) => handleRoleChange(user.id, e.target.value)}
                          className="px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                        >
                          {roles.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-primary/10 text-brand-primary dark:bg-brand-primary/20">
                          {user.role}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingUser === user.id ? (
                        <select
                          value={user.department_id || ''}
                          onChange={(e) => handleDepartmentChange(user.id, e.target.value)}
                          className="px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                        >
                          <option value="">Wybierz dział</option>
                          {departments.map((dept) => (
                            <option key={dept.id} value={dept.id}>
                              {dept.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                          {user.department?.name || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingUser === user.id ? (
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={user.is_admin}
                            onChange={(e) => handleAdminChange(user.id, e.target.checked)}
                            className="w-3.5 h-3.5 text-brand-primary border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-brand-primary"
                          />
                          <span className="text-xs text-text-primary-light dark:text-text-primary-dark">Admin</span>
                        </label>
                      ) : (
                        user.is_admin ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-ai-accent/10 text-ai-accent dark:bg-ai-accent/20">
                            <Shield className="w-3 h-3 mr-0.5" />
                            Admin
                          </span>
                        ) : (
                          <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">-</span>
                        )
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {editingUser === user.id ? (
                          <>
                            <button
                              onClick={() => updateUser(user.id, {
                                full_name: user.full_name,
                                role: user.role,
                                department_id: user.department_id,
                                is_admin: user.is_admin
                              })}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-brand-primary text-white text-xs font-medium rounded hover:bg-brand-primary/90 transition-colors"
                            >
                              <Save className="w-3 h-3" />
                              Zapisz
                            </button>
                            <button
                              onClick={() => {
                                setEditingUser(null);
                                loadUsers();
                              }}
                              className="px-2 py-1 text-text-secondary-light dark:text-text-secondary-dark text-xs font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                            >
                              Anuluj
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setEditingUser(user.id)}
                              className="px-2 py-1 text-brand-primary text-xs font-medium hover:text-brand-primary/80 transition-colors"
                            >
                              Edytuj
                            </button>
                            <button
                              onClick={() => deleteUser(user.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-status-error text-xs font-medium hover:text-red-700 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                              Usuń
                            </button>
                          </>
                        )}
                      </div>
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

        {activeTab === 'departments' && (
          <DepartmentManagement />
        )}
    </div>
  );
}
