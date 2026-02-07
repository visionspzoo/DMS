import { useState, useEffect } from 'react';
import {
  Building2,
  ArrowDown,
  ArrowUp,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  CreditCard,
  Users,
  ChevronDown,
  ChevronRight,
  GitBranch,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Department {
  id: string;
  name: string;
  parent_department_id: string | null;
  manager_id: string | null;
  max_invoice_amount: number | null;
  max_monthly_amount: number | null;
  manager?: { full_name: string; email: string } | null;
}

interface TreeNode {
  dept: Department;
  children: TreeNode[];
  memberCount: number;
}

function buildTree(departments: Department[], memberCounts: Record<string, number>): TreeNode[] {
  const getChildren = (parentId: string): TreeNode[] => {
    return departments
      .filter(d => d.parent_department_id === parentId)
      .map(d => ({
        dept: d,
        children: getChildren(d.id),
        memberCount: memberCounts[d.id] || 0,
      }));
  };

  return departments
    .filter(d => !d.parent_department_id)
    .map(d => ({
      dept: d,
      children: getChildren(d.id),
      memberCount: memberCounts[d.id] || 0,
    }));
}

function NodeCard({ node }: { node: TreeNode }) {
  const hasLimit = node.dept.max_invoice_amount || node.dept.max_monthly_amount;

  return (
    <div className="bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg p-3 min-w-[160px] max-w-[200px] shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="p-1.5 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-md flex-shrink-0">
          <Building2 className="w-3.5 h-3.5 text-brand-primary" />
        </div>
        <span className="text-xs font-bold text-text-primary-light dark:text-text-primary-dark truncate">
          {node.dept.name}
        </span>
      </div>

      {node.dept.manager && (
        <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark mb-1 truncate">
          {node.dept.manager.full_name}
        </div>
      )}

      <div className="flex items-center gap-2 mt-1.5">
        <div className="flex items-center gap-1">
          <Users className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
          <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
            {node.memberCount}
          </span>
        </div>
        {hasLimit && (
          <div className="flex items-center gap-1">
            <CreditCard className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
            <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
              {node.dept.max_invoice_amount
                ? `${(node.dept.max_invoice_amount / 1000).toFixed(0)}k`
                : '-'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function TreeBranch({ nodes }: { nodes: TreeNode[] }) {
  if (nodes.length === 0) return null;

  return (
    <div className="flex justify-center gap-6">
      {nodes.map(node => (
        <div key={node.dept.id} className="flex flex-col items-center">
          <NodeCard node={node} />

          {node.children.length > 0 && (
            <div className="flex flex-col items-center">
              <div className="w-px h-5 bg-slate-300 dark:bg-slate-600" />

              {node.children.length === 1 ? (
                <TreeBranch nodes={node.children} />
              ) : (
                <div className="flex">
                  {node.children.map((child, i) => (
                    <div
                      key={child.dept.id}
                      className="relative flex flex-col items-center px-3"
                    >
                      {node.children.length > 1 && (
                        <div
                          className={`absolute top-0 h-px bg-slate-300 dark:bg-slate-600 ${
                            i === 0
                              ? 'left-1/2 right-0'
                              : i === node.children.length - 1
                              ? 'left-0 right-1/2'
                              : 'left-0 right-0'
                          }`}
                        />
                      )}
                      <div className="w-px h-5 bg-slate-300 dark:bg-slate-600" />
                      <TreeBranch nodes={[child]} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const statusSteps = [
  {
    key: 'upload',
    label: 'Przeslanie',
    icon: FileText,
    color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600',
  },
  {
    key: 'draft',
    label: 'Robocza',
    icon: FileText,
    color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600',
  },
  {
    key: 'waiting',
    label: 'Oczekujaca',
    icon: Clock,
    color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700',
  },
  {
    key: 'pending',
    label: 'W weryfikacji',
    icon: Send,
    color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700',
  },
  {
    key: 'accepted',
    label: 'Zaakceptowana',
    icon: CheckCircle2,
    color: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700',
  },
  {
    key: 'paid',
    label: 'Oplacona',
    icon: CreditCard,
    color: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700',
  },
];

function DocumentFlowDiagram() {
  return (
    <div className="space-y-4">
      <div className="flex items-center flex-wrap gap-2 justify-center">
        {statusSteps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={step.key} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border ${step.color}`}>
                <Icon className="w-3.5 h-3.5" />
                <span className="text-xs font-medium whitespace-nowrap">{step.label}</span>
              </div>
              {i < statusSteps.length - 1 && (
                <ArrowDown className="w-4 h-4 text-slate-400 dark:text-slate-500 rotate-[-90deg]" />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-center">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-700">
          <XCircle className="w-3.5 h-3.5" />
          <span className="text-xs font-medium">Odrzucona</span>
        </div>
        <div className="flex items-center ml-2">
          <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
            (mozliwa na etapie weryfikacji)
          </span>
        </div>
      </div>
    </div>
  );
}

function EscalationDiagram() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-1">
          <div className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700/50 bg-light-surface-variant dark:bg-dark-surface-variant">
            <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
              Dzial podrzedny
            </span>
          </div>
          <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
            Limit: 5 000 PLN
          </span>
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <ArrowUp className="w-4 h-4 text-amber-500" />
          <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">
            Eskalacja
          </span>
          <span className="text-[9px] text-text-secondary-light dark:text-text-secondary-dark">
            ponad limit
          </span>
        </div>

        <div className="flex flex-col items-center gap-1">
          <div className="px-3 py-2 rounded-lg border-2 border-brand-primary/30 bg-brand-primary/5 dark:bg-brand-primary/10">
            <span className="text-xs font-medium text-text-primary-light dark:text-text-primary-dark">
              Dzial nadrzedny
            </span>
          </div>
          <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
            Limit: 50 000 PLN
          </span>
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <ArrowDown className="w-4 h-4 text-green-500 rotate-[-90deg]" />
          <span className="text-[9px] text-green-600 dark:text-green-400 font-medium">
            Akceptacja
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
          <span className="text-xs font-medium text-green-700 dark:text-green-400">Zatwierdzona</span>
        </div>
      </div>
    </div>
  );
}

export default function DepartmentFlowChart({ departments }: { departments: Department[] }) {
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showTree, setShowTree] = useState(true);
  const [showFlow, setShowFlow] = useState(true);

  useEffect(() => {
    loadMemberCounts();
  }, [departments]);

  const loadMemberCounts = async () => {
    try {
      const { data, error } = await supabase
        .from('department_members')
        .select('department_id');

      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach(row => {
        counts[row.department_id] = (counts[row.department_id] || 0) + 1;
      });
      setMemberCounts(counts);
    } catch (err) {
      console.error('Error loading member counts:', err);
    } finally {
      setLoading(false);
    }
  };

  const tree = buildTree(departments, memberCounts);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-primary" />
      </div>
    );
  }

  if (departments.length === 0) {
    return (
      <div className="text-center py-8 text-text-secondary-light dark:text-text-secondary-dark text-xs">
        Brak dzialow do wyswietlenia. Dodaj dzialy aby zobaczyc schemat.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <button
          onClick={() => setShowTree(!showTree)}
          className="w-full px-3 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between"
        >
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Schemat struktury organizacyjnej
            </h2>
          </div>
          {showTree ? (
            <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          )}
        </button>

        {showTree && (
          <div className="p-4 overflow-x-auto">
            <div className="min-w-fit flex justify-center">
              <TreeBranch nodes={tree} />
            </div>

            <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-slate-200 dark:border-slate-700/50">
              <div className="flex items-center gap-1.5">
                <Building2 className="w-3 h-3 text-brand-primary" />
                <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">Dzial</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Users className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">Liczba czlonkow</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CreditCard className="w-3 h-3 text-text-secondary-light dark:text-text-secondary-dark" />
                <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">Limit faktury</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <button
          onClick={() => setShowFlow(!showFlow)}
          className="w-full px-3 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between"
        >
          <div className="flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Model przeplywu dokumentow
            </h2>
          </div>
          {showFlow ? (
            <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          )}
        </button>

        {showFlow && (
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-3 text-center">
                Cykl zycia faktury
              </h3>
              <DocumentFlowDiagram />
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <h3 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-3 text-center">
                Mechanizm eskalacji miedzydzialowej
              </h3>
              <EscalationDiagram />
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ArrowDown className="w-3 h-3 text-blue-500" />
                    <span className="text-[11px] font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Przydzial
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
                    Faktura trafia do dzialu na podstawie NIP dostawcy lub recznego przypisania
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ArrowUp className="w-3 h-3 text-amber-500" />
                    <span className="text-[11px] font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Eskalacja
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
                    Gdy kwota przekracza limit dzialu, faktura jest przekazywana do dzialu nadrzednego
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                    <span className="text-[11px] font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Zatwierdzenie
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
                    Kierownik dzialu zatwierdza fakture w ramach swojego limitu kwotowego
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
