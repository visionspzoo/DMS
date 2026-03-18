import { useState, useEffect, useMemo } from 'react';
import { X, GitMerge, FileCheck, AlertTriangle, Loader, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase, getValidSession } from '../../lib/supabase';
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
  onGroupMerged?: () => void;
  currentUserId?: string;
  isAdmin?: boolean;
}

const INVOICE_FIELDS = `
  id,
  invoice_number,
  supplier_name,
  supplier_nip,
  issue_date,
  due_date,
  net_amount,
  tax_amount,
  gross_amount,
  pln_gross_amount,
  exchange_rate,
  currency,
  status,
  description,
  uploaded_by,
  current_approver_id,
  department_id,
  cost_center_id,
  file_url,
  paid_at,
  paid_by,
  created_at,
  updated_at,
  source,
  is_duplicate,
  duplicate_invoice_ids,
  file_hash,
  user_drive_file_id,
  drive_owner_user_id,
  pz_number,
  bez_mpk,
  internal_comment,
  uploader:profiles!uploaded_by(full_name, role),
  department:departments!department_id(id, name)
`;

function normalizeNip(nip: string | null | undefined): string {
  return (nip || '').replace(/[^0-9]/g, '');
}

async function loadAllDuplicateInvoices(userId?: string): Promise<Invoice[]> {
  const { data, error } = await supabase.rpc('get_user_duplicate_invoice_groups', userId ? { p_user_id: userId } : {});
  if (error) {
    console.error('[MergeInvoicesModal] RPC error:', error);
    throw error;
  }
  console.log('[MergeInvoicesModal] RPC returned', (data || []).length, 'rows');

  return ((data || []) as any[]).map((row: any) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    supplier_name: row.supplier_name,
    supplier_nip: row.supplier_nip,
    issue_date: row.issue_date,
    due_date: row.due_date,
    net_amount: row.net_amount,
    tax_amount: row.tax_amount,
    gross_amount: row.gross_amount,
    pln_gross_amount: row.pln_gross_amount,
    exchange_rate: row.exchange_rate,
    currency: row.currency,
    status: row.status,
    description: row.description,
    uploaded_by: row.uploaded_by,
    current_approver_id: row.current_approver_id,
    department_id: row.department_id,
    cost_center_id: row.cost_center_id,
    file_url: row.file_url,
    paid_at: row.paid_at,
    paid_by: row.paid_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source: row.source,
    is_duplicate: row.is_duplicate,
    duplicate_invoice_ids: row.duplicate_invoice_ids,
    file_hash: row.file_hash,
    user_drive_file_id: row.user_drive_file_id,
    drive_owner_user_id: row.drive_owner_user_id,
    pz_number: row.pz_number,
    bez_mpk: row.bez_mpk,
    internal_comment: row.internal_comment,
    uploader: row.uploader_name ? { full_name: row.uploader_name, role: row.uploader_role } : null,
    department: row.department_name ? { id: row.department_id, name: row.department_name } : null,
  })) as Invoice[];
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
  const groups = new Map<string, Invoice[]>();

  for (const inv of invoices) {
    const num = inv.invoice_number?.trim();
    if (!num) continue;
    const nip = normalizeNip(inv.supplier_nip);
    const name = inv.supplier_name?.toLowerCase().trim() || '';
    const key = nip ? `${nip}__${num}` : `name__${name}__${num}`;
    const group = groups.get(key) || [];
    if (!group.some(i => i.id === inv.id)) group.push(inv);
    groups.set(key, group);
  }

  const nipNumberToName = new Map<string, string>();
  for (const inv of invoices) {
    const num = inv.invoice_number?.trim();
    const nip = normalizeNip(inv.supplier_nip);
    const name = inv.supplier_name?.toLowerCase().trim() || '';
    if (nip && num && name) nipNumberToName.set(`${nip}__${num}`, name);
  }

  for (const inv of invoices) {
    const num = inv.invoice_number?.trim();
    if (!num) continue;
    const nip = normalizeNip(inv.supplier_nip);
    if (nip) continue;
    const name = inv.supplier_name?.toLowerCase().trim() || '';
    if (!name) continue;
    const nameKey = `name__${name}__${num}`;
    for (const [nipKey, nipName] of nipNumberToName.entries()) {
      if (!nipKey.endsWith(`__${num}`)) continue;
      if (nipName !== name) continue;
      const nipGroup = groups.get(nipKey) || [];
      const nameGroup = groups.get(nameKey) || [];
      const merged = [...nipGroup];
      for (const i of nameGroup) {
        if (!merged.some(x => x.id === i.id)) merged.push(i);
      }
      groups.set(nipKey, merged);
      groups.delete(nameKey);
    }
  }

  const result: DuplicateGroup[] = [];
  for (const [key, members] of groups.entries()) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => {
      const scoreDiff = scoreInvoice(b) - scoreInvoice(a);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
    result.push({ key, invoices: sorted, winner: sorted[0], losers: sorted.slice(1) });
  }
  return result;
}

