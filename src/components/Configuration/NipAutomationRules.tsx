import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Plus, Trash2, Edit2, Save, X, AlertCircle, Search,
  Zap, Tag, CheckCircle, ToggleLeft, ToggleRight, Lightbulb,
  Building2, Hash
} from 'lucide-react';

interface CostCenter {
  id: string;
  code: string;
  description: string;
  is_active: boolean;
}

interface TagType {
  id: string;
  name: string;
  color: string;
}

interface Department {
  id: string;
  name: string;
}

interface AutomationRule {
  id: string;
  supplier_nip: string | null;
  supplier_name: string | null;
  auto_accept: boolean;
  cost_center_id: string | null;
  department_id: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  cost_center?: CostCenter | null;
  department?: Department | null;
  tags: TagType[];
}

interface Suggestion {
  supplier_nip: string | null;
  supplier_name: string;
  invoice_count: number;
  most_used_tags: TagType[];
  most_used_cost_center: CostCenter | null;
}

export default function NipAutomationRules() {
  const { profile } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [accessibleDepartments, setAccessibleDepartments] = useState<Department[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [formNip, setFormNip] = useState('');
  const [formName, setFormName] = useState('');
  const [formAutoAccept, setFormAutoAccept] = useState(false);
  const [formCostCenterId, setFormCostCenterId] = useState('');
  const [formDepartmentId, setFormDepartmentId] = useState('');
  const [formSelectedTags, setFormSelectedTags] = useState<TagType[]>([]);
  const [formTagSearch, setFormTagSearch] = useState('');
  const [formCostCenterSearch, setFormCostCenterSearch] = useState('');
  const [formDepartmentSearch, setFormDepartmentSearch] = useState('');

  const isAdmin = profile?.is_admin;
  const userRole = profile?.role;

  const loadAccessibleDepartments = useCallback(async () => {
    if (!profile?.id) return;

    if (isAdmin) {
      const { data } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');
      setAccessibleDepartments(data || []);
      return;
    }

    const deptIds = new Set<string>();

    if (userRole === 'Dyrektor') {
      const { data: dirDepts } = await supabase
        .from('departments')
        .select('id, name')
        .eq('director_id', profile.id)
        .order('name');
      (dirDepts || []).forEach(d => deptIds.add(d.id));
    }

    if (profile.department_id) {
      deptIds.add(profile.department_id);
    }

    const { data: memberDepts } = await supabase
      .from('department_members')
      .select('department_id')
      .eq('user_id', profile.id);
    (memberDepts || []).forEach(m => deptIds.add(m.department_id));

    if (deptIds.size === 0) {
      setAccessibleDepartments([]);
      return;
    }

    const { data: depts } = await supabase
      .from('departments')
      .select('id, name')
      .in('id', Array.from(deptIds))
      .order('name');
    setAccessibleDepartments(depts || []);
  }, [profile?.id, isAdmin, userRole, profile?.department_id]);

  const loadRules = useCallback(async () => {
    if (!profile?.id) return;
    try {
      let query = supabase
        .from('nip_automation_rules')
        .select('*')
        .order('created_at', { ascending: false });

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;

      const allRules = data || [];

      const rulesWithDetails: AutomationRule[] = [];
      for (const rule of allRules) {
        let costCenter = null;
        if (rule.cost_center_id) {
          const { data: cc } = await supabase
            .from('cost_centers')
            .select('id, code, description, is_active')
            .eq('id', rule.cost_center_id)
            .maybeSingle();
          costCenter = cc;
        }

        let department = null;
        if (rule.department_id) {
          const { data: dept } = await supabase
            .from('departments')
            .select('id, name')
            .eq('id', rule.department_id)
            .maybeSingle();
          department = dept;
        }

        const { data: tagLinks } = await supabase
          .from('nip_automation_rule_tags')
          .select('tag_id')
          .eq('rule_id', rule.id);

        const tags: TagType[] = [];
        if (tagLinks) {
          for (const link of tagLinks) {
            const { data: tag } = await supabase
              .from('tags')
              .select('id, name, color')
              .eq('id', link.tag_id)
              .maybeSingle();
            if (tag) tags.push(tag);
          }
        }

        rulesWithDetails.push({ ...rule, cost_center: costCenter, department, tags });
      }

      setRules(rulesWithDetails);
    } catch (err: any) {
      console.error('Error loading rules:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [profile?.id]);

  const loadCostCenters = useCallback(async () => {
    const { data } = await supabase
      .from('cost_centers')
      .select('id, code, description, is_active')
      .eq('is_active', true)
      .order('display_order');
    setCostCenters(data || []);
  }, []);

  const loadTags = useCallback(async () => {
    const { data } = await supabase
      .from('tags')
      .select('id, name, color')
      .order('name');
    setAllTags(data || []);
  }, []);

  const loadSuggestions = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('supplier_nip, supplier_name, cost_center_id')
        .not('supplier_nip', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (!invoices || invoices.length === 0) return;

      const { data: existingRules } = await supabase
        .from('nip_automation_rules')
        .select('supplier_nip')
        .eq('is_active', true);

      const existingNips = new Set((existingRules || []).map(r => r.supplier_nip));

      const nipGroups: Record<string, {
        name: string;
        count: number;
        costCenterCounts: Record<string, number>;
      }> = {};

      for (const inv of invoices) {
        if (!inv.supplier_nip || existingNips.has(inv.supplier_nip)) continue;
        if (!nipGroups[inv.supplier_nip]) {
          nipGroups[inv.supplier_nip] = { name: inv.supplier_name || '', count: 0, costCenterCounts: {} };
        }
        nipGroups[inv.supplier_nip].count++;
        if (inv.cost_center_id) {
          nipGroups[inv.supplier_nip].costCenterCounts[inv.cost_center_id] =
            (nipGroups[inv.supplier_nip].costCenterCounts[inv.cost_center_id] || 0) + 1;
        }
      }

      const { data: tagLearning } = await supabase
        .from('tag_learning')
        .select('vendor_name, supplier_nip, tag_id, frequency')
        .order('frequency', { ascending: false });

      const nipTagMap: Record<string, { tag_id: string; frequency: number }[]> = {};
      for (const tl of tagLearning || []) {
        const nip = tl.supplier_nip;
        if (!nip) continue;
        if (!nipTagMap[nip]) nipTagMap[nip] = [];
        nipTagMap[nip].push({ tag_id: tl.tag_id, frequency: tl.frequency });
      }

      const sorted = Object.entries(nipGroups)
        .filter(([, g]) => g.count >= 2)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 5);

      const result: Suggestion[] = [];
      for (const [nip, group] of sorted) {
        const topCCId = Object.entries(group.costCenterCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || null;
        let topCC: CostCenter | null = null;
        if (topCCId) {
          const { data: cc } = await supabase
            .from('cost_centers')
            .select('id, code, description, is_active')
            .eq('id', topCCId)
            .maybeSingle();
          topCC = cc;
        }

        const tagIds = (nipTagMap[nip] || []).slice(0, 3);
        const tags: TagType[] = [];
        for (const t of tagIds) {
          const { data: tag } = await supabase
            .from('tags')
            .select('id, name, color')
            .eq('id', t.tag_id)
            .maybeSingle();
          if (tag) tags.push(tag);
        }

        result.push({ supplier_nip: nip, supplier_name: group.name, invoice_count: group.count, most_used_tags: tags, most_used_cost_center: topCC });
      }

      setSuggestions(result);
    } catch (err) {
      console.error('Error loading suggestions:', err);
    }
  }, [profile?.id]);

  useEffect(() => {
    loadRules();
    loadCostCenters();
    loadTags();
    loadAccessibleDepartments();
    loadSuggestions();
  }, [loadRules, loadCostCenters, loadTags, loadAccessibleDepartments, loadSuggestions]);

  const resetForm = () => {
    setFormNip('');
    setFormName('');
    setFormAutoAccept(false);
    setFormCostCenterId('');
    setFormDepartmentId('');
    setFormSelectedTags([]);
    setFormTagSearch('');
    setFormCostCenterSearch('');
    setFormDepartmentSearch('');
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (rule: AutomationRule) => {
    if (!isAdmin && rule.created_by !== profile?.id) return;
    setFormNip(rule.supplier_nip || '');
    setFormName(rule.supplier_name || '');
    setFormAutoAccept(rule.auto_accept);
    setFormCostCenterId(rule.cost_center_id || '');
    setFormDepartmentId(rule.department_id || '');
    setFormSelectedTags(rule.tags);
    setEditingId(rule.id);
    setShowForm(true);
  };

  const startFromSuggestion = (suggestion: Suggestion) => {
    setFormNip(suggestion.supplier_nip || '');
    setFormName(suggestion.supplier_name);
    setFormAutoAccept(false);
    setFormCostCenterId(suggestion.most_used_cost_center?.id || '');
    setFormDepartmentId('');
    setFormSelectedTags(suggestion.most_used_tags);
    setEditingId(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formNip.trim() && !formName.trim()) {
      setError('Podaj NIP lub nazwe kontrahenta');
      return;
    }

    if (formNip.trim()) {
      const { data: existing } = await supabase
        .from('nip_automation_rules')
        .select('id')
        .eq('supplier_nip', formNip.trim())
        .neq('id', editingId || '')
        .maybeSingle();
      if (existing) {
        setError(`Automatyzacja dla NIP ${formNip.trim()} już istnieje. Każdy NIP może mieć tylko jedną regułę.`);
        return;
      }
    }

    setSaving(true);
    setError('');

    try {
      const ruleData = {
        supplier_nip: formNip.trim() || null,
        supplier_name: formName.trim() || null,
        auto_accept: formAutoAccept,
        cost_center_id: formCostCenterId || null,
        department_id: formDepartmentId || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      let ruleId: string;

      if (editingId) {
        const { error: updateErr } = await supabase
          .from('nip_automation_rules')
          .update(ruleData)
          .eq('id', editingId);
        if (updateErr) throw updateErr;
        ruleId = editingId;

        await supabase
          .from('nip_automation_rule_tags')
          .delete()
          .eq('rule_id', ruleId);
      } else {
        const { data: newRule, error: insertErr } = await supabase
          .from('nip_automation_rules')
          .insert({ ...ruleData, created_by: profile!.id })
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        ruleId = newRule.id;
      }

      if (formSelectedTags.length > 0) {
        const tagInserts = formSelectedTags.map(tag => ({ rule_id: ruleId, tag_id: tag.id }));
        const { error: tagErr } = await supabase
          .from('nip_automation_rule_tags')
          .insert(tagInserts);
        if (tagErr) throw tagErr;
      }

      setSuccess(editingId ? 'Zaktualizowano regule' : 'Dodano nowa regule automatyzacji');
      resetForm();
      await loadRules();
      await loadSuggestions();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      console.error('Error saving rule:', err);
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (rule: AutomationRule) => {
    if (!isAdmin && rule.created_by !== profile?.id) return;
    try {
      const { error: updateErr } = await supabase
        .from('nip_automation_rules')
        .update({ is_active: !rule.is_active, updated_at: new Date().toISOString() })
        .eq('id', rule.id);
      if (updateErr) throw updateErr;
      await loadRules();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (rule: AutomationRule) => {
    if (!isAdmin && rule.created_by !== profile?.id) return;
    if (!confirm('Czy na pewno chcesz usunac te regule?')) return;
    try {
      const { error: delErr } = await supabase
        .from('nip_automation_rules')
        .delete()
        .eq('id', rule.id);
      if (delErr) throw delErr;
      setSuccess('Usunieto regule');
      await loadRules();
      await loadSuggestions();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addTagToForm = (tag: TagType) => {
    if (!formSelectedTags.some(t => t.id === tag.id)) {
      setFormSelectedTags(prev => [...prev, tag]);
    }
    setFormTagSearch('');
  };

  const removeTagFromForm = (tagId: string) => {
    setFormSelectedTags(prev => prev.filter(t => t.id !== tagId));
  };

  const accessibleDeptIds = new Set(accessibleDepartments.map(d => d.id));

  const visibleRules = rules.filter(rule => {
    if (isAdmin) return true;
    if (!rule.department_id) return rule.created_by === profile?.id;
    return accessibleDeptIds.has(rule.department_id) || rule.created_by === profile?.id;
  });

  const filteredRules = visibleRules.filter(rule => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (rule.supplier_nip || '').toLowerCase().includes(q) ||
      (rule.supplier_name || '').toLowerCase().includes(q)
    );
  });

  const filteredTags = allTags.filter(
    tag =>
      !formSelectedTags.some(t => t.id === tag.id) &&
      tag.name.toLowerCase().includes(formTagSearch.toLowerCase())
  );

  const filteredCostCenters = costCenters.filter(
    cc =>
      cc.code.toLowerCase().includes(formCostCenterSearch.toLowerCase()) ||
      cc.description.toLowerCase().includes(formCostCenterSearch.toLowerCase())
  );

  const filteredDepartments = accessibleDepartments.filter(
    d => d.name.toLowerCase().includes(formDepartmentSearch.toLowerCase())
  );

  const selectedCostCenter = costCenters.find(cc => cc.id === formCostCenterId);
  const selectedDepartment = accessibleDepartments.find(d => d.id === formDepartmentId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-text-secondary-light dark:text-text-secondary-dark">Ladowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700/50 rounded-lg p-4">
          <p className="text-sm text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}

      {suggestions.length > 0 && !showForm && (
        <SuggestionsPanel suggestions={suggestions} onUseSuggestion={startFromSuggestion} />
      )}

      <RuleForm
        show={showForm}
        editing={!!editingId}
        formNip={formNip}
        formName={formName}
        formAutoAccept={formAutoAccept}
        formCostCenterId={formCostCenterId}
        formDepartmentId={formDepartmentId}
        formSelectedTags={formSelectedTags}
        formTagSearch={formTagSearch}
        formCostCenterSearch={formCostCenterSearch}
        formDepartmentSearch={formDepartmentSearch}
        selectedCostCenter={selectedCostCenter}
        selectedDepartment={selectedDepartment}
        filteredTags={filteredTags}
        filteredCostCenters={filteredCostCenters}
        filteredDepartments={filteredDepartments}
        saving={saving}
        onNipChange={setFormNip}
        onNameChange={setFormName}
        onAutoAcceptChange={setFormAutoAccept}
        onCostCenterChange={setFormCostCenterId}
        onCostCenterSearchChange={setFormCostCenterSearch}
        onDepartmentChange={setFormDepartmentId}
        onDepartmentSearchChange={setFormDepartmentSearch}
        onTagSearchChange={setFormTagSearch}
        onAddTag={addTagToForm}
        onRemoveTag={removeTagFromForm}
        onSave={handleSave}
        onCancel={resetForm}
        onShow={() => setShowForm(true)}
      />

      <RulesList
        rules={filteredRules}
        searchQuery={searchQuery}
        currentUserId={profile?.id}
        isAdmin={!!isAdmin}
        onSearchChange={setSearchQuery}
        onEdit={startEdit}
        onDelete={handleDelete}
        onToggleActive={handleToggleActive}
      />
    </div>
  );
}

function SuggestionsPanel({
  suggestions,
  onUseSuggestion,
}: {
  suggestions: Suggestion[];
  onUseSuggestion: (s: Suggestion) => void;
}) {
  return (
    <div className="bg-gradient-to-br from-amber-50/80 to-orange-50/50 dark:from-amber-900/10 dark:to-orange-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
          <Lightbulb className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
            Sugestie automatyzacji
          </h3>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            Na podstawie najczesciej powtarzajacych sie faktur
          </p>
        </div>
      </div>
      <div className="space-y-2.5">
        {suggestions.map((s, i) => (
          <div
            key={i}
            className="bg-white/70 dark:bg-dark-surface/70 rounded-lg p-3.5 border border-amber-100 dark:border-amber-900/20 flex items-center gap-3 group hover:bg-white dark:hover:bg-dark-surface transition"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark truncate">
                  {s.supplier_name || 'Brak nazwy'}
                </span>
                {s.supplier_nip && (
                  <span className="text-xs font-mono text-text-secondary-light dark:text-text-secondary-dark bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex-shrink-0">
                    NIP: {s.supplier_nip}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                  {s.invoice_count} faktur
                </span>
                {s.most_used_cost_center && (
                  <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                    MPK: {s.most_used_cost_center.code}
                  </span>
                )}
                {s.most_used_tags.map(tag => (
                  <span
                    key={tag.id}
                    className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}30` }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => onUseSuggestion(s)}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Dodaj regule
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RuleForm({
  show, editing, formNip, formName, formAutoAccept, formCostCenterId, formDepartmentId,
  formSelectedTags, formTagSearch, formCostCenterSearch, formDepartmentSearch,
  selectedCostCenter, selectedDepartment, filteredTags, filteredCostCenters, filteredDepartments,
  saving, onNipChange, onNameChange, onAutoAcceptChange, onCostCenterChange, onCostCenterSearchChange,
  onDepartmentChange, onDepartmentSearchChange, onTagSearchChange, onAddTag, onRemoveTag,
  onSave, onCancel, onShow,
}: {
  show: boolean; editing: boolean; formNip: string; formName: string; formAutoAccept: boolean;
  formCostCenterId: string; formDepartmentId: string; formSelectedTags: TagType[];
  formTagSearch: string; formCostCenterSearch: string; formDepartmentSearch: string;
  selectedCostCenter: CostCenter | undefined; selectedDepartment: Department | undefined;
  filteredTags: TagType[]; filteredCostCenters: CostCenter[]; filteredDepartments: Department[];
  saving: boolean;
  onNipChange: (v: string) => void; onNameChange: (v: string) => void;
  onAutoAcceptChange: (v: boolean) => void; onCostCenterChange: (v: string) => void;
  onCostCenterSearchChange: (v: string) => void; onDepartmentChange: (v: string) => void;
  onDepartmentSearchChange: (v: string) => void; onTagSearchChange: (v: string) => void;
  onAddTag: (tag: TagType) => void; onRemoveTag: (id: string) => void;
  onSave: () => void; onCancel: () => void; onShow: () => void;
}) {
  const [showCostCenterDropdown, setShowCostCenterDropdown] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);

  if (!show) {
    return (
      <button
        onClick={onShow}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-primary text-white rounded-xl hover:bg-brand-primary/90 transition font-medium text-sm"
      >
        <Plus className="w-4 h-4" />
        Dodaj nowa regule automatyzacji
      </button>
    );
  }

  return (
    <div className="bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-primary/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-brand-primary" />
          </div>
          <h3 className="font-semibold text-text-primary-light dark:text-text-primary-dark">
            {editing ? 'Edytuj regule' : 'Nowa regula automatyzacji'}
          </h3>
        </div>
        <button
          onClick={onCancel}
          className="p-1.5 text-text-secondary-light dark:text-text-secondary-dark hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
              NIP kontrahenta
            </label>
            <input
              type="text"
              value={formNip}
              onChange={(e) => onNipChange(e.target.value)}
              placeholder="np. 1234567890"
              className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent font-mono"
            />
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Dopasowanie po NIP ma priorytet
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
              Nazwa kontrahenta
            </label>
            <input
              type="text"
              value={formName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="np. ABC Sp. z o.o."
              className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Uzywana gdy NIP nie jest podany
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3.5 bg-slate-50 dark:bg-dark-surface-variant rounded-lg border border-slate-200 dark:border-slate-700/50">
          <button type="button" onClick={() => onAutoAcceptChange(!formAutoAccept)} className="flex-shrink-0">
            {formAutoAccept ? (
              <ToggleRight className="w-8 h-5 text-green-600" />
            ) : (
              <ToggleLeft className="w-8 h-5 text-slate-400" />
            )}
          </button>
          <div>
            <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
              Automatyczna akceptacja
            </span>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Faktura zostanie automatycznie zaakceptowana po dodaniu do systemu
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
              <Building2 className="w-3.5 h-3.5 inline mr-1" />
              Przypisz do dzialu
            </label>
            {selectedDepartment ? (
              <div className="flex items-center gap-2 px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface-variant">
                <Building2 className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
                <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark flex-1 truncate">
                  {selectedDepartment.name}
                </span>
                <button onClick={() => onDepartmentChange('')} className="p-0.5 text-slate-400 hover:text-red-500 transition">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={formDepartmentSearch}
                  onChange={(e) => { onDepartmentSearchChange(e.target.value); setShowDepartmentDropdown(true); }}
                  onFocus={() => setShowDepartmentDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDepartmentDropdown(false), 200)}
                  placeholder="Szukaj dzialu..."
                  className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
                {showDepartmentDropdown && filteredDepartments.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-dark-surface border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
                    {filteredDepartments.slice(0, 10).map(dept => (
                      <button
                        key={dept.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { onDepartmentChange(dept.id); onDepartmentSearchChange(''); setShowDepartmentDropdown(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-dark-surface-variant text-sm flex items-center gap-2 transition"
                      >
                        <Building2 className="w-3.5 h-3.5 text-text-secondary-light dark:text-text-secondary-dark flex-shrink-0" />
                        <span className="text-text-primary-light dark:text-text-primary-dark truncate">{dept.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-1">
              Faktura zostanie automatycznie przypisana do wybranego dzialu
            </p>
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
              <Hash className="w-3.5 h-3.5 inline mr-1" />
              Opis MPK
            </label>
            {selectedCostCenter ? (
              <div className="flex items-center gap-2 px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-dark-surface-variant">
                <span className="text-sm font-mono font-medium text-text-primary-light dark:text-text-primary-dark">
                  {selectedCostCenter.code}
                </span>
                <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark truncate">
                  - {selectedCostCenter.description}
                </span>
                <button onClick={() => onCostCenterChange('')} className="ml-auto p-0.5 text-slate-400 hover:text-red-500 transition">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={formCostCenterSearch}
                  onChange={(e) => { onCostCenterSearchChange(e.target.value); setShowCostCenterDropdown(true); }}
                  onFocus={() => setShowCostCenterDropdown(true)}
                  onBlur={() => setTimeout(() => setShowCostCenterDropdown(false), 200)}
                  placeholder="Szukaj MPK po kodzie lub opisie..."
                  className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
                />
                {showCostCenterDropdown && filteredCostCenters.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-dark-surface border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
                    {filteredCostCenters.slice(0, 10).map(cc => (
                      <button
                        key={cc.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { onCostCenterChange(cc.id); onCostCenterSearchChange(''); setShowCostCenterDropdown(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-dark-surface-variant text-sm flex items-center gap-2 transition"
                      >
                        <span className="font-mono font-medium text-text-primary-light dark:text-text-primary-dark">{cc.code}</span>
                        <span className="text-text-secondary-light dark:text-text-secondary-dark truncate">{cc.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-1.5">
            <Tag className="w-3.5 h-3.5 inline mr-1" />
            Automatyczne tagi
          </label>

          {formSelectedTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {formSelectedTags.map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                >
                  {tag.name}
                  <button onClick={() => onRemoveTag(tag.id)} className="hover:bg-black/10 rounded-full p-0.5 transition">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="relative">
            <input
              type="text"
              value={formTagSearch}
              onChange={(e) => { onTagSearchChange(e.target.value); setShowTagDropdown(true); }}
              onFocus={() => setShowTagDropdown(true)}
              onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)}
              placeholder="Szukaj tagow..."
              className="w-full px-3 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
            />
            {showTagDropdown && formTagSearch.trim() && filteredTags.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-dark-surface border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
                {filteredTags.slice(0, 8).map(tag => (
                  <button
                    key={tag.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onAddTag(tag)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-dark-surface-variant text-sm flex items-center gap-2 transition"
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="text-text-primary-light dark:text-text-primary-dark">{tag.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-700/50">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition"
          >
            Anuluj
          </button>
          <button
            onClick={onSave}
            disabled={saving || (!formNip.trim() && !formName.trim())}
            className="px-5 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition font-medium text-sm"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Zapisywanie...' : editing ? 'Zapisz zmiany' : 'Dodaj regule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RulesList({
  rules, searchQuery, currentUserId, isAdmin, onSearchChange, onEdit, onDelete, onToggleActive,
}: {
  rules: AutomationRule[];
  searchQuery: string;
  currentUserId: string | undefined;
  isAdmin: boolean;
  onSearchChange: (v: string) => void;
  onEdit: (rule: AutomationRule) => void;
  onDelete: (rule: AutomationRule) => void;
  onToggleActive: (rule: AutomationRule) => void;
}) {
  return (
    <div className="bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-text-primary-light dark:text-text-primary-dark whitespace-nowrap">
          Reguly automatyzacji ({rules.length})
        </h3>
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Szukaj po NIP lub nazwie..."
            className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-dark-surface-variant text-text-primary-light dark:text-text-primary-dark placeholder:text-text-secondary-light dark:placeholder:text-text-secondary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent"
          />
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Zap className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Brak regul automatyzacji. Dodaj pierwsza regule, aby automatycznie przetwarzac faktury.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-700/50">
          {rules.map(rule => {
            const canEdit = isAdmin || rule.created_by === currentUserId;
            return (
              <div
                key={rule.id}
                className={`px-5 py-4 flex items-start gap-4 group hover:bg-slate-50 dark:hover:bg-dark-surface-variant transition ${!rule.is_active ? 'opacity-50' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
                      {rule.supplier_name || 'Brak nazwy'}
                    </span>
                    {rule.supplier_nip && (
                      <span className="text-xs font-mono text-text-secondary-light dark:text-text-secondary-dark bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                        NIP: {rule.supplier_nip}
                      </span>
                    )}
                    {!rule.is_active && (
                      <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded">
                        Nieaktywna
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {rule.auto_accept && (
                      <span className="inline-flex items-center gap-1 text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-800/30">
                        <CheckCircle className="w-3 h-3" />
                        Auto-akceptacja
                      </span>
                    )}
                    {rule.department && (
                      <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/30">
                        <Building2 className="w-3 h-3" />
                        Dzial: {rule.department.name}
                      </span>
                    )}
                    {rule.cost_center && (
                      <span className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800/30">
                        <Hash className="w-3 h-3" />
                        MPK: {rule.cost_center.code}{rule.cost_center.description ? ` - ${rule.cost_center.description}` : ''}
                      </span>
                    )}
                    {rule.tags.map(tag => (
                      <span
                        key={tag.id}
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}30` }}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {!rule.auto_accept && !rule.department && !rule.cost_center && rule.tags.length === 0 && (
                      <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark italic">
                        Brak przypisanych akcji
                      </span>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={() => onToggleActive(rule)}
                      className={`p-1.5 rounded-lg transition ${rule.is_active ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                      title={rule.is_active ? 'Dezaktywuj' : 'Aktywuj'}
                    >
                      {rule.is_active ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => onEdit(rule)}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition"
                      title="Edytuj"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDelete(rule)}
                      className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition"
                      title="Usun"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
