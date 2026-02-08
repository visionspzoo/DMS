import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Building2, Plus, Trash2, Users, AlertCircle, X } from 'lucide-react';

interface Department {
  id: string;
  name: string;
  parent_department_id: string | null;
  manager_id: string | null;
  director_id: string | null;
  created_at: string;
}

interface Manager {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface DepartmentManager {
  id: string;
  department_id: string;
  manager_id: string;
  manager?: Manager;
}

interface DepartmentManagementProps {
  userId: string;
  onBack: () => void;
}

export default function DepartmentManagement({ userId, onBack }: DepartmentManagementProps) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [departmentManagers, setDepartmentManagers] = useState<DepartmentManager[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [selectedParentDepartment, setSelectedParentDepartment] = useState<string>('');
  const [selectedDepartmentManager, setSelectedDepartmentManager] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [selectedManager, setSelectedManager] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      await Promise.all([
        loadDepartments(),
        loadManagers(),
        loadDepartmentManagers()
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadDepartments() {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .order('name');

    if (error) throw error;
    setDepartments(data || []);
  }

  async function loadManagers() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .in('role', ['Kierownik', 'Dyrektor'])
      .order('full_name');

    if (error) throw error;
    setManagers(data || []);
  }

  async function loadDepartmentManagers() {
    const { data, error } = await supabase
      .from('department_managers')
      .select(`
        id,
        department_id,
        manager_id,
        manager:manager_id(id, full_name, email, role)
      `);

    if (error) throw error;
    setDepartmentManagers(data || []);
  }

  async function handleCreateDepartment(e: React.FormEvent) {
    e.preventDefault();

    if (!newDepartmentName.trim()) {
      setError('Department name is required');
      return;
    }

    try {
      setError(null);
      const { error } = await supabase
        .from('departments')
        .insert({
          name: newDepartmentName.trim(),
          parent_department_id: selectedParentDepartment || null,
          manager_id: selectedDepartmentManager || null,
          created_by: userId
        });

      if (error) throw error;

      setSuccess('Department created successfully');
      setNewDepartmentName('');
      setSelectedParentDepartment('');
      setSelectedDepartmentManager('');
      loadDepartments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create department');
    }
  }

  async function handleDeleteDepartment(departmentId: string) {
    if (!confirm('Are you sure you want to delete this department?')) {
      return;
    }

    try {
      setError(null);
      const { error } = await supabase
        .from('departments')
        .delete()
        .eq('id', departmentId);

      if (error) throw error;

      setSuccess('Department deleted successfully');
      loadDepartments();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete department');
    }
  }

  async function handleAssignManager(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedDepartment || !selectedManager) {
      setError('Please select both department and manager');
      return;
    }

    try {
      setError(null);
      const { error } = await supabase
        .from('department_managers')
        .insert({
          department_id: selectedDepartment,
          manager_id: selectedManager,
          assigned_by: userId
        });

      if (error) throw error;

      setSuccess('Manager assigned successfully');
      setSelectedManager('');
      setSelectedDepartment(null);
      loadDepartmentManagers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign manager');
    }
  }

  async function handleRemoveAssignment(assignmentId: string) {
    try {
      setError(null);
      const { error } = await supabase
        .from('department_managers')
        .delete()
        .eq('id', assignmentId);

      if (error) throw error;

      setSuccess('Manager removed successfully');
      loadDepartmentManagers();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove manager');
    }
  }

  function getDepartmentManagers(departmentId: string) {
    return departmentManagers.filter(dm => dm.department_id === departmentId);
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Building2 className="w-8 h-8 text-slate-700" />
              <h1 className="text-3xl font-bold text-slate-900">Department Management</h1>
            </div>
            <p className="text-slate-600">Create departments and assign managers</p>
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
            <Building2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-green-900">Success</h3>
              <p className="text-green-700 text-sm">{success}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Create Department</h2>
            <form onSubmit={handleCreateDepartment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Department Name
                </label>
                <input
                  type="text"
                  value={newDepartmentName}
                  onChange={(e) => setNewDepartmentName(e.target.value)}
                  placeholder="Enter department name"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Parent Department (Optional)
                </label>
                <select
                  value={selectedParentDepartment}
                  onChange={(e) => setSelectedParentDepartment(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Department Manager (Optional)
                </label>
                <select
                  value={selectedDepartmentManager}
                  onChange={(e) => setSelectedDepartmentManager(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">None</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.full_name} ({manager.email})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all"
              >
                <Plus className="w-4 h-4" />
                Create Department
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Assign Manager</h2>
            <form onSubmit={handleAssignManager} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Department
                </label>
                <select
                  value={selectedDepartment || ''}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select department</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Manager
                </label>
                <select
                  value={selectedManager}
                  onChange={(e) => setSelectedManager(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select manager</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.full_name} ({manager.email})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all"
              >
                <Users className="w-4 h-4" />
                Assign Manager
              </button>
            </form>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
            <h2 className="text-lg font-semibold text-slate-900">Departments</h2>
          </div>
          <div className="divide-y divide-slate-200">
            {departments.map((dept) => {
              const deptManagers = getDepartmentManagers(dept.id);
              const parentDept = departments.find(d => d.id === dept.parent_department_id);
              const deptManager = managers.find(m => m.id === dept.manager_id);
              return (
                <div key={dept.id} className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{dept.name}</h3>
                      <p className="text-sm text-slate-500">
                        Created {new Date(dept.created_at).toLocaleDateString()}
                      </p>
                      {parentDept && (
                        <p className="text-sm text-slate-600 mt-1">
                          <span className="font-medium">Parent:</span> {parentDept.name}
                        </p>
                      )}
                      {deptManager && (
                        <p className="text-sm text-slate-600 mt-1">
                          <span className="font-medium">Manager:</span> {deptManager.full_name}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteDepartment(dept.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-slate-700">Additional Assigned Managers:</h4>
                    {deptManagers.length === 0 ? (
                      <p className="text-sm text-slate-500">No additional managers assigned</p>
                    ) : (
                      <div className="space-y-2">
                        {deptManagers.map((dm) => (
                          <div
                            key={dm.id}
                            className="flex items-center justify-between bg-slate-50 rounded-lg p-3"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {(dm.manager as Manager)?.full_name}
                              </p>
                              <p className="text-xs text-slate-500">
                                {(dm.manager as Manager)?.email}
                              </p>
                            </div>
                            <button
                              onClick={() => handleRemoveAssignment(dm.id)}
                              className="p-1.5 text-red-600 hover:bg-red-100 rounded transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {departments.length === 0 && (
            <div className="px-6 py-12 text-center text-slate-500">
              No departments created yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
