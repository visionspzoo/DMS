import { useRef, useCallback, useEffect, useState } from 'react';
import { MapPin, X, Send, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

export interface PdfAnnotation {
  id: string;
  contract_id: string;
  user_id: string;
  page_number: number;
  x_percent: number;
  y_percent: number;
  comment: string;
  color: string;
  created_at: string;
  profiles?: { full_name: string; email: string };
}

export interface PendingPin {
  page_number: number;
  x_percent: number;
  y_percent: number;
}

export const PIN_COLORS: Record<string, { text: string }> = {
  blue: { text: 'text-blue-500' },
  green: { text: 'text-emerald-500' },
  orange: { text: 'text-amber-500' },
  red: { text: 'text-red-500' },
};

interface RenderedPage {
  pageNumber: number;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

interface PdfAnnotationLayerProps {
  pdfBase64: string;
  annotations: PdfAnnotation[];
  pinMode: boolean;
  pendingPin: PendingPin | null;
  activeAnnotationId: string | null;
  commentInput: string;
  submitting: boolean;
  onOverlayClick: (page: number, x: number, y: number) => void;
  onPinClick: (id: string) => void;
  onCommentChange: (value: string) => void;
  onSaveAnnotation: () => void;
  onCancelPending: () => void;
}

const SCALE_STEPS = [0.6, 0.75, 1.0, 1.25, 1.5, 2.0];

export function PdfAnnotationLayer({
  pdfBase64,
  annotations,
  pinMode,
  pendingPin,
  activeAnnotationId,
  commentInput,
  submitting,
  onOverlayClick,
  onPinClick,
  onCommentChange,
  onSaveAnnotation,
  onCancelPending,
}: PdfAnnotationLayerProps) {
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [pdfLoading, setPdfLoading] = useState(true);
  const [scaleIdx, setScaleIdx] = useState(2);
  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  useEffect(() => {
    if (pendingPin && inputRef.current) {
      inputRef.current.focus();
    }
  }, [pendingPin]);

  useEffect(() => {
    if (!activeAnnotationId || !containerRef.current) return;
    const ann = annotations.find(a => a.id === activeAnnotationId);
    if (!ann) return;
    const pageEl = pageRefs.current.get(ann.page_number);
    if (!pageEl) return;

    const pinY = (ann.y_percent / 100) * pageEl.offsetHeight;
    const pinX = (ann.x_percent / 100) * pageEl.offsetWidth;
    const containerRect = containerRef.current.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();

    const scrollTop = containerRef.current.scrollTop + (pageRect.top - containerRect.top) + pinY - containerRef.current.clientHeight / 2;
    const scrollLeft = containerRef.current.scrollLeft + (pageRect.left - containerRect.left) + pinX - containerRef.current.clientWidth / 2;

    containerRef.current.scrollTo({
      top: Math.max(0, scrollTop),
      left: Math.max(0, scrollLeft),
      behavior: 'smooth',
    });
  }, [activeAnnotationId, annotations]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onCancelPending();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCancelPending]);

  useEffect(() => {
    loadPdf();
    return () => {
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [pdfBase64]);

  useEffect(() => {
    if (pdfDocRef.current) {
      renderAllPages(pdfDocRef.current, SCALE_STEPS[scaleIdx]);
    }
  }, [scaleIdx]);

  const loadPdf = async () => {
    setPdfLoading(true);
    try {
      const binary = atob(pdfBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      pdfDocRef.current = doc;
      await renderAllPages(doc, SCALE_STEPS[scaleIdx]);
    } catch (err) {
      console.error('Error loading PDF:', err);
    } finally {
      setPdfLoading(false);
    }
  };

  const renderAllPages = async (doc: pdfjsLib.PDFDocumentProxy, scale: number) => {
    const rendered: RenderedPage[] = [];
    const dpr = window.devicePixelRatio || 1;

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: scale * dpr });
      const displayViewport = page.getViewport({ scale });

      let canvas = canvasRefs.current.get(i);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvasRefs.current.set(i, canvas);
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${displayViewport.width}px`;
      canvas.style.height = `${displayViewport.height}px`;

      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      rendered.push({
        pageNumber: i,
        canvas,
        width: displayViewport.width,
        height: displayViewport.height,
      });
    }
    setPages(rendered);
  };

  const handlePageClick = useCallback((pageNumber: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-pin]') || target.closest('[data-popup]')) return;

    const pageEl = pageRefs.current.get(pageNumber);
    if (!pageEl) return;

    const rect = pageEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onOverlayClick(pageNumber, x, y);
  }, [pinMode, onOverlayClick]);

  const annotationIndex = (ann: PdfAnnotation) => {
    return annotations.findIndex(a => a.id === ann.id);
  };

  const popupPos = (xPct: number, yPct: number) => {
    const h = xPct > 65 ? 'right-0' : xPct < 35 ? 'left-0' : 'left-1/2 -translate-x-1/2';
    const v = yPct > 70 ? 'bottom-full mb-2' : 'top-full mt-2';
    return `${v} ${h}`;
  };

  const zoomIn = () => setScaleIdx(prev => Math.min(prev + 1, SCALE_STEPS.length - 1));
  const zoomOut = () => setScaleIdx(prev => Math.max(prev - 1, 0));

  if (pdfLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-100 dark:bg-dark-surface-variant">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto mb-3"></div>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Wczytywanie PDF...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100 dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={scaleIdx === 0}
            className="p-1.5 hover:bg-slate-200 dark:hover:bg-dark-surface rounded transition-colors disabled:opacity-30"
          >
            <ZoomOut className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          </button>
          <span className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark min-w-[3rem] text-center">
            {Math.round(SCALE_STEPS[scaleIdx] * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scaleIdx === SCALE_STEPS.length - 1}
            className="p-1.5 hover:bg-slate-200 dark:hover:bg-dark-surface rounded transition-colors disabled:opacity-30"
          >
            <ZoomIn className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          </button>
        </div>
        <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {pages.length} {pages.length === 1 ? 'strona' : pages.length < 5 ? 'strony' : 'stron'}
        </span>
        {pinMode && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-blue-600 text-white">
            <MapPin className="w-3 h-3" />
            Kliknij na strone...
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        className={`flex-1 overflow-auto bg-slate-200 dark:bg-slate-800 ${pinMode ? 'cursor-crosshair' : ''}`}
      >
        <div className="flex flex-col items-center gap-4 py-4 px-4 min-w-fit">
          {pages.map((page) => {
            const pageAnnotations = annotations.filter(a => a.page_number === page.pageNumber);

            return (
              <div
                key={page.pageNumber}
                ref={(el) => { if (el) pageRefs.current.set(page.pageNumber, el); }}
                className="relative shadow-lg bg-white"
                style={{ width: page.width, height: page.height }}
                onClick={(e) => handlePageClick(page.pageNumber, e)}
              >
                <canvas
                  ref={(el) => {
                    if (el && page.canvas) {
                      const parent = el.parentElement;
                      if (parent && !parent.contains(page.canvas)) {
                        if (el !== page.canvas) {
                          parent.replaceChild(page.canvas, el);
                        }
                      }
                    }
                  }}
                  style={{ width: page.width, height: page.height }}
                />

                {pageAnnotations.map((ann) => {
                  const color = PIN_COLORS[ann.color] || PIN_COLORS.blue;
                  const isActive = activeAnnotationId === ann.id;
                  const idx = annotationIndex(ann);

                  return (
                    <div
                      key={ann.id}
                      data-pin
                      className="absolute"
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
                          onPinClick(ann.id);
                        }}
                        className={`relative flex items-center justify-center transition-all duration-200 ${
                          isActive ? 'scale-125' : 'hover:scale-110'
                        }`}
                      >
                        <MapPin
                          className={`w-7 h-7 drop-shadow-md ${color.text} ${isActive ? 'animate-bounce' : ''}`}
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
                          className={`absolute z-30 w-64 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden ${popupPos(ann.x_percent, ann.y_percent)}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-900">
                              {ann.profiles?.full_name || 'Uzytkownik'}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {new Date(ann.created_at).toLocaleString('pl-PL', {
                                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className="p-3">
                            <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                              {ann.comment}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {pendingPin && pendingPin.page_number === page.pageNumber && (
                  <div
                    className="absolute"
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
                      className={`absolute z-40 w-72 bg-white rounded-xl shadow-2xl border border-blue-300 overflow-hidden ${popupPos(pendingPin.x_percent, pendingPin.y_percent)}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-blue-600" />
                          <span className="text-xs font-semibold text-blue-900">
                            Nowa adnotacja (str. {pendingPin.page_number})
                          </span>
                        </div>
                        <button
                          onClick={onCancelPending}
                          className="p-0.5 hover:bg-blue-100 rounded transition-colors"
                        >
                          <X className="w-3.5 h-3.5 text-blue-600" />
                        </button>
                      </div>
                      <div className="p-3 space-y-2">
                        <textarea
                          ref={inputRef}
                          value={commentInput}
                          onChange={(e) => onCommentChange(e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none"
                          placeholder="Wpisz komentarz..."
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              onSaveAnnotation();
                            }
                          }}
                        />
                        <button
                          onClick={onSaveAnnotation}
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

                <div className="absolute bottom-1 right-2 text-[10px] font-medium text-slate-400 select-none pointer-events-none">
                  {page.pageNumber}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
