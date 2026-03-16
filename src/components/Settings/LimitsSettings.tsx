import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { DollarSign, Save, Zap, Search, ChevronDown, ChevronUp, Building2, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  department_id: string | null;
  monthly_invoice_limit: number | null;
  single_invoice_limit: number | null;
  department?: { id: string; name: string } | null;
}

interface ManagerLimit {
  manager_id: string;
  single_invoice_limit: number;
  monthly_limit: number;
  set_by: string;
}

interface PurchaseRequestLimit {
  user_id: string;
  auto_approve_limit: number | null;
}

interface Department {
  id: string;
  name: string;
  manager_id: string | null;
  director_id: string | null;
}

const fmt = (val: number | null | undefined) =>
  val !== null && val !== undefined
    ? new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 2 }).format(val)
    : '—';

function ManagerRow({
  user,
  managerLimit,
  prLimit,
  currentUserId,
  onSaved,
}: {
  user: Profile;
  managerLimit: ManagerLimit | undefined;
  prLimit: PurchaseRequestLimit | undefined;
  currentUserId: string;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [singleLimit, setSingleLimit] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [autoApprove, setAutoApprove] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setSingleLimit(managerLimit?.single_invoice_limit != null ? String(managerLimit.single_invoice_limit) : '');
    setMonthlyLimit(managerLimit?.monthly_limit != null ? String(managerLimit.monthly_limit) : '');
    setAutoApprove(prLimit?.auto_approve_limit != null ? String(prLimit.auto_approve_limit) : '');
  }, [managerLimit, prLimit]);

  async function save() {
    const single = singleLimit.trim() !== '' ? parseFloat(singleLimit) : null;
    const monthly = monthlyLimit.trim() !== '' ? parseFloat(monthlyLimit) : null;
    const auto = autoApprove.trim() !== '' ? parseFloat(autoApprove) : null;

    if (single !== null && (isNaN(single) || single < 0)) { setErr('Nieprawidłowy limit faktury'); return; }
    if (monthly !== null && (isNaN(monthly) || monthly < 0)) { setErr('Nieprawidłowy limit miesięczny'); return; }
    if (auto !== null && (isNaN(auto) || auto < 0)) { setErr('Nieprawidłowy limit wniosku'); return; }

    setSaving(true); setErr(null);
    try {
      const { data: existing } = await supabase
        .from('manager_limits')
        .select('manager_id')
        .eq('manager_id', user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('manager_limits')
          .update({ single_invoice_limit: single ?? 0, monthly_limit: monthly ?? 0 })
          .eq('manager_id', user.id);
      } else if (single !== null || monthly !== null) {
        await supabase
          .from('manager_limits')
          .insert({ manager_id: user.id, set_by: currentUserId, single_invoice_limit: single ?? 0, monthly_limit: monthly ?? 0 });
      }

      const { data: existingPr } = await supabase
        .from('purchase_request_limits')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingPr) {
        await supabase.from('purchase_request_limits').update({ auto_approve_limit: auto }).eq('user_id', user.id);
      } else {
        await supabase.from('purchase_request_limits').insert({ user_id: user.id, set_by: currentUserId, auto_approve_limit: auto });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  }

  const hasLimits = managerLimit || prLimit?.auto_approve_limit != null;

  return (
    <div className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-light-surface dark:bg-dark-surface hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-brand-primary" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
              {user.full_name}
            </div>
            <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {user.email}
              {user.department && (
                <span className="ml-2 text-brand-primary">· {user.department.name}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasLimits ? (
            <div className="flex items-center gap-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {managerLimit && (
                <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-full">
                  {fmt(managerLimit.single_invoice_limit)} / faktura
                </span>
              )}
              {prLimit?.auto_approve_limit != null && (
                <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-full">
                  {fmt(prLimit.auto_approve_limit)} auto-WZ
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Brak limitów</span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 bg-light-surface-variant dark:bg-dark-surface-variant border-t border-slate-200 dark:border-slate-700/50 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Limit pojedynczej faktury (PLN)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={singleLimit}
                onChange={e => setSingleLimit(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark"
                placeholder="np. 5000 (puste = brak)"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Limit miesięczny faktur (PLN)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={monthlyLimit}
                onChange={e => setMonthlyLimit(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark"
                placeholder="np. 20000 (puste = brak)"
              />
            </div>
          </div>

          <div className="rounded-lg p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Auto-akceptacja wniosku zakupowego (PLN)
              </span>
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-2">
              Wnioski zakupowe do tej kwoty będą akceptowane bez akceptacji dyrektora. Pozostaw puste, aby wymagać zawsze.
            </p>
            <input
              type="number"
              step="0.01"
              min="0"
              value={autoApprove}
              onChange={e => setAutoApprove(e.target.value)}
              className="w-full px-3 py-1.5 border border-emerald-300 dark:border-emerald-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark"
              placeholder="np. 3000 (puste = zawsze wymaga akceptacji)"
            />
          </div>

          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-60 ${
              saved
                ? 'bg-emerald-500 text-white'
                : 'bg-brand-primary text-white hover:bg-brand-primary/90'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Zapisywanie...' : saved ? 'Zapisano!' : 'Zapisz limity'}
          </button>
        </div>
      )}
    </div>
  );
}

function DirectorRow({
  user,
  currentUserId,
  onSaved,
}: {
  user: Profile;
  currentUserId: string;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [singleLimit, setSingleLimit] = useState('');
  const [autoApprove, setAutoApprove] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setMonthlyLimit(user.monthly_invoice_limit != null ? String(user.monthly_invoice_limit) : '');
    setSingleLimit(user.single_invoice_limit != null ? String(user.single_invoice_limit) : '');
  }, [user]);

  useEffect(() => {
    supabase
      .from('purchase_request_limits')
      .select('auto_approve_limit')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setAutoApprove(data?.auto_approve_limit != null ? String(data.auto_approve_limit) : '');
      });
  }, [user.id]);

  async function save() {
    const monthly = monthlyLimit.trim() !== '' ? parseFloat(monthlyLimit) : null;
    const single = singleLimit.trim() !== '' ? parseFloat(singleLimit) : null;
    const auto = autoApprove.trim() !== '' ? parseFloat(autoApprove) : null;

    if (single !== null && (isNaN(single) || single < 0)) { setErr('Nieprawidłowy limit faktury'); return; }
    if (monthly !== null && (isNaN(monthly) || monthly < 0)) { setErr('Nieprawidłowy limit miesięczny'); return; }
    if (auto !== null && (isNaN(auto) || auto < 0)) { setErr('Nieprawidłowy limit wniosku'); return; }

    setSaving(true); setErr(null);
    try {
      await supabase
        .from('profiles')
        .update({ monthly_invoice_limit: monthly, single_invoice_limit: single })
        .eq('id', user.id);

      const { data: existingPr } = await supabase
        .from('purchase_request_limits')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingPr) {
        await supabase.from('purchase_request_limits').update({ auto_approve_limit: auto }).eq('user_id', user.id);
      } else {
        await supabase.from('purchase_request_limits').insert({ user_id: user.id, set_by: currentUserId, auto_approve_limit: auto });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  }

  const hasLimits = user.monthly_invoice_limit != null || user.single_invoice_limit != null;

  return (
    <div className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-light-surface dark:bg-dark-surface hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <User className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
              {user.full_name}
            </div>
            <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {user.email}
              {user.department && (
                <span className="ml-2 text-brand-primary">· {user.department.name}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasLimits ? (
            <div className="flex items-center gap-2 text-xs">
              {user.single_invoice_limit != null && (
                <span className="px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-full">
                  {fmt(user.single_invoice_limit)} / faktura
                </span>
              )}
              {user.monthly_invoice_limit != null && (
                <span className="px-2 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-full">
                  {fmt(user.monthly_invoice_limit)} / mies.
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Brak limitów</span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 bg-light-surface-variant dark:bg-dark-surface-variant border-t border-slate-200 dark:border-slate-700/50 space-y-4">
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Jeśli faktura mieści się w limitach, Dyrektor może ją zatwierdzić bez przekazywania do CEO.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1">
                Limit pojedynczej faktury (PLN)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={singleLimit}
                onChange={e => setSingleLimit(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark"
                placeholder="np. 10000 (puste = brak)"
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
                value={monthlyLimit}
                onChange={e => setMonthlyLimit(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark"
                placeholder="np. 50000 (puste = brak)"
              />
            </div>
          </div>

          <div className="rounded-lg p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Auto-akceptacja wniosku zakupowego (PLN)
              </span>
            </div>
            <input
              type="number"
              step="0.01"
              min="0"
              value={autoApprove}
              onChange={e => setAutoApprove(e.target.value)}
              className="w-full px-3 py-1.5 border border-emerald-300 dark:border-emerald-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark"
              placeholder="np. 3000 (puste = zawsze wymaga akceptacji)"
            />
          </div>

          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-60 ${
              saved
                ? 'bg-emerald-500 text-white'
                : 'bg-brand-primary text-white hover:bg-brand-primary/90'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Zapisywanie...' : saved ? 'Zapisano!' : 'Zapisz limity'}
          </button>
        </div>
      )}
    </div>
  );
}

function SpecialistRow({
  user,
  prLimit,
  currentUserId,
  onSaved,
}: {
  user: Profile;
  prLimit: PurchaseRequestLimit | undefined;
  currentUserId: string;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [autoApprove, setAutoApprove] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setAutoApprove(prLimit?.auto_approve_limit != null ? String(prLimit.auto_approve_limit) : '');
  }, [prLimit]);

  async function save() {
    const auto = autoApprove.trim() !== '' ? parseFloat(autoApprove) : null;
    if (auto !== null && (isNaN(auto) || auto < 0)) { setErr('Nieprawidłowa kwota'); return; }

    setSaving(true); setErr(null);
    try {
      const { data: existing } = await supabase
        .from('purchase_request_limits')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        await supabase.from('purchase_request_limits').update({ auto_approve_limit: auto }).eq('user_id', user.id);
      } else {
        await supabase.from('purchase_request_limits').insert({ user_id: user.id, set_by: currentUserId, auto_approve_limit: auto });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-light-surface dark:bg-dark-surface hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center">
            <User className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
              {user.full_name}
            </div>
            <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {user.email}
              {user.department && (
                <span className="ml-2 text-brand-primary">· {user.department.name}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {prLimit?.auto_approve_limit != null ? (
            <span className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-full text-xs">
              {fmt(prLimit.auto_approve_limit)} auto-WZ
            </span>
          ) : (
            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Brak limitu</span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-3 bg-light-surface-variant dark:bg-dark-surface-variant border-t border-slate-200 dark:border-slate-700/50 space-y-3">
          <div className="rounded-lg p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                Auto-akceptacja wniosku zakupowego (PLN)
              </span>
            </div>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mb-2">
              Wnioski zakupowe do tej kwoty będą automatycznie zaakceptowane bez akceptacji kierownika. Pozostaw puste, aby zawsze wymagać akceptacji.
            </p>
            <input
              type="number"
              step="0.01"
              min="0"
              value={autoApprove}
              onChange={e => setAutoApprove(e.target.value)}
              className="w-full px-3 py-1.5 border border-emerald-300 dark:border-emerald-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 bg-white dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark"
              placeholder="np. 500 (puste = zawsze wymaga akceptacji)"
            />
          </div>

          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-60 ${
              saved
                ? 'bg-emerald-500 text-white'
                : 'bg-brand-primary text-white hover:bg-brand-primary/90'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Zapisywanie...' : saved ? 'Zapisano!' : 'Zapisz limit'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function LimitsSettings() {
  const { profile } = useAuth();
  const [managers, setManagers] = useState<Profile[]>([]);
  const [directors, setDirectors] = useState<Profile[]>([]);
  const [specialists, setSpecialists] = useState<Profile[]>([]);
  const [managerLimits, setManagerLimits] = useState<ManagerLimit[]>([]);
  const [prLimits, setPrLimits] = useState<PurchaseRequestLimit[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState<'managers' | 'directors' | 'specialists'>('managers');

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [profilesRes, managerLimitsRes, prLimitsRes, deptsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, full_name, role, department_id, monthly_invoice_limit, single_invoice_limit, department:department_id(id, name)')
          .in('role', ['Kierownik', 'Dyrektor', 'Specjalista'])
          .order('full_name'),
        supabase.from('manager_limits').select('manager_id, single_invoice_limit, monthly_limit, set_by'),
        supabase.from('purchase_request_limits').select('user_id, auto_approve_limit'),
        supabase.from('departments').select('id, name, manager_id, director_id'),
      ]);

      const profiles = profilesRes.data || [];
      setManagers(profiles.filter(p => p.role === 'Kierownik'));
      setDirectors(profiles.filter(p => p.role === 'Dyrektor'));
      setSpecialists(profiles.filter(p => p.role === 'Specjalista'));
      setManagerLimits(managerLimitsRes.data || []);
      setPrLimits(prLimitsRes.data || []);
      setDepartments(deptsRes.data || []);
    } finally {
      setLoading(false);
    }
  }

  const filteredManagers = managers.filter(m =>
    m.full_name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  );

  const filteredDirectors = directors.filter(d =>
    d.full_name.toLowerCase().includes(search.toLowerCase()) ||
    d.email.toLowerCase().includes(search.toLowerCase())
  );

  const filteredSpecialists = specialists.filter(s =>
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase())
  );

  const managersWithDepts = filteredManagers.map(m => {
    const depts = departments.filter(d => d.manager_id === m.id);
    return {
      ...m,
      department: depts.length > 0
        ? { id: depts[0].id, name: depts.map(d => d.name).join(', ') }
        : m.department as { id: string; name: string } | null,
    };
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">
              Limity zatwierdzania
            </h2>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Szukaj użytkownika..."
              className="pl-8 pr-3 py-1.5 border border-slate-300 dark:border-slate-600/50 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-primary/50 bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark w-48"
            />
          </div>
        </div>

        <div className="p-4">
          <div className="flex gap-1 mb-4 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg p-1 border border-slate-200 dark:border-slate-700/50">
            <button
              onClick={() => setActiveSection('managers')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                activeSection === 'managers'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              Kierownicy
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeSection === 'managers'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-text-secondary-light dark:text-text-secondary-dark'
              }`}>
                {managers.length}
              </span>
            </button>
            <button
              onClick={() => setActiveSection('directors')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                activeSection === 'directors'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              Dyrektorzy
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeSection === 'directors'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-text-secondary-light dark:text-text-secondary-dark'
              }`}>
                {directors.length}
              </span>
            </button>
            <button
              onClick={() => setActiveSection('specialists')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                activeSection === 'specialists'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Specjalisci
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                activeSection === 'specialists'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-text-secondary-light dark:text-text-secondary-dark'
              }`}>
                {specialists.length}
              </span>
            </button>
          </div>

          {activeSection === 'managers' && (
            <div className="space-y-2">
              {managersWithDepts.length === 0 ? (
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark text-center py-8">
                  Brak kierowników{search ? ' pasujących do wyszukiwania' : ''}
                </p>
              ) : (
                managersWithDepts.map(user => (
                  <ManagerRow
                    key={user.id}
                    user={user}
                    managerLimit={managerLimits.find(l => l.manager_id === user.id)}
                    prLimit={prLimits.find(l => l.user_id === user.id)}
                    currentUserId={profile?.id ?? ''}
                    onSaved={loadAll}
                  />
                ))
              )}
            </div>
          )}

          {activeSection === 'directors' && (
            <div className="space-y-2">
              {filteredDirectors.length === 0 ? (
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark text-center py-8">
                  Brak dyrektorów{search ? ' pasujących do wyszukiwania' : ''}
                </p>
              ) : (
                filteredDirectors.map(user => (
                  <DirectorRow
                    key={user.id}
                    user={user}
                    currentUserId={profile?.id ?? ''}
                    onSaved={loadAll}
                  />
                ))
              )}
            </div>
          )}

          {activeSection === 'specialists' && (
            <div className="space-y-2">
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mb-3">
                Ustaw limit auto-akceptacji wniosków zakupowych dla specjalistów. Wnioski do tej kwoty są zatwierdzane automatycznie, bez potrzeby akceptacji kierownika.
              </p>
              {filteredSpecialists.length === 0 ? (
                <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark text-center py-8">
                  Brak specjalistów{search ? ' pasujących do wyszukiwania' : ''}
                </p>
              ) : (
                filteredSpecialists.map(user => (
                  <SpecialistRow
                    key={user.id}
                    user={user}
                    prLimit={prLimits.find(l => l.user_id === user.id)}
                    currentUserId={profile?.id ?? ''}
                    onSaved={loadAll}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
