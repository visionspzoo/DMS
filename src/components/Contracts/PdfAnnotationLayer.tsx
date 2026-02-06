import { useRef, useCallback, useEffect } from 'react';
import { MapPin, X, Send } from 'lucide-react';

export interface PdfAnnotation {
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

export interface PendingPin {
  x_percent: number;
  y_percent: number;
}

export const PIN_COLORS: Record<string, { text: string }> = {
  blue: { text: 'text-blue-500' },
  green: { text: 'text-emerald-500' },
  orange: { text: 'text-amber-500' },
  red: { text: 'text-red-500' },
};

interface PdfAnnotationLayerProps {
  pdfBase64: string;
  annotations: PdfAnnotation[];
  pinMode: boolean;
  pendingPin: PendingPin | null;
  activeAnnotationId: string | null;
  commentInput: string;
  submitting: boolean;
  onOverlayClick: (x: number, y: number) => void;
  onPinClick: (id: string) => void;
  onCommentChange: (value: string) => void;
  onSaveAnnotation: () => void;
  onCancelPending: () => void;
}

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
  const overlayRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (pendingPin && inputRef.current) {
      inputRef.current.focus();
    }
  }, [pendingPin]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onCancelPending();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCancelPending]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinMode || !overlayRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-pin]') || target.closest('[data-popup]')) return;

    const rect = overlayRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onOverlayClick(x, y);
  }, [pinMode, onOverlayClick]);

  const popupPos = (xPct: number, yPct: number) => {
    const h = xPct > 65 ? 'right-0' : xPct < 35 ? 'left-0' : 'left-1/2 -translate-x-1/2';
    const v = yPct > 70 ? 'bottom-full mb-2' : 'top-full mt-2';
    return `${v} ${h}`;
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
        onClick={handleClick}
      >
        {annotations.map((ann, idx) => {
          const color = PIN_COLORS[ann.color] || PIN_COLORS.blue;
          const isActive = activeAnnotationId === ann.id;

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
              className={`absolute z-40 w-72 bg-white rounded-xl shadow-2xl border border-blue-300 overflow-hidden ${popupPos(pendingPin.x_percent, pendingPin.y_percent)}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs font-semibold text-blue-900">Nowa adnotacja</span>
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
      </div>

      {pinMode && (
        <div className="absolute top-3 left-3 z-20 pointer-events-auto">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium shadow-lg backdrop-blur-sm bg-blue-600 text-white border border-blue-700">
            <MapPin className="w-3.5 h-3.5" />
            Kliknij na PDF aby postawic pinezke...
          </div>
        </div>
      )}
    </div>
  );
}
