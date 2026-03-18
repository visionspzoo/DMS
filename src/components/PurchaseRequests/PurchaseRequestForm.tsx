import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Send, Link, DollarSign, AlignLeft, Hash, MapPin, Zap, CheckCircle, AlertCircle, Building2, FileText, ToggleLeft, ToggleRight, Upload, X, ArrowLeft, Save } from 'lucide-react';
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
  isProforma: boolean;
  proformaFile: File | null;
  proformaBase64: string | null;
  existingProformaFilename: string | null;
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
    isProforma: false,
    proformaFile: null,
    proformaBase64: null,
    existingProformaFilename: null,
    link: '',
    gross_amount: '',
    description: '',
    quantity: '1',
    delivery_location: 'Botaniczna',
    priority: 'normalny',
    department_id: defaultDepartmentId,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ItemCard({
  item,
  index,
  total,
  departments,
  onChange,
  onRemove,
  onProformaToggle,
  onProformaFile,
}: {
  item: RequestItem;
  index: number;
  total: number;
  departments: Department[];
  onChange: (id: string, field: keyof RequestItem, value: string) => void;
  onRemove: (id: string) => void;
  onProformaToggle: (id: string) => void;
  onProformaFile: (id: string, file: File | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
      <div className="px-4 py-3 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wider">
          Pozycja {index + 1}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onProformaToggle(item.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              item.isProforma
                ? 'text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 border-sky-300 dark:border-sky-700'
                : 'text-text-secondary-light dark:text-text-secondary-dark border-slate-200 dark:border-slate-700/50 hover:border-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {item.isProforma
              ? <ToggleRight className="w-3.5 h-3.5" />
              : <ToggleLeft className="w-3.5 h-3.5" />
            }
            Proforma PDF
          </button>
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
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {item.isProforma ? (
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              Faktura proforma (PDF)
            </label>
            {item.proformaFile ? (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-sky-200 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-900/20">
                <FileText className="w-4 h-4 text-sky-500 flex-shrink-0" />
                <span className="text-sm text-text-primary-light dark:text-text-primary-dark flex-1 truncate">{item.proformaFile.name}</span>
                <button
                  type="button"
                  onClick={() => onProformaFile(item.id, null)}
                  className="p-0.5 rounded text-text-secondary-light dark:text-text-secondary-dark hover:text-red-500 dark:hover:text-red-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : item.existingProformaFilename ? (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-sky-200 dark:border-sky-700/50 bg-sky-50 dark:bg-sky-900/20">
                <FileText className="w-4 h-4 text-sky-500 flex-shrink-0" />
                <span className="text-sm text-text-primary-light dark:text-text-primary-dark flex-1 truncate">{item.existingProformaFilename}</span>
                <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Bez zmian</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-brand-primary hover:underline"
                >
                  Zmień
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-sky-400 dark:hover:border-sky-500 text-text-secondary-light dark:text-text-secondary-dark hover:text-sky-500 dark:hover:text-sky-400 transition-all flex flex-col items-center gap-2"
              >
                <Upload className="w-5 h-5" />
                <span className="text-xs font-medium">Kliknij aby wybrać plik PDF</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={async e => {
                const file = e.target.files?.[0] || null;
                onProformaFile(item.id, file);
                e.target.value = '';
              }}
            />
          </div>
        ) : (
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
        )}

        <div>
          <label className="block text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-1.5 flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5" />
            Kwota brutto (PLN)
            {item.isProforma && <span className="text-text-secondary-light dark:text-text-secondary-dark font-normal">(opcjonalnie)</span>}
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={item.gross_amount}
            onChange={e => onChange(item.id, 'gross_amount', e.target.value)}
            placeholder={item.isProforma ? 'Z proformy' : '0.00'}
            disabled={item.isProforma && !item.gross_amount}
            className={`w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 text-sm text-text-primary-light dark:text-text-primary-dark placeholder-text-secondary-light dark:placeholder-text-secondary-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-colors ${
              item.isProforma && !item.gross_amount
                ? 'bg-slate-100 dark:bg-slate-800/50 opacity-60 cursor-not-allowed'
                : 'bg-light-bg dark:bg-dark-bg'
            }`}
          />
        </div>

        {!item.isProforma && (
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
        )}

        <div className={item.isProforma ? '' : 'md:col-span-2'}>
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
            {departments.length === 0 && <option value="">Brak działów</option>}
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

const DRAFT_STORAGE_KEY = 'purchase_request_draft';

function saveDraft(items: RequestItem[]) {
  try {
    const serializable = items.map(item => ({ ...item, proformaFile: null }));
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(serializable));
  } catch {}
}

function loadDraft(): RequestItem[] | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RequestItem[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map(item => ({ ...item, proformaFile: null }));
  } catch {
    return null;
  }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch {}
}

interface PurchaseRequestFormProps {
  editRequestId?: string;
  onEditComplete?: () => void;
}

export function PurchaseRequestForm({ editRequestId, onEditComplete }: PurchaseRequestFormProps = {}) {
  const { user, profile } = useAuth();
  const isEditMode = !!editRequestId;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [defaultDepartmentId, setDefaultDepartmentId] = useState<string>('');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const departmentsLoadedRef = useRef(false);

  useEffect(() => {
    if (!departmentsLoadedRef.current) {
      loadDepartments();
    }
  }, [profile]);

  async function loadDepartments() {
    departmentsLoadedRef.current = true;
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

    if (isEditMode) {
      await loadEditData(resolvedDefault, depts);
    } else {
      const draft = loadDraft();
      if (draft) {
        setItems(draft);
      } else {
        setItems([createEmptyItem(resolvedDefault)]);
      }
    }
  }

  async function loadEditData(fallbackDeptId: string, depts: Department[]) {
    if (!editRequestId) return;
    setLoadingEdit(true);
    const { data, error: fetchError } = await supabase
      .from('purchase_requests')
      .select('*')
      .eq('id', editRequestId)
      .maybeSingle();

    setLoadingEdit(false);

    if (fetchError || !data) {
      setError('Nie udało się załadować danych wniosku.');
      return;
    }

    const deptId = data.department_id && depts.some(d => d.id === data.department_id)
      ? data.department_id
      : fallbackDeptId;

    const item: RequestItem = {
      id: data.id,
      isProforma: !!data.proforma_filename,
      proformaFile: null,
      proformaBase64: null,
      existingProformaFilename: data.proforma_filename || null,
      link: data.link || '',
      gross_amount: data.gross_amount > 0 ? String(data.gross_amount) : '',
      description: data.description || '',
      quantity: String(data.quantity || 1),
      delivery_location: (DELIVERY_LOCATIONS as readonly string[]).includes(data.delivery_location)
        ? data.delivery_location as DeliveryLocation
        : 'Botaniczna',
      priority: (['niski', 'normalny', 'wysoki', 'pilny'] as Priority[]).includes(data.priority)
        ? data.priority as Priority
        : 'normalny',
      department_id: deptId,
    };

    setItems([item]);
  }

  function handleChange(id: string, field: keyof RequestItem, value: string) {
    setItems(prev => {
      const updated = prev.map(item => item.id === id ? { ...item, [field]: value } : item);
      if (!isEditMode) saveDraft(updated);
      return updated;
    });
  }

  function handleProformaToggle(id: string) {
    setItems(prev => {
      const updated = prev.map(item =>
        item.id === id
          ? { ...item, isProforma: !item.isProforma, proformaFile: null, proformaBase64: null, existingProformaFilename: null, link: '', gross_amount: '', quantity: '1' }
          : item
      );
      if (!isEditMode) saveDraft(updated);
      return updated;
    });
  }

  async function handleProformaFile(id: string, file: File | null) {
    if (!file) {
      setItems(prev => {
        const updated = prev.map(item => item.id === id ? { ...item, proformaFile: null, proformaBase64: null } : item);
        if (!isEditMode) saveDraft(updated);
        return updated;
      });
      return;
    }
    const base64 = await fileToBase64(file);
    setItems(prev => {
      const updated = prev.map(item => item.id === id ? { ...item, proformaFile: file, proformaBase64: base64 } : item);
      if (!isEditMode) saveDraft(updated);
      return updated;
    });
  }

  function addItem() {
    setItems(prev => {
      const updated = [...prev, createEmptyItem(defaultDepartmentId)];
      if (!isEditMode) saveDraft(updated);
      return updated;
    });
  }

  function removeItem(id: string) {
    setItems(prev => {
      const updated = prev.filter(item => item.id !== id);
      if (!isEditMode) saveDraft(updated);
      return updated;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    for (const item of items) {
      if (item.isProforma) {
        if (!item.proformaFile && !item.existingProformaFilename) { setError('Dodaj plik PDF proformy w każdej pozycji proforma.'); return; }
        if (!item.description.trim()) { setError('Uzupełnij opis w każdej pozycji.'); return; }
      } else {
        if (!item.link.trim()) { setError('Uzupełnij link do zakupu w każdej pozycji.'); return; }
        if (!item.gross_amount || parseFloat(item.gross_amount) <= 0) { setError('Podaj kwotę brutto w każdej pozycji.'); return; }
        if (!item.description.trim()) { setError('Uzupełnij opis w każdej pozycji.'); return; }
        if (!item.quantity || parseInt(item.quantity) < 1) { setError('Ilość musi być co najmniej 1.'); return; }
      }
    }

    setSubmitting(true);
    setError(null);

    if (isEditMode) {
      const item = items[0];
      const updateData: Record<string, unknown> = {
        link: item.isProforma ? '' : item.link.trim(),
        gross_amount: item.isProforma ? (item.gross_amount ? parseFloat(item.gross_amount) : 0) : parseFloat(item.gross_amount),
        description: item.description.trim(),
        quantity: item.isProforma ? 1 : parseInt(item.quantity),
        delivery_location: item.delivery_location,
        priority: item.priority,
        department_id: item.department_id || null,
      };

      if (item.proformaFile && item.proformaBase64) {
        updateData.proforma_pdf_base64 = item.proformaBase64;
        updateData.proforma_filename = item.proformaFile.name;
      }

      const { error: updateError } = await supabase
        .from('purchase_requests')
        .update(updateData)
        .eq('id', editRequestId!)
        .eq('user_id', user.id);

      setSubmitting(false);

      if (updateError) {
        setError('Błąd podczas zapisywania zmian. Spróbuj ponownie.');
        return;
      }

      onEditComplete?.();
      return;
    }

    const rows = items.map(item => ({
      user_id: user.id,
      link: item.isProforma ? '' : item.link.trim(),
      gross_amount: item.isProforma ? 0 : parseFloat(item.gross_amount),
      description: item.description.trim(),
      quantity: item.isProforma ? 1 : parseInt(item.quantity),
      delivery_location: item.delivery_location,
      priority: item.priority,
      department_id: item.department_id || null,
      status: 'pending',
      proforma_pdf_base64: item.isProforma ? item.proformaBase64 : null,
      proforma_filename: item.isProforma ? item.proformaFile?.name : null,
    }));

    const { error: insertError } = await supabase.from('purchase_requests').insert(rows);

    setSubmitting(false);

    if (insertError) {
      setError('Błąd podczas wysyłania wniosku. Spróbuj ponownie.');
      return;
    }

    clearDraft();
    setSuccess(true);
    setItems([createEmptyItem(defaultDepartmentId)]);
    setTimeout(() => setSuccess(false), 5000);
  }

  const totalAmount = items.reduce((sum, item) => {
    if (item.isProforma) return sum;
    const amount = parseFloat(item.gross_amount || '0') * parseInt(item.quantity || '1');
    return sum + (isNaN(amount) ? 0 : amount);
  }, 0);

  if (loadingEdit || items.length === 0) {
    return (
      <div className="h-full bg-light-bg dark:bg-dark-bg flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-brand-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full bg-light-bg dark:bg-dark-bg overflow-y-auto">
      <div className="p-4">
        {isEditMode && (
          <button
            type="button"
            onClick={onEditComplete}
            className="group inline-flex items-center gap-1.5 text-sm text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Powrót do wniosku
          </button>
        )}

        <div className="mb-4">
          <h1 className="text-xl font-bold text-text-primary-light dark:text-text-primary-dark">
            {isEditMode ? 'Edytuj wniosek zakupowy' : 'Wniosek zakupowy'}
          </h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
            {isEditMode
              ? 'Wprowadź zmiany i zapisz wniosek.'
              : 'Wypełnij formularz i wyślij wniosek do akceptacji.'}
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
                onProformaToggle={handleProformaToggle}
                onProformaFile={handleProformaFile}
              />
            ))}
          </div>

          {!isEditMode && (
            <button
              type="button"
              onClick={addItem}
              className="mt-3 w-full py-2.5 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-text-secondary-light dark:text-text-secondary-dark hover:border-brand-primary hover:text-brand-primary dark:hover:border-brand-primary dark:hover:text-brand-primary transition-all flex items-center justify-center gap-2 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Dodaj kolejną pozycję
            </button>
          )}

          <div className="mt-4 bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Łączna kwota brutto</p>
              <p className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark">
                {totalAmount > 0
                  ? `${totalAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN`
                  : items.some(i => i.isProforma) ? 'Z proformy' : '0,00 PLN'
                }
              </p>
              {!isEditMode && (
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  {items.length} {items.length === 1 ? 'pozycja' : items.length < 5 ? 'pozycje' : 'pozycji'}
                  {items.some(i => i.isProforma) && (
                    <span className="ml-1 text-sky-500">· zawiera proformy</span>
                  )}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isEditMode && (
                <button
                  type="button"
                  onClick={onEditComplete}
                  disabled={submitting}
                  className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-text-secondary-light dark:text-text-secondary-dark hover:bg-light-surface-variant dark:hover:bg-dark-surface-variant text-sm font-semibold transition-all disabled:opacity-60"
                >
                  Anuluj
                </button>
              )}
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
                    {isEditMode ? 'Zapisywanie...' : 'Wysyłanie...'}
                  </span>
                ) : isEditMode ? (
                  <>
                    <Save className="w-4 h-4" />
                    Zapisz zmiany
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Wyślij wniosek
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
