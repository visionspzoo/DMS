import { useState, useEffect } from 'react';
import { Tag, Plus, X, Brain, Check, Loader, XCircle, Sparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface TagType {
  id: string;
  name: string;
  color: string;
}

interface InvoiceTag {
  id: string;
  tag_id: string;
  tags: TagType;
}

interface MLPrediction {
  id: string;
  tag_id: string;
  confidence: number;
  source: string;
  reasoning: string;
  tags: TagType;
}

interface InvoiceTagsProps {
  invoiceId: string;
  isEditing: boolean;
  supplierName?: string | null;
  supplierNip?: string | null;
  description?: string | null;
  grossAmount?: number | null;
  currency?: string | null;
  departmentId?: string | null;
}

function confidenceColor(c: number) {
  if (c >= 0.9) return { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-800' };
  if (c >= 0.7) return { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-800' };
  return { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-800' };
}

export function InvoiceTags({ invoiceId, isEditing, supplierName, supplierNip, description, grossAmount, currency, departmentId }: InvoiceTagsProps) {
  const [invoiceTags, setInvoiceTags] = useState<InvoiceTag[]>([]);
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<TagType[]>([]);
  const [mlPredictions, setMlPredictions] = useState<MLPrediction[]>([]);
  const [loadingPredictions, setLoadingPredictions] = useState(false);
  const [mlError, setMlError] = useState(false);

  useEffect(() => {
    loadInvoiceTags();
    loadAllTags();
  }, [invoiceId]);

  useEffect(() => {
    if (supplierName || supplierNip) {
      loadMLPredictions();
    }
  }, [invoiceId, supplierName, supplierNip]);

  useEffect(() => {
    if (newTagName.trim().length > 0) {
      filterSuggestedTags(newTagName);
    } else {
      setSuggestedTags([]);
    }
  }, [newTagName, allTags, invoiceTags]);

  const loadInvoiceTags = async () => {
    try {
      const { data, error } = await supabase
        .from('invoice_tags')
        .select('id, tag_id, tags(id, name, color)')
        .eq('invoice_id', invoiceId);

      if (error) throw error;
      setInvoiceTags(data || []);
    } catch (error) {
      console.error('Error loading invoice tags:', error);
    }
  };

  const loadAllTags = async () => {
    try {
      const { data, error } = await supabase
        .from('tags')
        .select('*')
        .order('name');

      if (error) throw error;
      setAllTags(data || []);
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  };

  const loadMLPredictions = async () => {
    setLoadingPredictions(true);
    setMlError(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ml-predict-tags`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            invoice_id: invoiceId,
            supplier_name: supplierName,
            supplier_nip: supplierNip,
            description,
            gross_amount: grossAmount,
            currency,
            department_id: departmentId,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setMlPredictions(
          (data.predictions || []).filter((p: MLPrediction) => p.tags)
        );
      } else {
        setMlError(true);
      }
    } catch (error) {
      console.error('Error loading ML predictions:', error);
      setMlError(true);
    } finally {
      setLoadingPredictions(false);
    }
  };

  const filterSuggestedTags = (searchText: string) => {
    const search = searchText.toLowerCase();
    const available = allTags.filter(
      tag => !invoiceTags.some(it => it.tags.id === tag.id)
    );
    const filtered = available.filter(tag =>
      tag.name.toLowerCase().includes(search)
    );
    setSuggestedTags(filtered.slice(0, 5));
  };

  const addTag = async (tagId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('invoice_tags')
        .insert({ invoice_id: invoiceId, tag_id: tagId });
      if (error) throw error;
      await loadInvoiceTags();
      setNewTagName('');
      setSuggestedTags([]);
    } catch (error) {
      console.error('Error adding tag:', error);
    } finally {
      setLoading(false);
    }
  };

  const removeTag = async (invoiceTagId: string) => {
    if (loading) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('invoice_tags')
        .delete()
        .eq('id', invoiceTagId);
      if (error) throw error;
      await loadInvoiceTags();
    } catch (error) {
      console.error('Error removing tag:', error);
    } finally {
      setLoading(false);
    }
  };

  const createNewTag = async () => {
    if (!newTagName.trim() || loading) return;
    setLoading(true);
    try {
      const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#EC4899', '#6366F1', '#14B8A6', '#F97316'];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      const { data, error } = await supabase
        .from('tags')
        .insert({ name: newTagName.trim(), color: randomColor })
        .select()
        .single();

      if (error) throw error;
      await loadAllTags();
      if (data) await addTag(data.id);
    } catch (error: any) {
      console.error('Error creating tag:', error);
      if (error.code === '23505') {
        alert('Tag o tej nazwie juz istnieje');
      }
    } finally {
      setLoading(false);
    }
  };

  const applyPrediction = async (prediction: MLPrediction) => {
    await addTag(prediction.tags.id);
    setMlPredictions(prev => prev.filter(p => p.id !== prediction.id));
    await supabase
      .from('ml_tag_predictions')
      .update({ applied: true })
      .eq('id', prediction.id);
  };

  const dismissPrediction = async (prediction: MLPrediction) => {
    setMlPredictions(prev => prev.filter(p => p.id !== prediction.id));
    await supabase
      .from('ml_tag_predictions')
      .update({ dismissed: true })
      .eq('id', prediction.id);
  };

  const applyAllPredictions = async () => {
    for (const prediction of mlPredictions) {
      await addTag(prediction.tags.id);
      await supabase
        .from('ml_tag_predictions')
        .update({ applied: true })
        .eq('id', prediction.id);
    }
    setMlPredictions([]);
  };

  const filteredPredictions = mlPredictions.filter(
    p => p.tags && !invoiceTags.some(it => it.tags.id === p.tags.id)
  );

  return (
    <div className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark flex items-center gap-2">
          <Tag className="w-5 h-5" />
          Tagi
        </h3>
        {isEditing && (
          <button
            onClick={() => setShowTagSelector(!showTagSelector)}
            className="p-1.5 text-brand-primary hover:bg-brand-primary/10 rounded-lg transition-colors"
            title="Dodaj tag"
          >
            <Plus className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {invoiceTags.length === 0 && !showTagSelector && filteredPredictions.length === 0 && (
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Brak tagow
          </p>
        )}
        {invoiceTags.map((invoiceTag) => (
          <div
            key={invoiceTag.id}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
            style={{
              backgroundColor: `${invoiceTag.tags.color}20`,
              color: invoiceTag.tags.color,
              border: `1px solid ${invoiceTag.tags.color}40`,
            }}
          >
            <span>{invoiceTag.tags.name}</span>
            {isEditing && (
              <button
                onClick={() => removeTag(invoiceTag.id)}
                disabled={loading}
                className="hover:bg-black/10 rounded-full p-0.5 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      {(filteredPredictions.length > 0 || loadingPredictions) && (
        <div className="mt-4 p-4 bg-gradient-to-br from-blue-50/80 to-teal-50/50 dark:from-blue-900/10 dark:to-teal-900/10 rounded-lg border border-blue-100 dark:border-blue-800/30">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center">
                <Brain className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                Sugestie AI
              </span>
              {loadingPredictions && (
                <Loader className="w-3.5 h-3.5 animate-spin text-blue-500" />
              )}
            </div>
            {filteredPredictions.length > 1 && isEditing && (
              <button
                onClick={applyAllPredictions}
                disabled={loading}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/20 rounded transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                Zastosuj wszystkie
              </button>
            )}
          </div>

          {loadingPredictions && filteredPredictions.length === 0 ? (
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Analizuje wzorce tagowania...
            </p>
          ) : (
            <div className="space-y-2">
              {filteredPredictions.map((pred) => {
                const colors = confidenceColor(pred.confidence);
                return (
                  <div
                    key={pred.id}
                    className={`flex items-center gap-2 p-2 rounded-lg ${colors.bg} border ${colors.border}`}
                  >
                    <div
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0"
                      style={{
                        backgroundColor: `${pred.tags.color}20`,
                        color: pred.tags.color,
                        border: `1px solid ${pred.tags.color}40`,
                      }}
                    >
                      {pred.tags.name}
                    </div>
                    <span className={`text-xs font-bold ${colors.text} flex-shrink-0`}>
                      {Math.round(pred.confidence * 100)}%
                    </span>
                    <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark truncate flex-1">
                      {pred.reasoning}
                    </span>
                    {isEditing && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => applyPrediction(pred)}
                          disabled={loading}
                          className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900/20 rounded transition-colors"
                          title="Zastosuj"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        </button>
                        <button
                          onClick={() => dismissPrediction(pred)}
                          disabled={loading}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Odrzuc"
                        >
                          <XCircle className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-2 opacity-70">
            Na podstawie historii tagowania i analizy Claude AI
          </p>
        </div>
      )}

      {showTagSelector && isEditing && (
        <div className="mt-4 p-4 bg-white dark:bg-dark-surface rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="relative">
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
              Dodaj tag
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (suggestedTags.length === 0 ? createNewTag() : addTag(suggestedTags[0].id))}
                placeholder="Wpisz nazwe tagu..."
                className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                autoFocus
              />
              <button
                onClick={createNewTag}
                disabled={!newTagName.trim() || loading}
                className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
              >
                Utworz nowy
              </button>
            </div>

            {suggestedTags.length > 0 && (
              <div className="mt-3 p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-2">
                  Pasujace tagi:
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => addTag(tag.id)}
                      disabled={loading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-50"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                        border: `1px solid ${tag.color}40`,
                      }}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {newTagName.trim() && suggestedTags.length === 0 && (
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-2">
                Nie znaleziono pasujacych tagow. Kliknij "Utworz nowy" lub nacisnij Enter.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
