import { useState, useEffect } from 'react';
import { Tag, Plus, X } from 'lucide-react';
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

interface InvoiceTagsProps {
  invoiceId: string;
  isEditing: boolean;
}

export function InvoiceTags({ invoiceId, isEditing }: InvoiceTagsProps) {
  const [invoiceTags, setInvoiceTags] = useState<InvoiceTag[]>([]);
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestedTags, setSuggestedTags] = useState<TagType[]>([]);

  useEffect(() => {
    loadInvoiceTags();
    loadAllTags();
  }, [invoiceId]);

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
      const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6366F1'];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      const { data, error } = await supabase
        .from('tags')
        .insert({ name: newTagName.trim(), color: randomColor })
        .select()
        .single();

      if (error) throw error;

      await loadAllTags();
      if (data) {
        await addTag(data.id);
      }
    } catch (error: any) {
      console.error('Error creating tag:', error);
      if (error.code === '23505') {
        alert('Tag o tej nazwie już istnieje');
      }
    } finally {
      setLoading(false);
    }
  };

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
        {invoiceTags.length === 0 && !showTagSelector && (
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Brak tagów
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
                placeholder="Wpisz nazwę tagu..."
                className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
                autoFocus
              />
              <button
                onClick={createNewTag}
                disabled={!newTagName.trim() || loading}
                className="px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
              >
                Utwórz nowy
              </button>
            </div>

            {suggestedTags.length > 0 && (
              <div className="mt-3 p-3 bg-light-surface-variant dark:bg-dark-surface-variant rounded-lg border border-slate-200 dark:border-slate-700">
                <div className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-2">
                  Sugerowane tagi:
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
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-2">
                  Kliknij aby dodać lub naciśnij Enter dla pierwszego tagu
                </p>
              </div>
            )}

            {newTagName.trim() && suggestedTags.length === 0 && (
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-2">
                Nie znaleziono pasujących tagów. Kliknij "Utwórz nowy" lub naciśnij Enter.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
