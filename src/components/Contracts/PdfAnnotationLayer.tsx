import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, X, Send, Trash2, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

interface Annotation {
  id: string;
  contract_id: string;
  user_id: string;
  x_percent: number;
  y_percent: number;
  comment: string;
  color: string;
  created_at: string;
  profiles?: { full_name: string; email: string };
}

interface PendingPin {
  x_percent: number;
  y_percent: number;
}

interface PdfAnnotationLayerProps {
  contractId: string;
  pdfBase64: string;
}

const PIN_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  blue: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-blue-600' },
  green: { bg: 'bg-emerald-500', border: 'border-emerald-600', text: 'text-emerald-600' },
  orange: { bg: 'bg-amber-500', border: 'border-amber-600', text: 'text-amber-600' },
  red: { bg: 'bg-red-500', border: 'border-red-600', text: 'text-red-600' },
};

function getColorForUser(userId: string, allUserIds: string[]): string {
  const colors = Object.keys(PIN_COLORS);
  const idx = allUserIds.indexOf(userId);
  return colors[idx % colors.length];
}

export function PdfAnnotationLayer({ contractId, pdfBase64 }: PdfAnnotationLayerProps) {
  const { user } = useAuth();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pinMode, setPinMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const overlayRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadAnnotations();
  }, [contractId]);

  useEffect(() => {
    if (pendingPin && commentInputRef.current) {
      commentInputRef.current.focus();
    }
  }, [pendingPin]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPendingPin(null);
        setCommentInput('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadAnnotations = async () => {
    const { data, error } = await supabase
      .from('contract_pdf_annotations')
      .select('*, profiles:user_id(full_name, email)')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });

    if (!error && data) {
      setAnnotations(data);
    }
  };

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode || !overlayRef.current) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-pin]') || target.closest('[data-popup]')) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x_percent = ((e.clientX - rect.left) / rect.width) * 100;
    const y_percent = ((e.clientY - rect.top) / rect.height) * 100;

    setPendingPin({ x_percent, y_percent });
    setCommentInput('');
    setActiveAnnotationId(null);
  }, [pinMode]);

  const handleSaveAnnotation = async () => {
    if (!user || !pendingPin || !commentInput.trim()) return;

    try {
      setSubmitting(true);
      const allUserIds = [...new Set(annotations.map(a => a.user_id))];
      if (!allUserIds.includes(user.id)) allUserIds.push(user.id);
      const color = getColorForUser(user.id, allUserIds);

      const { error } = await supabase
        .from('contract_pdf_annotations')
        .insert({
          contract_id: contractId,
          user_id: user.id,
          x_percent: pendingPin.x_percent,
          y_percent: pendingPin.y_percent,
          comment: commentInput.trim(),
          color,
        });

      if (error) throw error;

      setPendingPin(null);
      setCommentInput('');
      await loadAnnotations();
    } catch (err) {
      console.error('Error saving annotation:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAnnotation = async (id: string) => {
    const { error } = await supabase
      .from('contract_pdf_annotations')
      .delete()
      .eq('id', id);

    if (!error) {
      setAnnotations(prev => prev.filter(a => a.id !== id));
      if (activeAnnotationId === id) setActiveAnnotationId(null);
    }
  };

  const allUserIds = [...new Set(annotations.map(a => a.user_id))];

  const getPopupPosition = (xPct: number, yPct: number) => {
    const left = xPct > 65 ? 'right' : xPct < 35 ? 'left' : 'center';
    const top = yPct > 70 ? 'above' : 'below';
    return { left, top };
  };

  return (
    <div className="relative w-full h-full">
      <iframe
        src={`data:application/pdf;base64,${pdfBase64}`}
        className="w-full h-full"
        title="Podglad PDF"
        style={{ pointerEvents: pinMode ? 'none' : 'auto' }}
      />

      <div
        ref={overlayRef}
        className={`absolute inset-0 ${pinMode ? 'cursor-crosshair' : 'pointer-events-none'}`}
        onClick={handleOverlayClick}
      >
        {annotations.map((ann, idx) => {
          const color = PIN_COLORS[ann.color] || PIN_COLORS.blue;
          const isActive = activeAnnotationId === ann.id;
          const pos = getPopupPosition(ann.x_percent, ann.y_percent);

          return (
            <div
              key={ann.id}
              data-pin
              className="absolute pointer-events-auto"
              style={{
                left: `${ann.x_percent}%`,
                top: `${ann.y_percent}%`,
                transform: 'translate(-50%, -100%)',
                zIndex: isActive ? 20 : 10,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveAnnotationId(isActive ? null : ann.id);
                  setPendingPin(null);
                }}
                className={`group relative flex items-center justify-center transition-all duration-200 ${
                  isActive ? 'scale-125' : 'hover:scale-110'
                }`}
              >
                <MapPin
                  className={`w-7 h-7 drop-shadow-md ${color.bg.replace('bg-', 'text-')} ${
                    isActive ? 'animate-bounce' : ''
                  }`}
                  fill="currentColor"
                  strokeWidth={1.5}
                  stroke="white"
                />
                <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-white">
                  {idx + 1}
                </span>
              </button>

              {isActive && (
                <div
                  data-popup
                  className={`absolute z-30 w-64 bg-white dark:bg-dark-surface rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden ${
                    pos.top === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'
                  } ${
                    pos.left === 'right' ? 'right-0' : pos.left === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-3 py-2 bg-slate-50 dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                      {ann.profiles?.full_name || 'Uzytkownik'}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                        {new Date(ann.created_at).toLocaleString('pl-PL', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {user?.id === ann.user_id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAnnotation(ann.id);
                          }}
                          className="p-0.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500 transition-colors ml-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-sm text-text-primary-light dark:text-text-primary-dark whitespace-pre-wrap leading-relaxed">
                      {ann.comment}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {pendingPin && (
          <div
            className="absolute pointer-events-auto"
            style={{
              left: `${pendingPin.x_percent}%`,
              top: `${pendingPin.y_percent}%`,
              transform: 'translate(-50%, -100%)',
              zIndex: 30,
            }}
          >
            <MapPin
              className="w-7 h-7 text-blue-500 drop-shadow-md animate-bounce"
              fill="currentColor"
              strokeWidth={1.5}
              stroke="white"
            />

            <div
              ref={popupRef}
              data-popup
              className={`absolute z-40 w-72 bg-white dark:bg-dark-surface rounded-xl shadow-2xl border border-blue-300 dark:border-blue-700 overflow-hidden ${
                pendingPin.y_percent > 70 ? 'bottom-full mb-2' : 'top-full mt-2'
              } ${
                pendingPin.x_percent > 65 ? 'right-0' : pendingPin.x_percent < 35 ? 'left-0' : 'left-1/2 -translate-x-1/2'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800/30 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs font-semibold text-blue-900 dark:text-blue-200">
                    Nowa adnotacja
                  </span>
                </div>
                <button
                  onClick={() => {
                    setPendingPin(null);
                    setCommentInput('');
                  }}
                  className="p-0.5 hover:bg-blue-100 dark:hover:bg-blue-800/30 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-blue-600" />
                </button>
              </div>
              <div className="p-3 space-y-2">
                <textarea
                  ref={commentInputRef}
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark text-sm resize-none"
                  placeholder="Wpisz komentarz..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSaveAnnotation();
                    }
                  }}
                />
                <button
                  onClick={handleSaveAnnotation}
                  disabled={submitting || !commentInput.trim()}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 text-xs font-medium"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? 'Zapisywanie...' : 'Dodaj adnotacje'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="absolute top-3 left-3 z-20 flex items-center gap-2 pointer-events-auto">
        <button
          onClick={() => {
            setPinMode(!pinMode);
            setPendingPin(null);
            setCommentInput('');
            setActiveAnnotationId(null);
          }}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium shadow-lg backdrop-blur-sm transition-all duration-200 border ${
            pinMode
              ? 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700'
              : 'bg-white/90 dark:bg-dark-surface/90 text-text-primary-light dark:text-text-primary-dark border-slate-200/80 dark:border-slate-700/50 hover:bg-white dark:hover:bg-dark-surface'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" />
          {pinMode ? 'Kliknij na PDF...' : 'Dodaj adnotacje'}
        </button>

        {pinMode && (
          <button
            onClick={() => {
              setPinMode(false);
              setPendingPin(null);
              setCommentInput('');
            }}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-medium shadow-lg backdrop-blur-sm bg-white/90 dark:bg-dark-surface/90 text-text-secondary-light dark:text-text-secondary-dark border border-slate-200/80 dark:border-slate-700/50 hover:bg-white dark:hover:bg-dark-surface transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Anuluj
          </button>
        )}
      </div>

      {annotations.length > 0 && (
        <div className="absolute bottom-3 left-3 right-3 z-20 pointer-events-auto">
          <div className="bg-white/95 dark:bg-dark-surface/95 backdrop-blur-sm rounded-xl shadow-xl border border-slate-200/80 dark:border-slate-700/50 overflow-hidden">
            <button
              onClick={() => setPanelOpen(!panelOpen)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-dark-surface-variant transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                <span className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                  Adnotacje ({annotations.length})
                </span>
              </div>
              {panelOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark" />
              )}
            </button>

            {panelOpen && (
              <div className="max-h-40 overflow-y-auto border-t border-slate-200/80 dark:border-slate-700/50">
                {annotations.map((ann, idx) => {
                  const colorKey = ann.color || getColorForUser(ann.user_id, allUserIds);
                  const colors = PIN_COLORS[colorKey] || PIN_COLORS.blue;
                  const isActive = activeAnnotationId === ann.id;

                  return (
                    <div
                      key={ann.id}
                      className={`flex items-start gap-2 px-3 py-2 cursor-pointer transition-colors border-b border-slate-100 dark:border-slate-800 last:border-b-0 ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-slate-50 dark:hover:bg-dark-surface-variant'
                      }`}
                      onClick={() => setActiveAnnotationId(isActive ? null : ann.id)}
                    >
                      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                        <MapPin className={`w-3.5 h-3.5 ${colors.text}`} fill="currentColor" strokeWidth={0} />
                        <span className="text-[10px] font-bold text-text-secondary-light dark:text-text-secondary-dark w-3 text-center">
                          {idx + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark truncate">
                            {ann.profiles?.full_name || 'Uzytkownik'}
                          </span>
                          <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0">
                            {new Date(ann.created_at).toLocaleString('pl-PL', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark line-clamp-1 mt-0.5">
                          {ann.comment}
                        </p>
                      </div>
                      {user?.id === ann.user_id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAnnotation(ann.id);
                          }}
                          className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-400 hover:text-red-600 transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
