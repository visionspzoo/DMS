import { useState } from 'react';
import { Plus, Trash2, Send, Link, DollarSign, AlignLeft, Hash, MapPin, Zap, CheckCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const DELIVERY_LOCATIONS = ['Botaniczna', 'Budowlanych', 'Lęborska'] as const;
const PRIORITIES = [
  { value: 'niski', label: 'Niski', color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400' },
  { value: 'normalny', label: 'Normalny', color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400' },
  { value: 'wysoki', label: 'Wysoki', color: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400' },
  { value: 'pilny', label: 'Pilny', color: 'text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400' },
] as const;

type Priority = typeof PRIORITIES[number]['value'];
type DeliveryLocation = typeof DELIVERY_LOCATIONS[number];

interface RequestItem {
  id: string;
  link: string;
  gross_amount: string;
  description: string;
  quantity: string;
  delivery_location: DeliveryLocation;
  priority: Priority;
}

function createEmptyItem(): RequestItem {
  return {
    id: crypto.randomUUID(),
    link: '',
    gross_amount: '',
    description: '',
    quantity: '1',
    delivery_location: 'Botaniczna',
    priority: 'normalny',
  };
}

function ItemCard({
  item,
  index,
  total,
  onChange,
  onRemove,
}: {
  item: RequestItem;
  index: number;
  total: number;
  onChange: (id: string, field: keyof RequestItem, value: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="bg-white dark:bg-dark-card border border-border-light dark:border-border-dark rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
          Pozycja {index + 1}
        </span>
        {total > 1 && (
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="p-1.5 rounded-lg text-text-secondary-light dark:text-text-secondary-dark hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5">
            <span className="flex items-center gap-1.5"><Link className="w-3.5 h-3.5" />Link do zakupu</span>
          </label>
          <input
            type="url"
            value={item.link}
            onChange={e => onChange(item.id, 'link', e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 rounded-lg border border-border-light dark:border-border-dark bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5">
            <span className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5" />Kwota brutto (PLN)</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.gross_amount}
            onChange={e => onChange(item.id, 'gross_amount', e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 rounded-lg border border-border-light dark:border-border-dark bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5">
            <span className="flex items-center gap-1.5"><Hash className="w-3.5 h-3.5" />Ilość sztuk</span>
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={item.quantity}
            onChange={e => onChange(item.id, 'quantity', e.target.value)}
            placeholder="1"
            className="w-full px-3 py-2 rounded-lg border border-border-light dark:border-border-dark bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-colors"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5">
            <span className="flex items-center gap-1.5"><AlignLeft className="w-3.5 h-3.5" />Opis</span>
          </label>
          <textarea
            value={item.description}
            onChange={e => onChange(item.id, 'description', e.target.value)}
            placeholder="Opisz co i po co kupujesz..."
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-border-light dark:border-border-dark bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5">
            <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />Dostawa do</span>
          </label>
          <select
            value={item.delivery_location}
            onChange={e => onChange(item.id, 'delivery_location', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border-light dark:border-border-dark bg-light-bg dark:bg-dark-bg text-sm text-text-primary-light dark:text-text-primary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-colors"
          >
            {DELIVERY_LOCATIONS.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5">
            <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" />Priorytet</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {PRIORITIES.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => onChange(item.id, 'priority', p.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  item.priority === p.value
                    ? `${p.color} border-current`
                    : 'text-text-secondary-light dark:text-text-secondary-dark bg-transparent border-border-light dark:border-border-dark hover:border-text-secondary-light dark:hover:border-text-secondary-dark'
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
  const { user } = useAuth();
  const [items, setItems] = useState<RequestItem[]>([createEmptyItem()]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(id: string, field: keyof RequestItem, value: string) {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  }

  function addItem() {
    setItems(prev => [...prev, createEmptyItem()]);
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
      status: 'pending',
    }));

    const { error: insertError } = await supabase.from('purchase_requests').insert(rows);

    setSubmitting(false);

    if (insertError) {
      setError('Błąd podczas wysyłania wniosku. Spróbuj ponownie.');
      return;
    }

    setSuccess(true);
    setItems([createEmptyItem()]);
    setTimeout(() => setSuccess(false), 5000);
  }

  const totalAmount = items.reduce((sum, item) => {
    const amount = parseFloat(item.gross_amount || '0') * parseInt(item.quantity || '1');
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-text-primary-light dark:text-text-primary-dark">Wniosek zakupowy</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">
            Wypełnij formularz i wyślij wniosek do akceptacji.
          </p>
        </div>

        {success && (
          <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 text-emerald-700 dark:text-emerald-400">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">Wniosek został wysłany pomyslnie!</span>
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 text-red-700 dark:text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700 text-lg leading-none">&times;</button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {items.map((item, index) => (
              <ItemCard
                key={item.id}
                item={item}
                index={index}
                total={items.length}
                onChange={handleChange}
                onRemove={removeItem}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={addItem}
            className="mt-4 w-full py-3 rounded-xl border-2 border-dashed border-border-light dark:border-border-dark text-text-secondary-light dark:text-text-secondary-dark hover:border-brand-primary hover:text-brand-primary dark:hover:border-brand-primary dark:hover:text-brand-primary transition-all flex items-center justify-center gap-2 text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Dodaj kolejną pozycję
          </button>

          <div className="mt-6 bg-white dark:bg-dark-card border border-border-light dark:border-border-dark rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Łączna kwota brutto</p>
              <p className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">
                {totalAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN
              </p>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                {items.length} {items.length === 1 ? 'pozycja' : items.length < 5 ? 'pozycje' : 'pozycji'}
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-primary hover:bg-brand-primary/90 text-white font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
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
