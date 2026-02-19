import { useState, useEffect, useMemo } from 'react';
import { X, GitMerge, FileCheck, AlertTriangle, Loader, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Database } from '../../lib/database.types';

type Invoice = Database['public']['Tables']['invoices']['Row'] & {
  uploader?: { full_name: string; role: string } | null;
  department?: { id: string; name: string } | null;
};

interface DuplicateGroup {
  key: string;
  invoices: Invoice[];
  winner: Invoice;
  losers: Invoice[];
}

interface MergeInvoicesModalProps {
  invoices: Invoice[];
  onClose: () => void;
  onMergeComplete: () => void;
}

function scoreInvoice(inv: Invoice): number {
  let score = 0;
  const source = (inv as any).source || '';
  if (source === 'ksef') score += 100;
  if (inv.description && inv.description.trim() && inv.description !== 'Faktura z KSEF - wersja robocza') score += 10;
  if ((inv as any).mpk_description && (inv as any).mpk_description.trim()) score += 10;
  if ((inv as any).invoice_tags && (inv as any).invoice_tags.length > 0) score += 5;
  return score;
}

function buildDuplicateGroups(invoices: Invoice[]): DuplicateGroup[] {
  const groups: Map<string, Invoice[]> = new Map();

  for (const inv of invoices) {
    const num = inv.invoice_number?.trim();
    const nip = inv.supplier_nip?.replace(/[^0-9]/g, '');
    if (!num || !nip) continue;
    const key = `${nip}__${num}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(inv);
  }

  const result: DuplicateGroup[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const sorted = [...group].sort((a, b) => {
      const scoreDiff = scoreInvoice(b) - scoreInvoice(a);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    const winner = sorted[0];
    const losers = sorted.slice(1);
    result.push({ key, invoices: sorted, winner, losers });
  }

  return result;
}

export function MergeInvoicesModal({ invoices, onClose, onMergeComplete }: MergeInvoicesModalProps) {
  const [merging, setMerging] = useState(false);
  const [mergeResults, setMergeResults] = useState<{ key: string; success: boolean; error?: string }[]>([]);
  const [done, setDone] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedWinners, setSelectedWinners] = useState<Map<string, string>>(new Map());

  const duplicateGroups = useMemo(() => buildDuplicateGroups(invoices), [invoices]);

  useEffect(() => {
    const initial = new Map<string, string>();
    for (const g of duplicateGroups) initial.set(g.key, g.winner.id);
    setSelectedWinners(initial);
  }, [duplicateGroups]);

  const toggleExpand = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const setWinner = (groupKey: string, invoiceId: string) => {
    setSelectedWinners(prev => new Map(prev).set(groupKey, invoiceId));
  };

  const getSourceLabel = (inv: Invoice) => {
    const source = (inv as any).source || '';
    if (source === 'ksef') return 'KSeF';
    if (source === 'manual') return 'Ręczna';
    if (source === 'google_drive') return 'Drive';
    if (source?.startsWith('email:')) return 'Email';
    return source || 'Nieznane';
  };

  const hasDescriptiveData = (inv: Invoice) => {
    const hasDesc = inv.description && inv.description.trim() && inv.description !== 'Faktura z KSEF - wersja robocza';
    const hasMpk = (inv as any).mpk_description && (inv as any).mpk_description.trim();
    const hasTags = (inv as any).invoice_tags && (inv as any).invoice_tags.length > 0;
    return hasDesc || hasMpk || hasTags;
  };

  const mergeGroup = async (group: DuplicateGroup, winnerId: string) => {
    const winner = group.invoices.find(inv => inv.id === winnerId) || group.winner;
    const losers = group.invoices.filter(inv => inv.id !== winnerId);

    const updateData: Record<string, any> = {};

    for (const loser of losers) {
      if (!winner.description || winner.description === 'Faktura z KSEF - wersja robocza') {
        if (loser.description && loser.description.trim() && loser.description !== 'Faktura z KSEF - wersja robocza') {
          updateData.description = loser.description;
        }
      }
      if (!(winner as any).mpk_description && (loser as any).mpk_description) {
        updateData.mpk_description = (loser as any).mpk_description;
      }
    }

    if (Object.keys(updateData).length > 0) {
      const { error } = await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', winner.id);
      if (error) throw new Error(`Nie udało się zaktualizować faktury głównej: ${error.message}`);
    }

    for (const loser of losers) {
      if ((loser as any).invoice_tags && (loser as any).invoice_tags.length > 0) {
        const winnerTagIds = ((winner as any).invoice_tags || []).map((t: any) => t.tags?.id || t.tag_id);
        const loserTags = (loser as any).invoice_tags.filter((t: any) => {
          const tagId = t.tags?.id || t.tag_id;
          return !winnerTagIds.includes(tagId);
        });

        if (loserTags.length > 0) {
          const tagsToInsert = loserTags.map((t: any) => ({
            invoice_id: winner.id,
            tag_id: t.tags?.id || t.tag_id,
          }));
          await supabase.from('invoice_tags').insert(tagsToInsert).select();
        }
      }
    }

    for (const loser of losers) {
      if (loser.source === 'ksef') {
        continue;
      }
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', loser.id);
      if (error) throw new Error(`Nie udało się usunąć duplikatu ${loser.invoice_number}: ${error.message}`);
    }
  };

  const handleMergeAll = async () => {
    if (!confirm(`Czy na pewno chcesz połączyć ${duplicateGroups.length} grup duplikatów? Zduplikowane faktury zostaną usunięte, a dane opisowe przeniesione do faktury głównej.`)) return;

    setMerging(true);
    const results: typeof mergeResults = [];

    for (const group of duplicateGroups) {
      const winnerId = selectedWinners.get(group.key) || group.winner.id;
      try {
        await mergeGroup(group, winnerId);
        results.push({ key: group.key, success: true });
      } catch (err: any) {
        results.push({ key: group.key, success: false, error: err.message });
      }
    }

    setMergeResults(results);
    setMerging(false);
    setDone(true);
  };

  if (done) {
    const succeeded = mergeResults.filter(r => r.success).length;
    const failed = mergeResults.filter(r => !r.success).length;
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-700/50">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Check className="w-6 h-6 text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">Scalanie zakończone</h2>
            </div>
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mb-4">
              Połączono <span className="font-semibold text-green-600">{succeeded}</span> grup.
              {failed > 0 && <span className="text-red-500 ml-1">Błędy: {failed}</span>}
            </p>
            {mergeResults.filter(r => !r.success).map(r => (
              <div key={r.key} className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded p-2 mb-2">{r.error}</div>
            ))}
            <button
              onClick={onMergeComplete}
              className="w-full px-4 py-2.5 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium"
            >
              Zamknij i odśwież
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-700/50 flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
              <GitMerge className="w-5 h-5 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark">Połącz duplikaty</h2>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Znaleziono <span className="font-semibold text-orange-600">{duplicateGroups.length}</span> grup duplikatów
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">
            <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {duplicateGroups.length === 0 ? (
            <div className="text-center py-12">
              <Check className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-text-secondary-light dark:text-text-secondary-dark font-medium">Brak duplikatów do połączenia</p>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">Wszystkie faktury są unikalne</p>
            </div>
          ) : (
            <>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 flex-shrink-0" />
                Faktura główna zostanie zachowana. Pozostałe zostaną usunięte. Dane opisowe (opis, opis MPK, tagi) zostaną przeniesione jeśli faktura główna ich nie posiada.
              </div>

              {duplicateGroups.map(group => {
                const currentWinnerId = selectedWinners.get(group.key) || group.winner.id;
                const currentWinner = group.invoices.find(inv => inv.id === currentWinnerId) || group.winner;
                const isExpanded = expandedGroups.has(group.key);

                return (
                  <div key={group.key} className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleExpand(group.key)}
                      className="w-full flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCheck className="w-4 h-4 text-orange-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="font-medium text-sm text-text-primary-light dark:text-text-primary-dark truncate block">
                            {currentWinner.invoice_number}
                          </span>
                          <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                            {currentWinner.supplier_name} · {group.invoices.length} faktury
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-xs px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full">
                          {group.invoices.length} duplikatów
                        </span>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" /> : <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-200 dark:border-slate-700/50 p-3 space-y-2 bg-slate-50/50 dark:bg-slate-800/30">
                        <p className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark mb-2">
                          Wybierz fakturę główną (pozostałe zostaną usunięte):
                        </p>
                        {group.invoices.map(inv => {
                          const isWinner = inv.id === currentWinnerId;
                          const src = (inv as any).source || '';
                          const isKsef = src === 'ksef';
                          const hasData = hasDescriptiveData(inv);
                          return (
                            <button
                              key={inv.id}
                              onClick={() => setWinner(group.key, inv.id)}
                              className={`w-full flex items-center gap-3 p-2.5 rounded-lg border-2 transition text-left ${
                                isWinner
                                  ? 'border-brand-primary bg-brand-primary/5 dark:bg-brand-primary/10'
                                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${isWinner ? 'border-brand-primary bg-brand-primary' : 'border-slate-300 dark:border-slate-600'}`}>
                                {isWinner && <div className="w-2 h-2 bg-white rounded-full" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">{inv.invoice_number}</span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${isKsef ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400'}`}>
                                    {getSourceLabel(inv)}
                                  </span>
                                  {hasData && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
                                      z opisem
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5 truncate">
                                  {inv.description && inv.description !== 'Faktura z KSEF - wersja robocza' ? inv.description : '—'}
                                </p>
                              </div>
                              {isWinner && (
                                <span className="text-[10px] font-semibold text-brand-primary flex-shrink-0">Główna</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {duplicateGroups.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700/50 p-4 flex-shrink-0 flex items-center justify-between gap-3">
            <button
              onClick={onClose}
              disabled={merging}
              className="px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition font-medium text-sm disabled:opacity-50"
            >
              Anuluj
            </button>
            <button
              onClick={handleMergeAll}
              disabled={merging}
              className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition font-medium text-sm disabled:opacity-50"
            >
              {merging ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Scalanie...
                </>
              ) : (
                <>
                  <GitMerge className="w-4 h-4" />
                  Połącz wszystkie ({duplicateGroups.length})
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
