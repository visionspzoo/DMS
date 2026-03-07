import { useState, useEffect } from 'react';
import { Plus, Trash2, Send, Link, DollarSign, AlignLeft, Hash, MapPin, Zap, CheckCircle, AlertCircle, Building2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const DELIVERY_LOCATIONS = ['Botaniczna', 'Budowlanych', 'Lęborska'] as const;
const PRIORITIES = [
  { value: 'niski', label: 'Niski', color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700' },
  { value: 'normalny', label: 'Normalny', color: 'text-brand-primary bg-brand-primary/10 dark:bg-brand-primary/20 border-brand-primary/40' },
  { value: 'wysoki', label: 'Wysoki', color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 border-amber-300 dark:border-amber-700' },
  { value: 'pilny', label: 'Pilny', color: 'text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400 border-red-300 dark:border-red-700' },
] as const;

type Priority = typeof PRIORITIES[number]['value'];
type DeliveryLocation = typeof DELIVERY_LOCATIONS[number];

interface Department {
  id: string;
  name: string;
}

interface RequestItem {
  id: string;
  link: string;
  gross_amount: string;
  description: string;
  quantity: string;
  delivery_location: DeliveryLocation;
  priority: Priority;
  department_id: string;
}

function createEmptyItem(defaultDepartmentId: string): RequestItem {
  return {
    id: crypto.randomUUID(),
    link: '',
    gross_amount: '',
    description: '',
    quantity: '1',
    delivery_location: 'Botaniczna',
    priority: 'normalny',
    department_id: defaultDepartmentId,
  };
}

function ItemCard({
  item,
  index,
  total,
  departments,
  onChange,
  onRemove,
}: {
  item: RequestItem;
  index: number;
  total: number;
  departments: Department[];
  onChange: (id: string, field: keyof RequestItem, value: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
          Pozycja {index + 1}
        </span>
        {total > 1 && (
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="p-1 rounded-md text-text-secondary-light dark:text-text-secondary-dark hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
            <Link className="w-3.5 h-3.5" />
            Link do zakupu
          </label>
          <input
            type="url"
            value={item.link}
            onChange={e => onChange(item.id, 'link', e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" />
            Kwota brutto (PLN)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.gross_amount}
            onChange={e => onChange(item.id, 'gross_amount', e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
            <Hash className="w-3.5 h-3.5" />
            Ilość sztuk
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={item.quantity}
            onChange={e => onChange(item.id, 'quantity', e.target.value)}
            placeholder="1"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
            <AlignLeft className="w-3.5 h-3.5" />
            Opis
          </label>
          <textarea
            value={item.description}
            onChange={e => onChange(item.id, 'description', e.target.value)}
            placeholder="Opisz co i po co kupujesz..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            Dział
          </label>
          <select
            value={item.department_id}
            onChange={e => onChange(item.id, 'department_id', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
          >
            {departments.length === 0 && (
              <option value="">Brak działów</option>
            )}
            {departments.map(dept => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            Dostawa do
          </label>
          <select
            value={item.delivery_location}
            onChange={e => onChange(item.id, 'delivery_location', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors"
          >
            {DELIVERY_LOCATIONS.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5" />
            Priorytet
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {PRIORITIES.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => onChange(item.id, 'priority', p.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  item.priority === p.value
                    ? p.color
                    : 'text-text-secondary-light dark:text-text-secondary-dark bg-transparent border-slate-200 dark:border-slate-700/50 hover:border-slate-400 dark:hover:border-slate-500'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PurchaseRequestForm() {
  const { user, profile } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [defaultDepartmentId, setDefaultDepartmentId] = useState<string>('');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDepartments();
  }, [profile]);

  async function loadDepartments() {
    const { data } = await supabase
      .from('departments')
      .select('id, name')
      .order('name');

    const depts: Department[] = data || [];
    setDepartments(depts);

    const userDeptId = profile?.department_id || '';
    const resolvedDefault = userDeptId && depts.some(d => d.id === userDeptId)
      ? userDeptId
      : depts[0]?.id || '';

    setDefaultDepartmentId(resolvedDefault);
    setItems([createEmptyItem(resolvedDefault)]);
  }

  function handleChange(id: string, field: keyof RequestItem, value: string) {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  }

  function addItem() {
    setItems(prev => [...prev, createEmptyItem(defaultDepartmentId)]);
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(item => item.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    for (const item of items) {
      if (!item.link.trim()) { setError('Uzupełnij link do zakupu w każdej pozycji.'); return; }
      if (!item.gross_amount || parseFloat(item.gross_amount) <= 0) { setError('Podaj kwotę brutto w każdej pozycji.'); return; }
      if (!item.description.trim()) { setError('Uzupełnij opis w każdej pozycji.'); return; }
      if (!item.quantity || parseInt(item.quantity) < 1) { setError('Ilość musi być co najmniej 1.'); return; }
    }

    setSubmitting(true);
    setError(null);

    const rows = items.map(item => ({
      user_id: user.id,
      link: item.link.trim(),
      gross_amount: parseFloat(item.gross_amount),
      description: item.description.trim(),
      quantity: parseInt(item.quantity),
      delivery_location: item.delivery_location,
      priority: item.priority,
      department_id: item.department_id || null,
      status: 'pending',
    }));

    const { error: insertError } = await supabase.from('purchase_requests').insert(rows);

    setSubmitting(false);

    if (insertError) {
      setError('Błąd podczas wysyłania wniosku. Spróbuj ponownie.');
      return;
    }

    setSuccess(true);
    setItems([createEmptyItem(defaultDepartmentId)]);
    setTimeout(() => setSuccess(false), 5000);
  }

  const totalAmount = items.reduce((sum, item) => {
    const amount = parseFloat(item.gross_amount || '0') * parseInt(item.quantity || '1');
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);

  if (items.length === 0) {
    return (
      <div className="h-full bg-light-bg dark:bg-dark-bg flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">Wniosek zakupowy</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
            Wypełnij formularz i wyślij wniosek do akceptacji.
          </p>
        </div>

        {success && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-400">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium">Wniosek został wysłany pomyślnie!</span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm font-medium flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 dark:hover:text-red-300 text-lg leading-none">&times;</button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="space-y-3">
            {items.map((item, index) => (
              <ItemCard
                key={item.id}
                item={item}
                index={index}
                total={items.length}
                departments={departments}
                onChange={handleChange}
                onRemove={removeItem}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addItem}
            className="mt-3 w-full py-2.5 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-text-secondary-light dark:text-text-secondary-dark hover:border-brand-primary hover:text-brand-primary dark:hover:border-brand-primary dark:hover:text-brand-primary transition-all flex items-center justify-center gap-2 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Dodaj kolejną pozycję
          </button>

          <div className="mt-4 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Łączna kwota brutto</p>
              <p className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark">
                {totalAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN
              </p>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {items.length} {items.length === 1 ? 'pozycja' : items.length < 5 ? 'pozycje' : 'pozycji'}
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-primary hover:bg-brand-primary-hover text-white font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Wysyłanie...
                </span>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Wyślij wniosek
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
