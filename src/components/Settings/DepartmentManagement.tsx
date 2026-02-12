import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Building2, Plus, Edit2, Trash2, Users, ChevronRight, ChevronDown, X, Save, Search } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import DepartmentFlowChart from './DepartmentFlowChart';

interface Department {
  id: string;
  name: string;
  parent_department_id: string | null;
  manager_id: string | null;
  director_id: string | null;
  max_invoice_amount: number | null;
  max_monthly_amount: number | null;
  google_drive_draft_folder_id: string | null;
  google_drive_unpaid_folder_id: string | null;
  google_drive_paid_folder_id: string | null;
  created_at: string;
  manager?: {
    full_name: string;
    email: string;
  } | null;
  director?: {
    full_name: string;
    email: string;
  } | null;
}

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface DepartmentMember {
  id: string;
  user_id: string;
  department_id: string;
  user: Profile;
}

export default function DepartmentManagement() {
  const { profile } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [deptMembers, setDeptMembers] = useState<DepartmentMember[]>([]);
  const [showAddDept, setShowAddDept] = useState(false);
  const [showEditDept, setShowEditDept] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [newDept, setNewDept] = useState({
    name: '',
    parent_department_id: '',
    manager_id: '',
    director_id: '',
    max_invoice_amount: '',
    max_monthly_amount: '',
    google_drive_draft_folder_id: '',
    google_drive_unpaid_folder_id: '',
    google_drive_paid_folder_id: '',
  });
  const [userSearchQuery, setUserSearchQuery] = useState('');

  useEffect(() => {
    loadDepartments();
    loadUsers();
  }, []);

  useEffect(() => {
    if (selectedDept) {
      loadDepartmentMembers(selectedDept);
    }
  }, [selectedDept]);

  const loadDepartments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('departments')
        .select(`
          *,
          manager:manager_id(full_name, email),
          director:director_id(full_name, email)
        `)
        .order('name');

      if (error) throw error;
      setDepartments(data || []);
    } catch (err) {
      console.error('Error loading departments:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .order('full_name');

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  const loadDepartmentMembers = async (departmentId: string) => {
    try {
      const { data, error } = await supabase
        .from('department_members')
        .select(`
          id,
          user_id,
          department_id,
          user:user_id(id, email, full_name, role)
        `)
        .eq('department_id', departmentId);

      if (error) throw error;
      setDeptMembers(data || []);
    } catch (err) {
      console.error('Error loading department members:', err);
    }
  };

  const handleCreateDept = async () => {
    try {
      const { error } = await supabase.from('departments').insert({
        name: newDept.name,
        parent_department_id: newDept.parent_department_id || null,
        manager_id: newDept.manager_id || null,
        director_id: newDept.director_id || null,
        max_invoice_amount: newDept.max_invoice_amount ? parseFloat(newDept.max_invoice_amount) : null,
        max_monthly_amount: newDept.max_monthly_amount ? parseFloat(newDept.max_monthly_amount) : null,
        google_drive_draft_folder_id: newDept.google_drive_draft_folder_id || null,
        google_drive_unpaid_folder_id: newDept.google_drive_unpaid_folder_id || null,
        google_drive_paid_folder_id: newDept.google_drive_paid_folder_id || null,
        created_by: profile?.id,
      });

      if (error) throw error;

      setNewDept({ name: '', parent_department_id: '', manager_id: '', director_id: '', max_invoice_amount: '', max_monthly_amount: '', google_drive_draft_folder_id: '', google_drive_unpaid_folder_id: '', google_drive_paid_folder_id: '' });
      setShowAddDept(false);
      loadDepartments();
    } catch (err) {
      console.error('Error creating department:', err);
      alert('Nie udało się utworzyć działu');
    }
  };

  const handleUpdateDept = async () => {
    if (!editingDept) return;

    try {
      const { error } = await supabase
        .from('departments')
        .update({
          name: editingDept.name,
          parent_department_id: editingDept.parent_department_id || null,
          manager_id: editingDept.manager_id || null,
          director_id: editingDept.director_id || null,
          max_invoice_amount: editingDept.max_invoice_amount,
          max_monthly_amount: editingDept.max_monthly_amount,
          google_drive_draft_folder_id: editingDept.google_drive_draft_folder_id,
          google_drive_unpaid_folder_id: editingDept.google_drive_unpaid_folder_id,
          google_drive_paid_folder_id: editingDept.google_drive_paid_folder_id,
        })
        .eq('id', editingDept.id);

      if (error) throw error;

      setShowEditDept(false);
      setEditingDept(null);
      loadDepartments();
    } catch (err) {
      console.error('Error updating department:', err);
      alert('Nie udało się zaktualizować działu');
    }
  };

  const handleDeleteDept = async (deptId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten dział? Usuną się również wszystkie poddziały.')) return;

    try {
      const { error } = await supabase
        .from('departments')
        .delete()
        .eq('id', deptId);

      if (error) throw error;
      loadDepartments();
    } catch (err) {
      console.error('Error deleting department:', err);
      alert('Nie udało się usunąć działu');
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!selectedDept) return;

    try {
      const { error } = await supabase.from('department_members').insert({
        department_id: selectedDept,
        user_id: userId,
        assigned_by: profile?.id,
      });

      if (error) throw error;
      loadDepartmentMembers(selectedDept);
    } catch (err) {
      console.error('Error adding member:', err);
      alert('Nie udało się dodać użytkownika do działu');
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      const { error } = await supabase
        .from('department_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
      if (selectedDept) loadDepartmentMembers(selectedDept);
    } catch (err) {
      console.error('Error removing member:', err);
      alert('Nie udało się usunąć użytkownika z działu');
    }
  };

  const toggleExpand = (deptId: string) => {
    const newExpanded = new Set(expandedDepts);
    if (newExpanded.has(deptId)) {
      newExpanded.delete(deptId);
    } else {
      newExpanded.add(deptId);
    }
    setExpandedDepts(newExpanded);
  };

  const getChildDepts = (parentId: string | null) => {
    return departments.filter(d => d.parent_department_id === parentId);
  };

  const renderDepartmentTree = (parentId: string | null = null, level: number = 0) => {
    const childDepts = getChildDepts(parentId);
    if (childDepts.length === 0) return null;

    return childDepts.map(dept => {
      const hasChildren = getChildDepts(dept.id).length > 0;
      const isExpanded = expandedDepts.has(dept.id);
      const isSelected = selectedDept === dept.id;

      return (
        <div key={dept.id} className="mb-0.5">
          <div
            className={`flex items-center gap-1.5 p-1.5 rounded-md cursor-pointer transition ${
              isSelected
                ? 'bg-brand-primary/10 dark:bg-brand-primary/20 border border-brand-primary'
                : 'hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant border border-transparent hover:border-slate-200 dark:hover:border-slate-700/50'
            }`}
            style={{ marginLeft: `${level * 12}px` }}
          >
            {hasChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(dept.id);
                }}
                className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700/50 rounded transition flex-shrink-0"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                )}
              </button>
            )}
            {!hasChildren && <div className="w-4" />}

            <Building2 className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" />

            <div
              className="flex-1 min-w-0"
              onClick={() => setSelectedDept(dept.id)}
            >
              <div className="font-semibold text-xs text-text-primary-light dark:text-text-primary-dark truncate">
                {dept.name}
              </div>
              {(dept.manager || dept.director) && (
                <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark truncate">
                  {dept.manager && `Kierownik: ${dept.manager.full_name}`}
                  {dept.manager && dept.director && ' | '}
                  {dept.director && `Dyrektor: ${dept.director.full_name}`}
                </div>
              )}
            </div>

            <div className="flex gap-0.5 flex-shrink-0">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingDept(dept);
                  setShowEditDept(true);
                }}
                className="p-1 hover:bg-brand-primary/10 dark:hover:bg-brand-primary/20 rounded transition"
              >
                <Edit2 className="w-3 h-3 text-brand-primary" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteDept(dept.id);
                }}
                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition"
              >
                <Trash2 className="w-3 h-3 text-status-error dark:text-red-400" />
              </button>
            </div>
          </div>

          {isExpanded && renderDepartmentTree(dept.id, level + 1)}
        </div>
      );
    });
  };

  const availableUsers = users.filter(
    u => !deptMembers.some(m => m.user_id === u.id)
  );

  const filteredAvailableUsers = availableUsers.filter(user =>
    user.full_name.toLowerCase().includes(userSearchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(userSearchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div className="lg:col-span-2 bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-3 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Struktura działów
            </h2>
          </div>
          <button
            onClick={() => setShowAddDept(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-primary text-white text-xs font-medium rounded-md hover:bg-brand-primary-hover transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Dodaj dział
          </button>
        </div>

        <div className="p-3 space-y-1">
          {renderDepartmentTree()}
        </div>
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-3 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Użytkownicy działu
            </h3>
          </div>
        </div>

        <div className="p-3">
          {selectedDept ? (
            <>
              <div className="mb-3 pb-3 border-b border-slate-200 dark:border-slate-700/50">
                <h4 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                  Dodaj użytkownika
                </h4>
                {availableUsers.length > 0 ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                      <input
                        type="text"
                        placeholder="Szukaj użytkownika..."
                        value={userSearchQuery}
                        onChange={(e) => setUserSearchQuery(e.target.value)}
                        className="w-full pl-7 pr-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary dark:bg-dark-surface-variant dark:text-text-primary-dark"
                      />
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {filteredAvailableUsers.length > 0 ? (
                        filteredAvailableUsers.map(user => (
                          <div
                            key={user.id}
                            className="flex items-center justify-between p-1.5 hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant rounded-md border border-transparent hover:border-slate-200 dark:hover:border-slate-700/50 transition"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-xs text-text-primary-light dark:text-text-primary-dark truncate">
                                {user.full_name}
                              </div>
                              <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark truncate">
                                {user.email}
                              </div>
                            </div>
                            <button
                              onClick={() => handleAddMember(user.id)}
                              className="p-1 hover:bg-brand-primary/10 dark:hover:bg-brand-primary/20 rounded transition flex-shrink-0"
                            >
                              <Plus className="w-3 h-3 text-brand-primary" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark text-center py-2">
                          Brak użytkowników pasujących do zapytania
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    Wszyscy użytkownicy są już przypisani
                  </p>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                  Przypisani użytkownicy
                </h4>
                {deptMembers.length > 0 ? (
                  <div className="space-y-1">
                    {deptMembers.map(member => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-1.5 bg-light-surface-variant dark:bg-dark-surface-variant rounded-md border border-slate-200 dark:border-slate-700/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-xs text-text-primary-light dark:text-text-primary-dark truncate">
                            {member.user.full_name}
                          </div>
                          <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark truncate">
                            {member.user.role}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition flex-shrink-0"
                        >
                          <X className="w-3 h-3 text-status-error dark:text-red-400" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    Brak przypisanych użytkowników
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="text-center text-text-secondary-light dark:text-text-secondary-dark text-xs py-8">
              Wybierz dział aby zarządzać użytkownikami
            </div>
          )}
        </div>
      </div>

      {showAddDept && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-xl max-w-md w-full border border-slate-200 dark:border-slate-700/50 max-h-[90vh] overflow-y-auto">
            <div className="px-3 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between sticky top-0">
              <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Dodaj nowy dział
              </h3>
              <button
                onClick={() => {
                  setShowAddDept(false);
                  setNewDept({ name: '', parent_department_id: '', manager_id: '', max_invoice_amount: '', max_monthly_amount: '', google_drive_draft_folder_id: '', google_drive_unpaid_folder_id: '', google_drive_paid_folder_id: '' });
                }}
                className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors"
              >
                <X className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              </button>
            </div>

            <div className="p-3 space-y-2.5">
              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                  Nazwa działu *
                </label>
                <input
                  type="text"
                  value={newDept.name}
                  onChange={(e) => setNewDept({ ...newDept, name: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark"
                  placeholder="np. IT, Księgowość"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                  Dział nadrzędny (opcjonalnie)
                </label>
                <select
                  value={newDept.parent_department_id}
                  onChange={(e) => setNewDept({ ...newDept, parent_department_id: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                >
                  <option value="">Brak (dział główny)</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                  Kierownik (opcjonalnie)
                </label>
                <select
                  value={newDept.manager_id}
                  onChange={(e) => setNewDept({ ...newDept, manager_id: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                >
                  <option value="">Brak</option>
                  {users.filter(u => u.role === 'Kierownik').map(user => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                  Dyrektor (opcjonalnie)
                </label>
                <select
                  value={newDept.director_id}
                  onChange={(e) => setNewDept({ ...newDept, director_id: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                >
                  <option value="">Brak</option>
                  {users.filter(u => u.role === 'Dyrektor').map(user => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-700/50 pt-2.5 mt-2.5">
                <h4 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-1.5">
                  Limity zatwierdzania faktur
                </h4>
                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mb-2">
                  Ustaw maksymalne kwoty dla automatycznego zatwierdzania faktur bez potrzeby akceptacji przez działy nadrzędne
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                      Max kwota pojedynczej faktury (PLN)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newDept.max_invoice_amount}
                      onChange={(e) => setNewDept({ ...newDept, max_invoice_amount: e.target.value })}
                      className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="np. 5000.00"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                      Max suma miesięcznych faktur (PLN)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newDept.max_monthly_amount}
                      onChange={(e) => setNewDept({ ...newDept, max_monthly_amount: e.target.value })}
                      className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="np. 50000.00"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-700/50 pt-2.5 mt-2.5">
                <h4 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-1.5">
                  Foldery Google Drive
                </h4>
                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mb-2">
                  Wprowadź ID folderów Google Drive dla automatycznego przenoszenia faktur
                </p>

                <div className="space-y-2">
                  <div>
                    <label className="block text-[10px] font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                      Folder dla faktur roboczych
                    </label>
                    <input
                      type="text"
                      value={newDept.google_drive_draft_folder_id}
                      onChange={(e) => setNewDept({ ...newDept, google_drive_draft_folder_id: e.target.value })}
                      className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="ID folderu z Google Drive"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                      Folder dla faktur nieopłaconych
                    </label>
                    <input
                      type="text"
                      value={newDept.google_drive_unpaid_folder_id}
                      onChange={(e) => setNewDept({ ...newDept, google_drive_unpaid_folder_id: e.target.value })}
                      className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="ID folderu z Google Drive"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-medium text-text-primary-light dark:text-text-primary-dark mb-1">
                      Folder dla faktur opłaconych
                    </label>
                    <input
                      type="text"
                      value={newDept.google_drive_paid_folder_id}
                      onChange={(e) => setNewDept({ ...newDept, google_drive_paid_folder_id: e.target.value })}
                      className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600/50 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="ID folderu z Google Drive"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2.5 border-t border-slate-200 dark:border-slate-700/50">
                <button
                  onClick={handleCreateDept}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-brand-primary text-white text-xs font-medium rounded-md hover:bg-brand-primary-hover transition-all"
                >
                  <Save className="w-3 h-3" />
                  Zapisz
                </button>
                <button
                  onClick={() => {
                    setShowAddDept(false);
                    setNewDept({ name: '', parent_department_id: '', manager_id: '', max_invoice_amount: '', max_monthly_amount: '', google_drive_draft_folder_id: '', google_drive_unpaid_folder_id: '', google_drive_paid_folder_id: '' });
                  }}
                  className="px-3 py-1.5 text-text-secondary-light dark:text-text-secondary-dark text-xs font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                >
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="lg:col-span-3">
        <DepartmentFlowChart departments={departments} />
      </div>

      {showEditDept && editingDept && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-xl max-w-lg w-full border border-slate-200 dark:border-slate-700/50 max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between sticky top-0">
              <h3 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">
                Edytuj dział
              </h3>
              <button
                onClick={() => {
                  setShowEditDept(false);
                  setEditingDept(null);
                }}
                className="p-1 hover:bg-light-surface dark:hover:bg-dark-surface rounded transition-colors"
              >
                <X className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  Nazwa działu *
                </label>
                <input
                  type="text"
                  value={editingDept.name}
                  onChange={(e) => setEditingDept({ ...editingDept, name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  Dział nadrzędny (opcjonalnie)
                </label>
                <select
                  value={editingDept.parent_department_id || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, parent_department_id: e.target.value || null })}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                >
                  <option value="">Brak (dział główny)</option>
                  {departments.filter(d => d.id !== editingDept.id).map(dept => (
                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  Kierownik (opcjonalnie)
                </label>
                <select
                  value={editingDept.manager_id || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, manager_id: e.target.value || null })}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                >
                  <option value="">Brak</option>
                  {users.filter(u => u.role === 'Kierownik').map(user => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                  Dyrektor (opcjonalnie)
                </label>
                <select
                  value={editingDept.director_id || ''}
                  onChange={(e) => setEditingDept({ ...editingDept, director_id: e.target.value || null })}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                >
                  <option value="">Brak</option>
                  {users.filter(u => u.role === 'Dyrektor').map(user => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4 mt-4">
                <h4 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                  Limity zatwierdzania faktur
                </h4>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-3">
                  Ustaw maksymalne kwoty dla automatycznego zatwierdzania faktur bez potrzeby akceptacji przez działy nadrzędne
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                      Max kwota pojedynczej faktury (PLN)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingDept.max_invoice_amount || ''}
                      onChange={(e) => setEditingDept({ ...editingDept, max_invoice_amount: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="np. 5000.00"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                      Max suma miesięcznych faktur (PLN)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingDept.max_monthly_amount || ''}
                      onChange={(e) => setEditingDept({ ...editingDept, max_monthly_amount: e.target.value ? parseFloat(e.target.value) : null })}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="np. 50000.00"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4 mt-4">
                <h4 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark mb-2">
                  Foldery Google Drive
                </h4>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-3">
                  Wprowadź ID folderów Google Drive dla automatycznego przenoszenia faktur
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                      Folder dla faktur roboczych
                    </label>
                    <input
                      type="text"
                      value={editingDept.google_drive_draft_folder_id || ''}
                      onChange={(e) => setEditingDept({ ...editingDept, google_drive_draft_folder_id: e.target.value || null })}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="ID folderu z Google Drive"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                      Folder dla faktur nieopłaconych
                    </label>
                    <input
                      type="text"
                      value={editingDept.google_drive_unpaid_folder_id || ''}
                      onChange={(e) => setEditingDept({ ...editingDept, google_drive_unpaid_folder_id: e.target.value || null })}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="ID folderu z Google Drive"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                      Folder dla faktur opłaconych
                    </label>
                    <input
                      type="text"
                      value={editingDept.google_drive_paid_folder_id || ''}
                      onChange={(e) => setEditingDept({ ...editingDept, google_drive_paid_folder_id: e.target.value || null })}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary bg-light-surface dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark"
                      placeholder="ID folderu z Google Drive"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-200 dark:border-slate-700/50">
                <button
                  onClick={handleUpdateDept}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-brand-primary text-white text-sm font-medium rounded-lg hover:bg-brand-primary-hover transition-all"
                >
                  <Save className="w-4 h-4" />
                  Zapisz
                </button>
                <button
                  onClick={() => {
                    setShowEditDept(false);
                    setEditingDept(null);
                  }}
                  className="px-4 py-2 text-text-secondary-light dark:text-text-secondary-dark text-sm font-medium hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                >
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
