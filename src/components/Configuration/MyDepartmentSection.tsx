import { useState, useEffect } from 'react';
import { Building2, Users, TrendingUp, CreditCard as Edit2, Save, X, AlertCircle, CheckCircle, ChevronDown, ChevronRight, Crown, UserCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

interface DepartmentMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_manager: boolean;
  is_director: boolean;
}

interface ManagedDepartment {
  id: string;
  name: string;
  mpk_code: string | null;
  max_invoice_amount: number | null;
  max_monthly_amount: number | null;
  members: DepartmentMember[];
}

interface MemberLimit {
  manager_id: string;
  single_invoice_limit: number;
  monthly_limit: number;
}

const fmt = (val: number | null | undefined) =>
  val !== null && val !== undefined
    ? new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 }).format(val)
    : null;

export default function MyDepartmentSection() {
  const { profile, user } = useAuth();
  const [departments, setDepartments] = useState<ManagedDepartment[]>([]);
  const [limits, setLimits] = useState<MemberLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [singleInput, setSingleInput] = useState('');
  const [monthlyInput, setMonthlyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isManagerOrDirector = profile?.role === 'Kierownik' || profile?.role === 'Dyrektor';

  useEffect(() => {
    if (profile?.id) loadData();
  }, [profile?.id]);

  async function loadData() {
    if (!profile?.id) return;
    setLoading(true);
    try {
      await Promise.all([loadDepartments(), loadLimits()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadDepartments() {
    const column = profile?.role === 'Dyrektor' ? 'director_id' : 'manager_id';

    const { data: depts, error: deptsErr } = await supabase
      .from('departments')
      .select('id, name, mpk_code, max_invoice_amount, max_monthly_amount')
      .eq(column, profile!.id);

    if (deptsErr || !depts || depts.length === 0) {
      setDepartments([]);
      return;
    }

    const deptIds = depts.map(d => d.id);
    const membersResults = await Promise.all(
      deptIds.map(id =>
        supabase.rpc('get_department_users', { p_department_id: id })
      )
    );

    const result: ManagedDepartment[] = depts.map((dept, i) => ({
      ...dept,
      members: (membersResults[i].data || []) as DepartmentMember[],
    }));

    setDepartments(result);
    setExpandedDepts(new Set(deptIds));
  }

  async function loadLimits() {
    const { data } = await supabase
      .from('manager_limits')
      .select('manager_id, single_invoice_limit, monthly_limit');
    setLimits(data || []);
  }

  function getMemberLimit(memberId: string): MemberLimit | undefined {
    return limits.find(l => l.manager_id === memberId);
  }

  function startEditing(memberId: string) {
    const existing = getMemberLimit(memberId);
    setEditingMember(memberId);
    setSingleInput(existing ? String(existing.single_invoice_limit) : '');
    setMonthlyInput(existing ? String(existing.monthly_limit) : '');
    setError(null);
  }

  function cancelEditing() {
    setEditingMember(null);
    setSingleInput('');
    setMonthlyInput('');
    setError(null);
  }

  async function saveLimit(memberId: string) {
    const single = parseFloat(singleInput);
    const monthly = parseFloat(monthlyInput);

    if (isNaN(single) || single < 0) {
      setError('Limit pojedynczej faktury musi być liczbą nieujemną');
      return;
    }
    if (isNaN(monthly) || monthly < 0) {
      setError('Limit miesięczny musi być liczbą nieujemną');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const existing = getMemberLimit(memberId);
      if (existing) {
        const { error: err } = await supabase
          .from('manager_limits')
          .update({ single_invoice_limit: single, monthly_limit: monthly })
          .eq('manager_id', memberId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from('manager_limits')
          .insert({ manager_id: memberId, set_by: user!.id, single_invoice_limit: single, monthly_limit: monthly });
        if (err) throw err;
      }
      setSuccess('Limity zostały zapisane');
      setEditingMember(null);
      await loadLimits();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd podczas zapisywania limitów');
    } finally {
      setSaving(false);
    }
  }

  function toggleDept(deptId: string) {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      next.has(deptId) ? next.delete(deptId) : next.add(deptId);
      return next;
    });
  }

  function roleLabel(role: string) {
    const map: Record<string, string> = {
      Specjalista: 'Specjalista',
      Kierownik: 'Kierownik',
      Dyrektor: 'Dyrektor',
      CEO: 'CEO',
    };
    return map[role] || role;
  }

  function roleBadgeClass(role: string) {
    if (role === 'Kierownik') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    if (role === 'Dyrektor') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    if (role === 'CEO') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
    return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  }

  if (!isManagerOrDirector) return null;

  if (loading) {
    return (
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">Mój dział</h2>
          </div>
        </div>
        <div className="flex items-center justify-center h-24">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-primary" />
        </div>
      </div>
    );
  }

  if (departments.length === 0) return null;

  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
          <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">Mój dział</h2>
        </div>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
          Struktura i limity zatwierdzania faktur dla członków Twojego działu
        </p>
      </div>

      <div className="p-4 space-y-4">
        {success && (
          <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
            <span className="text-sm text-green-800 dark:text-green-300">{success}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            <span className="text-sm text-red-800 dark:text-red-300">{error}</span>
          </div>
        )}

        {departments.map(dept => {
          const isOpen = expandedDepts.has(dept.id);
          const subordinates = dept.members.filter(m => m.id !== profile?.id);

          return (
            <div key={dept.id} className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleDept(dept.id)}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <Building2 className="w-4 h-4 text-brand-primary flex-shrink-0" />
                  <div>
                    <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                      {dept.name}
                    </span>
                    {dept.mpk_code && (
                      <span className="ml-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                        MPK: {dept.mpk_code}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                    {subordinates.length} {subordinates.length === 1 ? 'osoba' : subordinates.length < 5 ? 'osoby' : 'osób'}
                  </span>
                </div>
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
                )}
              </button>

              {isOpen && (
                <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {(dept.max_invoice_amount || dept.max_monthly_amount) && (
                    <div className="px-4 py-3 bg-amber-50/50 dark:bg-amber-900/10">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Limity działu</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Pojedyncza faktura</span>
                          <div className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                            {fmt(dept.max_invoice_amount) ?? <span className="italic text-text-secondary-light dark:text-text-secondary-dark font-normal">Brak limitu</span>}
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Miesięczny</span>
                          <div className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                            {fmt(dept.max_monthly_amount) ?? <span className="italic text-text-secondary-light dark:text-text-secondary-dark font-normal">Brak limitu</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {subordinates.length === 0 && (
                    <div className="px-4 py-6 text-center">
                      <Users className="w-8 h-8 mx-auto text-text-secondary-light dark:text-text-secondary-dark opacity-30 mb-2" />
                      <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Brak podwładnych w tym dziale</p>
                    </div>
                  )}

                  {subordinates.map(member => {
                    const limit = getMemberLimit(member.id);
                    const isEditing = editingMember === member.id;
                    const isDirector = profile?.role === 'Dyrektor';
                    const memberIsDirector = member.role === 'Dyrektor';
                    const canEdit = isDirector || (!memberIsDirector && isManagerOrDirector);

                    return (
                      <div key={member.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-brand-primary/10 dark:bg-brand-primary/20 flex items-center justify-center flex-shrink-0">
                              {member.is_manager ? (
                                <Crown className="w-4 h-4 text-brand-primary" />
                              ) : member.is_director ? (
                                <Crown className="w-4 h-4 text-amber-500" />
                              ) : (
                                <UserCheck className="w-4 h-4 text-brand-primary" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                                  {member.full_name}
                                </span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${roleBadgeClass(member.role)}`}>
                                  {roleLabel(member.role)}
                                </span>
                              </div>
                              <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark truncate">{member.email}</div>
                            </div>
                          </div>

                          {canEdit && !isEditing && (
                            <button
                              onClick={() => startEditing(member.id)}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-brand-primary hover:bg-brand-primary/10 dark:hover:bg-brand-primary/20 rounded-lg transition-colors flex-shrink-0"
                            >
                              <Edit2 className="w-3 h-3" />
                              Edytuj limity
                            </button>
                          )}
                        </div>

                        {!isEditing && (
                          <div className="mt-2.5 ml-11 grid grid-cols-2 gap-2">
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
                          </div>
                        )}

                        {isEditing && (
                          <div className="mt-3 ml-11 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700/50 space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                                  Limit pojedynczej faktury (PLN)
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={singleInput}
                                  onChange={e => setSingleInput(e.target.value)}
                                  className="w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
                                  placeholder="np. 5000.00"
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
                                  value={monthlyInput}
                                  onChange={e => setMonthlyInput(e.target.value)}
                                  className="w-full px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50"
                                  placeholder="np. 20000.00"
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => saveLimit(member.id)}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 disabled:opacity-60 transition-colors"
                              >
                                <Save className="w-3 h-3" />
                                {saving ? 'Zapisywanie...' : 'Zapisz'}
                              </button>
                              <button
                                onClick={cancelEditing}
                                disabled={saving}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
                              >
                                <X className="w-3 h-3" />
                                Anuluj
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