export function MergeInvoicesModal({ invoices, onClose, onMergeComplete, onGroupMerged, currentUserId, isAdmin }: MergeInvoicesModalProps) {
  const [merging, setMerging] = useState(false);
  const [mergingGroupKey, setMergingGroupKey] = useState<string | null>(null);
  const [mergeResults, setMergeResults] = useState<{ key: string; success: boolean; error?: string }[]>([]);
  const [done, setDone] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedWinners, setSelectedWinners] = useState<Map<string, string>>(new Map());
  const [allDuplicates, setAllDuplicates] = useState<Invoice[]>([]);
  const [loadingDuplicates, setLoadingDuplicates] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mergedKeys, setMergedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoadingDuplicates(true);
    setLoadError(null);
    console.log('[MergeInvoicesModal] Opening, currentUserId=', currentUserId, 'isAdmin=', isAdmin);
    loadAllDuplicateInvoices(currentUserId)
      .then(data => {
        console.log('[MergeInvoicesModal] RPC data sample:', data.slice(0, 3).map(d => ({ id: d.id, num: d.invoice_number, nip: d.supplier_nip })));
        const combined = [...data];
        for (const inv of invoices) {
          if (!combined.some(d => d.id === inv.id)) {
            combined.push(inv);
          }
        }
        console.log('[MergeInvoicesModal] Combined count:', combined.length);
        const groups = buildDuplicateGroups(combined);
        console.log('[MergeInvoicesModal] Groups found:', groups.length, groups.map(g => g.key));
        setAllDuplicates(combined);
      })
      .catch((err) => {
        console.error('[MergeInvoicesModal] Failed to load duplicates:', err);
        setLoadError(err?.message || 'Błąd ładowania duplikatów');
        setAllDuplicates(invoices);
      })
      .finally(() => setLoadingDuplicates(false));
  }, []);

  const duplicateGroups = useMemo(() => {
    console.log('[MergeInvoicesModal] Building groups from', allDuplicates.length, 'invoices');
    const groups = buildDuplicateGroups(allDuplicates);
    console.log('[MergeInvoicesModal] Built', groups.length, 'groups:', groups.map(g => ({ key: g.key, count: g.invoices.length })));
    return groups;
  }, [allDuplicates, currentUserId, isAdmin]);

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

  const statusLabels: Record<string, string> = {
    draft: 'Robocze',
    waiting: 'Oczekujące',
    pending: 'Oczekujące',
    in_review: 'W weryfikacji',
    accepted: 'Zaakceptowana',
    rejected: 'Odrzucona',
    paid: 'Opłacona',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
    waiting: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    pending: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    in_review: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    accepted: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    rejected: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    paid: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
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

  const deleteFromDrive = async (fileId: string, ownerUserId?: string | null) => {
    try {
      const session = await getValidSession();
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-from-google-drive`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fileId, ownerUserId: ownerUserId ?? undefined }),
        }
      );
    } catch {
    }
  };

  const mergeGroup = async (group: DuplicateGroup, winnerId: string) => {
    const winner = group.invoices.find(inv => inv.id === winnerId) || group.winner;
    const losers = group.invoices.filter(inv => inv.id !== winnerId);

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
      if (loser.source === 'ksef') continue;
      if ((loser as any).google_drive_id) {
        await deleteFromDrive((loser as any).google_drive_id);
      }
      if (loser.user_drive_file_id && loser.user_drive_file_id !== (loser as any).google_drive_id) {
        await deleteFromDrive(loser.user_drive_file_id, (loser as any).drive_owner_user_id);
      }
      if (loser.file_url) {
        try {
          const filePath = loser.file_url.split('/').pop();
          if (filePath) {
            await supabase.storage.from('documents').remove([`invoices/${filePath}`]);
          }
        } catch {
        }
      }
    }

    const loserIds = losers.map(l => l.id);
    const { data: rpcResult, error: rpcError } = await supabase.rpc('merge_duplicate_invoices', {
      p_winner_id: winner.id,
      p_loser_ids: loserIds,
    });

    if (rpcError) throw new Error(`Błąd scalania: ${rpcError.message}`);

    const result = rpcResult as { success: boolean; error?: string };
    if (!result?.success) {
      throw new Error(result?.error || 'Nieznany błąd scalania');
    }
  };

  const handleMergeSingle = async (group: DuplicateGroup) => {
    const winnerId = selectedWinners.get(group.key) || group.winner.id;
    setMergingGroupKey(group.key);
    try {
      await mergeGroup(group, winnerId);
      setMergedKeys(prev => new Set(prev).add(group.key));
      onGroupMerged?.();
    } catch (err: any) {
      alert(`Błąd scalania: ${err.message}`);
    } finally {
      setMergingGroupKey(null);
    }
  };

  const handleMergeAll = async () => {
    const remaining = duplicateGroups.filter(g => !mergedKeys.has(g.key));
    if (!confirm(`Czy na pewno chcesz połączyć ${remaining.length} grup duplikatów? Zduplikowane faktury zostaną usunięte, a dane opisowe przeniesione do faktury głównej.`)) return;

    setMerging(true);
    const results: typeof mergeResults = [];

    for (const group of remaining) {
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

  const visibleGroups = duplicateGroups.filter(g => !mergedKeys.has(g.key));

  if (done) {
    const succeeded = mergeResults.filter(r => r.success).length + mergedKeys.size;
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
                {loadingDuplicates ? 'Wyszukiwanie duplikatów...' : (
                  <>
                    {mergedKeys.size > 0 && <><span className="font-semibold text-green-600">{mergedKeys.size}</span> połączono · </>}
                    <span className="font-semibold text-orange-600">{visibleGroups.length}</span> pozostało
                  </>
                )}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition">
            <X className="w-5 h-5 text-text-secondary-light dark:text-text-secondary-dark" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loadingDuplicates ? (
            <div className="flex items-center justify-center py-12">
              <Loader className="w-8 h-8 animate-spin text-brand-primary" />
            </div>
          ) : loadError ? (
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-3" />
              <p className="text-text-primary-light dark:text-text-primary-dark font-medium">Błąd ładowania duplikatów</p>
              <p className="text-xs text-red-500 mt-1">{loadError}</p>
              <button
                onClick={() => {
                  setLoadingDuplicates(true);
                  setLoadError(null);
                  loadAllDuplicateInvoices(currentUserId)
                    .then(data => {
                      const combined = [...data];
                      for (const inv of invoices) {
                        if (!combined.some(d => d.id === inv.id)) combined.push(inv);
                      }
                      setAllDuplicates(combined);
                    })
                    .catch((err) => {
                      setLoadError(err?.message || 'Błąd ładowania duplikatów');
                      setAllDuplicates(invoices);
                    })
                    .finally(() => setLoadingDuplicates(false));
                }}
                className="mt-4 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium text-sm"
              >
                Spróbuj ponownie
              </button>
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="text-center py-12">
              <Check className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-text-secondary-light dark:text-text-secondary-dark font-medium">
                {mergedKeys.size > 0 ? 'Wszystkie duplikaty zostały połączone' : 'Brak duplikatów do połączenia'}
              </p>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
                {mergedKeys.size > 0 ? `Połączono ${mergedKeys.size} grup` : 'Wszystkie faktury są unikalne'}
              </p>
              {mergedKeys.size > 0 && (
                <button
                  onClick={onMergeComplete}
                  className="mt-4 px-4 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium text-sm"
                >
                  Zamknij i odśwież
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 flex-shrink-0" />
                Faktura główna zostanie zachowana. Pozostałe zostaną usunięte. Dane opisowe (opis, opis MPK, tagi) zostaną przeniesione jeśli faktura główna ich nie posiada.
              </div>

              {visibleGroups.map(group => {
                const currentWinnerId = selectedWinners.get(group.key) || group.winner.id;
                const currentWinner = group.invoices.find(inv => inv.id === currentWinnerId) || group.winner;
                const isExpanded = expandedGroups.has(group.key);
                const isMergingThis = mergingGroupKey === group.key;

                return (
                  <div key={group.key} className="border border-slate-200 dark:border-slate-700/50 rounded-lg overflow-hidden">
                    <div className="flex items-center">
                      <button
                        onClick={() => toggleExpand(group.key)}
                        className="flex-1 flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition text-left"
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
                      <div className="px-3 flex-shrink-0 border-l border-slate-200 dark:border-slate-700/50">
                        <button
                          onClick={() => handleMergeSingle(group)}
                          disabled={isMergingThis || merging}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition font-medium text-xs disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          {isMergingThis ? (
                            <><Loader className="w-3.5 h-3.5 animate-spin" />Scalanie...</>
                          ) : (
                            <><GitMerge className="w-3.5 h-3.5" />Połącz</>
                          )}
                        </button>
                      </div>
                    </div>

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
                                  {inv.status && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColors[inv.status] || statusColors.draft}`}>
                                      {statusLabels[inv.status] || inv.status}
                                    </span>
                                  )}
                                  {hasData && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium">
                                      z opisem
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {inv.uploader?.full_name && (
                                    <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark truncate">
                                      Wlasciciel: <span className="font-medium text-text-primary-light dark:text-text-primary-dark">{inv.uploader.full_name}</span>
                                    </span>
                                  )}
                                </div>
                                {inv.description && inv.description !== 'Faktura z KSEF - wersja robocza' && (
                                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mt-0.5 truncate">
                                    {inv.description}
                                  </p>
                                )}
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

        {visibleGroups.length > 0 && (
          <div className="border-t border-slate-200 dark:border-slate-700/50 p-4 flex-shrink-0 flex items-center justify-between gap-3">
            <button
              onClick={onClose}
              disabled={merging || mergingGroupKey !== null}
              className="px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition font-medium text-sm disabled:opacity-50"
            >
              Anuluj
            </button>
            <button
              onClick={handleMergeAll}
              disabled={merging || mergingGroupKey !== null}
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
                  Połącz wszystkie ({visibleGroups.length})
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
