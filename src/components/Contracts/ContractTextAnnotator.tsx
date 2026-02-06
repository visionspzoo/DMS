import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, X, Send, Trash2, Highlighter } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface Annotation {
  id: string;
  contract_id: string;
  user_id: string;
  comment: string;
  highlighted_text: string;
  position_data: { start_offset: number; end_offset: number };
  comment_type: string;
  created_at: string;
  profiles?: { full_name: string; email: string };
}

interface SelectionPopup {
  x: number;
  y: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

interface ContractTextAnnotatorProps {
  contractId: string;
  text: string;
  onAnnotationCountChange?: (count: number) => void;
}

const HIGHLIGHT_COLORS = [
  { bg: 'rgba(250, 204, 21, 0.35)', border: 'rgb(202, 138, 4)', active: 'rgba(250, 204, 21, 0.55)' },
  { bg: 'rgba(52, 211, 153, 0.3)', border: 'rgb(5, 150, 105)', active: 'rgba(52, 211, 153, 0.5)' },
  { bg: 'rgba(96, 165, 250, 0.3)', border: 'rgb(37, 99, 235)', active: 'rgba(96, 165, 250, 0.5)' },
  { bg: 'rgba(251, 146, 60, 0.3)', border: 'rgb(234, 88, 12)', active: 'rgba(251, 146, 60, 0.5)' },
  { bg: 'rgba(244, 114, 182, 0.3)', border: 'rgb(219, 39, 119)', active: 'rgba(244, 114, 182, 0.5)' },
  { bg: 'rgba(167, 139, 250, 0.3)', border: 'rgb(124, 58, 237)', active: 'rgba(167, 139, 250, 0.5)' },
];

function getUserColor(userId: string, allUserIds: string[]) {
  const idx = allUserIds.indexOf(userId);
  return HIGHLIGHT_COLORS[idx % HIGHLIGHT_COLORS.length];
}

export function ContractTextAnnotator({ contractId, text, onAnnotationCountChange }: ContractTextAnnotatorProps) {
  const { user } = useAuth();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopup | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const annotationRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    loadAnnotations();
  }, [contractId]);

  useEffect(() => {
    onAnnotationCountChange?.(annotations.length);
  }, [annotations.length, onAnnotationCountChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setSelectionPopup(null);
        setCommentInput('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadAnnotations = async () => {
    const { data, error } = await supabase
      .from('contract_comments')
      .select('*, profiles(full_name, email)')
      .eq('contract_id', contractId)
      .eq('comment_type', 'contextual')
      .not('position_data', 'is', null)
      .order('created_at', { ascending: true });

    if (!error && data) {
      const valid = data.filter(
        (a: any) =>
          a.position_data?.start_offset !== undefined &&
          a.position_data?.end_offset !== undefined
      );
      setAnnotations(valid as Annotation[]);
    }
  };

  const getTextOffset = useCallback(
    (node: Node, offset: number): number | null => {
      const container = textContainerRef.current;
      if (!container) return null;

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let charCount = 0;

      while (walker.nextNode()) {
        const current = walker.currentNode;
        if (current === node) {
          return charCount + offset;
        }
        charCount += (current.textContent?.length || 0);
      }
      return null;
    },
    []
  );

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      return;
    }

    const range = selection.getRangeAt(0);
    const container = textContainerRef.current;
    if (!container || !container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      return;
    }

    const selectedText = selection.toString().trim();
    if (selectedText.length < 3) return;

    const startOffset = getTextOffset(range.startContainer, range.startOffset);
    const endOffset = getTextOffset(range.endContainer, range.endOffset);

    if (startOffset === null || endOffset === null) return;

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setSelectionPopup({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
      text: selectedText,
      startOffset: Math.min(startOffset, endOffset),
      endOffset: Math.max(startOffset, endOffset),
    });
  }, [getTextOffset]);

  const handleAddAnnotation = async () => {
    if (!user || !selectionPopup || !commentInput.trim()) return;

    try {
      setSubmitting(true);
      const { error } = await supabase.from('contract_comments').insert({
        contract_id: contractId,
        user_id: user.id,
        comment: commentInput.trim(),
        highlighted_text: selectionPopup.text,
        comment_type: 'contextual',
        position_data: {
          start_offset: selectionPopup.startOffset,
          end_offset: selectionPopup.endOffset,
        },
      });

      if (error) throw error;

      setSelectionPopup(null);
      setCommentInput('');
      window.getSelection()?.removeAllRanges();
      await loadAnnotations();
    } catch (err) {
      console.error('Error adding annotation:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAnnotation = async (id: string) => {
    if (!confirm('Usunac ten komentarz?')) return;
    const { error } = await supabase.from('contract_comments').delete().eq('id', id);
    if (!error) {
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      if (activeAnnotationId === id) setActiveAnnotationId(null);
    }
  };

  const scrollToAnnotation = (id: string) => {
    setActiveAnnotationId(id);
    const el = annotationRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const allUserIds = [...new Set(annotations.map((a) => a.user_id))];

  const renderAnnotatedText = () => {
    if (!text) return null;

    const sorted = [...annotations].sort(
      (a, b) => a.position_data.start_offset - b.position_data.start_offset
    );

    const segments: Array<{ text: string; annotations: Annotation[] }> = [];
    let pos = 0;

    const events: Array<{ offset: number; type: 'start' | 'end'; annotation: Annotation }> = [];
    for (const ann of sorted) {
      const start = Math.max(0, Math.min(ann.position_data.start_offset, text.length));
      const end = Math.max(start, Math.min(ann.position_data.end_offset, text.length));
      events.push({ offset: start, type: 'start', annotation: ann });
      events.push({ offset: end, type: 'end', annotation: ann });
    }
    events.sort((a, b) => a.offset - b.offset || (a.type === 'end' ? -1 : 1));

    const activeAnns = new Set<Annotation>();
    let lastOffset = 0;

    for (const event of events) {
      if (event.offset > lastOffset) {
        const segText = text.slice(lastOffset, event.offset);
        if (segText) {
          segments.push({ text: segText, annotations: [...activeAnns] });
        }
      }
      if (event.type === 'start') {
        activeAnns.add(event.annotation);
      } else {
        activeAnns.delete(event.annotation);
      }
      lastOffset = event.offset;
    }

    if (lastOffset < text.length) {
      segments.push({ text: text.slice(lastOffset), annotations: [] });
    }

    return segments.map((seg, i) => {
      if (seg.annotations.length === 0) {
        return <span key={i}>{seg.text}</span>;
      }

      const primary = seg.annotations[0];
      const color = getUserColor(primary.user_id, allUserIds);
      const isActive = seg.annotations.some((a) => a.id === activeAnnotationId);

      return (
        <mark
          key={i}
          ref={(el) => {
            if (el) {
              for (const ann of seg.annotations) {
                if (!annotationRefs.current[ann.id]) {
                  annotationRefs.current[ann.id] = el;
                }
              }
            }
          }}
          className="cursor-pointer rounded-sm px-0 transition-all duration-200 relative group/mark"
          style={{
            backgroundColor: isActive ? color.active : color.bg,
            borderBottom: `2px solid ${color.border}`,
            boxShadow: isActive ? `0 0 0 2px ${color.border}40` : 'none',
          }}
          onClick={() => scrollToAnnotation(primary.id)}
          title={`${primary.profiles?.full_name || 'Uzytkownik'}: ${primary.comment}`}
        >
          {seg.text}
          <span className="invisible group-hover/mark:visible absolute left-1/2 -translate-x-1/2 -top-8 bg-slate-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-20 pointer-events-none">
            {primary.profiles?.full_name || 'Uzytkownik'}: {primary.comment.substring(0, 40)}
            {primary.comment.length > 40 ? '...' : ''}
          </span>
        </mark>
      );
    });
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/30 flex items-center gap-2 flex-shrink-0">
          <Highlighter className="w-4 h-4 text-amber-600" />
          <span className="text-xs text-amber-800 dark:text-amber-300">
            Zaznacz tekst, aby dodac komentarz do wybranego fragmentu
          </span>
        </div>

        <div
          className="flex-1 overflow-y-auto relative"
          ref={textContainerRef}
          onMouseUp={handleMouseUp}
        >
          <div className="p-6 text-sm leading-7 text-text-primary-light dark:text-text-primary-dark whitespace-pre-wrap font-sans selection:bg-blue-200 dark:selection:bg-blue-800/50">
            {renderAnnotatedText()}
          </div>

          {selectionPopup && (
            <div
              ref={popupRef}
              className="absolute z-30 animate-in fade-in slide-in-from-bottom-2"
              style={{
                left: `${Math.max(16, Math.min(selectionPopup.x - 160, (textContainerRef.current?.clientWidth || 400) - 336))}px`,
                top: `${selectionPopup.y - 4}px`,
                transform: 'translateY(-100%)',
              }}
            >
              <div className="bg-white dark:bg-dark-surface border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-80 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-brand-primary" />
                    <span className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Komentarz do zaznaczenia
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setSelectionPopup(null);
                      setCommentInput('');
                    }}
                    className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-600 rounded transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
                  </button>
                </div>

                <div className="p-3 space-y-2.5">
                  <div className="px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-lg">
                    <p className="text-xs text-amber-900 dark:text-amber-200 italic line-clamp-2">
                      &ldquo;{selectionPopup.text.substring(0, 120)}
                      {selectionPopup.text.length > 120 ? '...' : ''}&rdquo;
                    </p>
                  </div>

                  <textarea
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-brand-primary focus:border-transparent bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm resize-none"
                    placeholder="Wpisz komentarz..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAddAnnotation();
                      }
                    }}
                  />

                  <button
                    onClick={handleAddAnnotation}
                    disabled={submitting || !commentInput.trim()}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-brand-primary text-white hover:bg-brand-primary-hover rounded-lg transition-colors disabled:opacity-50 text-xs font-medium"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {submitting ? 'Dodawanie...' : 'Dodaj komentarz'}
                  </button>
                </div>
              </div>
              <div
                className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-3 h-3 rotate-45 bg-white dark:bg-dark-surface border-r border-b border-slate-200 dark:border-slate-700"
              />
            </div>
          )}
        </div>
      </div>

      <div className="w-72 border-l border-slate-200 dark:border-slate-700/50 flex flex-col bg-white dark:bg-dark-surface flex-shrink-0">
        <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-dark-surface-variant">
          <h4 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
            Adnotacje ({annotations.length})
          </h4>
        </div>

        <div className="flex-1 overflow-y-auto">
          {annotations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-dark-surface-variant flex items-center justify-center mb-3">
                <Highlighter className="w-5 h-5 text-slate-400" />
              </div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Zaznacz fragment tekstu, aby dodac adnotacje
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-1.5">
              {annotations.map((ann) => {
                const color = getUserColor(ann.user_id, allUserIds);
                const isActive = activeAnnotationId === ann.id;

                return (
                  <div
                    key={ann.id}
                    className={`rounded-lg p-2.5 cursor-pointer transition-all duration-200 border ${
                      isActive
                        ? 'border-brand-primary bg-blue-50 dark:bg-blue-900/20 shadow-sm'
                        : 'border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-dark-surface-variant'
                    }`}
                    onClick={() => scrollToAnnotation(ann.id)}
                  >
                    <div className="flex items-start justify-between gap-1.5 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: color.border }}
                        />
                        <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                          {ann.profiles?.full_name || 'Uzytkownik'}
                        </span>
                      </div>
                      {user?.id === ann.user_id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAnnotation(ann.id);
                          }}
                          className="p-0.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                          style={{ opacity: isActive ? 1 : undefined }}
                          title="Usun"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div
                      className="mb-1.5 px-2 py-1 rounded text-xs italic border-l-2"
                      style={{
                        backgroundColor: `${color.bg}`,
                        borderLeftColor: color.border,
                      }}
                    >
                      <span className="text-text-secondary-light dark:text-text-secondary-dark line-clamp-2">
                        &ldquo;{ann.highlighted_text}&rdquo;
                      </span>
                    </div>

                    <p className="text-xs text-text-primary-light dark:text-text-primary-dark leading-relaxed">
                      {ann.comment}
                    </p>

                    <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-1 block">
                      {new Date(ann.created_at).toLocaleString('pl-PL', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
