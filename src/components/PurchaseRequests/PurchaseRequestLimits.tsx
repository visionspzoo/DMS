import { useState, useEffect } from 'react';
import { Save, DollarSign, Users, ShieldCheck, AlertCircle, CheckCircle, Pencil } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface UserLimit {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  department_name: string | null;
  single_limit: number | null;
  limit_id: string | null;
}

function LimitRow({
  user,
  onSave,
}: {
  user: UserLimit;
  onSave: (userId: string, single: number | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [singleVal, setSingleVal] = useState(user.single_limit?.toString() || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    const single = singleVal ? parseFloat(singleVal) : null;
    const ok = await onSave(user.user_id, single);
    setSaving(false);
    if (ok) {
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  const roleColor = user.role === 'Dyrektor'
    ? 'text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400'
    : 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400';

  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-full bg-brand-primary/10 dark:bg-brand-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-brand-primary">
              {(user.full_name || user.email).charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate">
              {user.full_name || user.email}
            </p>
            {user.department_name && (
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark truncate">{user.department_name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${roleColor}`}>{user.role}</span>
          {saved && <CheckCircle className="w-4 h-4 text-emerald-500" />}
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-lg text-text-secondary-light dark:text-text-secondary-dark hover:text-brand-primary hover:bg-brand-primary/10 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
                <DollarSign className="w-3.5 h-3.5" />
                Limit jednorazowy (PLN)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={singleVal}
                onChange={e => setSingleVal(e.target.value)}
                placeholder="Brak limitu"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
              />
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                Wnioski do tej kwoty nie wymagają akceptacji wyższego szczebla
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setSingleVal(user.single_limit?.toString() || '');
                  setEditing(false);
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700/50 text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant text-sm transition-all"
              >
                Anuluj
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary hover:bg-brand-primary-hover text-white font-semibold text-sm transition-all disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Zapisuję...' : 'Zapisz'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <DollarSign className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-0.5">Limit jednorazowy</p>
              <p className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                {user.single_limit != null
                  ? `${user.single_limit.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN`
                  : <span className="text-text-secondary-light dark:text-text-secondary-dark font-normal">Brak limitu</span>
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PurchaseRequestLimits() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canManage = profile?.role === 'Kierownik' || profile?.role === 'Dyrektor';

  useEffect(() => {
    if (canManage && profile?.id) loadUsers();
    else setLoading(false);
  }, [profile]);

  async function loadUsers() {
    if (!profile?.id) return;
    setLoading(true);

    const myId = profile.id;
    const isDirector = profile.role === 'Dyrektor';
    const isManager = profile.role === 'Kierownik';

    const { data: allDepts } = await supabase
      .from('departments')
      .select('id, name, manager_id, director_id');

    const myDepts = (allDepts || []).filter(d =>
      (isDirector && d.director_id === myId) ||
      (isManager && d.manager_id === myId)
    );

    if (myDepts.length === 0) {
      setUsers([]);
      setLoading(false);
      return;
    }

    const myDeptIds = myDepts.map(d => d.id);
    const deptsMap = Object.fromEntries((allDepts || []).map(d => [d.id, d.name]));

    let subordinateUserIds: string[] = [];
    const userDeptMap: Record<string, string> = {};

    if (isDirector) {
      const { data: membersData } = await supabase
        .from('department_members')
        .select('user_id, department_id')
        .in('department_id', myDeptIds);

      for (const m of membersData || []) {
        if (m.user_id !== myId) {
          if (!userDeptMap[m.user_id]) userDeptMap[m.user_id] = m.department_id;
          if (!subordinateUserIds.includes(m.user_id)) subordinateUserIds.push(m.user_id);
        }
      }

      const managerIds = myDepts.map(d => d.manager_id).filter(Boolean) as string[];
      for (const managerId of managerIds) {
        if (managerId !== myId && !subordinateUserIds.includes(managerId)) {
          subordinateUserIds.push(managerId);
        }
      }
    } else if (isManager) {
      const { data: membersData } = await supabase
        .from('department_members')
        .select('user_id, department_id')
        .in('department_id', myDeptIds);

      for (const m of membersData || []) {
        if (m.user_id !== myId) {
          if (!userDeptMap[m.user_id]) userDeptMap[m.user_id] = m.department_id;
          if (!subordinateUserIds.includes(m.user_id)) subordinateUserIds.push(m.user_id);
        }
      }
    }

    if (subordinateUserIds.length === 0) {
      setUsers([]);
      setLoading(false);
      return;
    }

    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, department_id')
      .in('id', subordinateUserIds)
      .in('role', isDirector ? ['Kierownik', 'Specjalista'] : ['Specjalista'])
      .order('role')
      .order('full_name');

    if (!profilesData || profilesData.length === 0) {
      setUsers([]);
      setLoading(false);
      return;
    }

    const validIds = profilesData.map(p => p.id);

    const { data: limitsData } = await supabase
      .from('purchase_request_limits')
      .select('*')
      .in('user_id', validIds);

    const limitsMap = Object.fromEntries((limitsData || []).map(l => [l.user_id, l]));

    const deptForUser = (p: { id: string; department_id: string | null }) => {
      if (userDeptMap[p.id]) return userDeptMap[p.id];
      if (p.department_id) return p.department_id;
      const dept = myDepts.find(d => d.manager_id === p.id);
      return dept?.id || null;
    };

    const result: UserLimit[] = profilesData.map(p => {
      const deptId = deptForUser(p);
      return {
        user_id: p.id,
        full_name: p.full_name,
        email: p.email,
        role: p.role,
        department_name: deptId ? deptsMap[deptId] || null : null,
        single_limit: limitsMap[p.id]?.single_limit ?? null,
        limit_id: limitsMap[p.id]?.id ?? null,
      };
    });

    setUsers(result);
    setLoading(false);
  }

  async function handleSave(userId: string, single: number | null): Promise<boolean> {
    setError(null);
    const existing = users.find(u => u.user_id === userId);

    const payload = {
      user_id: userId,
      single_limit: single,
      monthly_limit: null,
      set_by: profile?.id,
      updated_at: new Date().toISOString(),
    };

    let err;
    if (existing?.limit_id) {
      const { error: e } = await supabase
        .from('purchase_request_limits')
        .update(payload)
        .eq('user_id', userId);
      err = e;
    } else {
      const { error: e } = await supabase
        .from('purchase_request_limits')
        .insert(payload);
      err = e;
    }

    if (err) {
      setError('Błąd podczas zapisu. Spróbuj ponownie.');
      return false;
    }

    setUsers(prev => prev.map(u =>
      u.user_id === userId
        ? { ...u, single_limit: single }
        : u
    ));
    return true;
  }

  if (!canManage) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Tylko kierownicy i dyrektorzy mogą zarządzać limitami.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 px-4 py-3 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant border border-slate-200 dark:border-slate-700/50 flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-0.5">Jak działa limit jednorazowy?</p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
            Jeśli kierownik lub dyrektor ma ustawiony <strong>limit jednorazowy</strong>, wnioski do tej kwoty są automatycznie zatwierdzane na ich etapie i nie wymagają ręcznej akceptacji.
            Brak limitu oznacza, że wszystkie wnioski wymagają ręcznej akceptacji.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-10 h-10 mx-auto mb-3 text-text-secondary-light dark:text-text-secondary-dark opacity-30" />
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            {profile?.role === 'Dyrektor'
              ? 'Brak kierowników i specjalistów w Twoich działach'
              : 'Brak specjalistów w Twoich działach'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.map(u => (
            <LimitRow key={u.user_id} user={u} onSave={handleSave} />
          ))}
        </div>
      )}
    </div>
  );
}
