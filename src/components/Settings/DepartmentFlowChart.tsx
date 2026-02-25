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
  PenTool,
  UserCheck,
  Briefcase,
  Crown,
  ScrollText,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Department {
  id: string;
  name: string;
  parent_department_id: string | null;
  manager_id: string | null;
  director_id: string | null;
  max_invoice_amount: number | null;
  max_monthly_amount: number | null;
  manager?: { full_name: string; email: string } | null;
  director?: { full_name: string; email: string } | null;
}

interface DeptMember {
  user_id: string;
  full_name: string;
  role: string;
}

interface TreeNode {
  dept: Department;
  children: TreeNode[];
  memberCount: number;
  workflowDirectors: DeptMember[];
  allMembers: DeptMember[];
}

function buildTree(
  departments: Department[],
  memberCounts: Record<string, number>,
  workflowDirectorsMap: Record<string, DeptMember[]>,
  allMembersMap: Record<string, DeptMember[]>
): TreeNode[] {
  const getChildren = (parentId: string): TreeNode[] => {
    return departments
      .filter(d => d.parent_department_id === parentId)
      .map(d => ({
        dept: d,
        children: getChildren(d.id),
        memberCount: memberCounts[d.id] || 0,
        workflowDirectors: workflowDirectorsMap[d.id] || [],
        allMembers: allMembersMap[d.id] || [],
      }));
  };

  return departments
    .filter(d => !d.parent_department_id)
    .map(d => ({
      dept: d,
      children: getChildren(d.id),
      memberCount: memberCounts[d.id] || 0,
      workflowDirectors: workflowDirectorsMap[d.id] || [],
      allMembers: allMembersMap[d.id] || [],
    }));
}

function MembersModal({ node, onClose }: { node: TreeNode; onClose: () => void }) {
  const roleLabel: Record<string, string> = {
    Dyrektor: 'Dyrektor',
    Kierownik: 'Kierownik',
    Specjalista: 'Specjalista',
    admin: 'Admin',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-xl border border-slate-200 dark:border-slate-700/50 w-80 max-h-[480px] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-brand-primary" />
            <span className="font-semibold text-sm text-text-primary-light dark:text-text-primary-dark">
              {node.dept.name}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary-light dark:text-text-secondary-dark hover:text-text-primary-light dark:hover:text-text-primary-dark transition-colors"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          {node.dept.director && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-orange-500 dark:text-orange-400 mb-1.5">
                Dyrektor
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 rounded-lg">
                <Crown className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 flex-shrink-0" />
                <span className="text-xs font-medium text-orange-800 dark:text-orange-300">
                  {node.dept.director.full_name}
                </span>
              </div>
            </div>
          )}

          {node.workflowDirectors.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-500 dark:text-sky-400 mb-1.5">
                Dyrektorzy w obiegu
              </div>
              <div className="space-y-1">
                {node.workflowDirectors.map(m => (
                  <div key={m.user_id} className="flex items-center gap-2 px-3 py-2 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/50 rounded-lg">
                    <UserCheck className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-sky-800 dark:text-sky-300">
                      {m.full_name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {node.dept.manager && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                Kierownik
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-lg">
                <Briefcase className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {node.dept.manager.full_name}
                </span>
              </div>
            </div>
          )}

          {node.allMembers.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                Członkowie
              </div>
              <div className="space-y-1">
                {node.allMembers.map(m => (
                  <div key={m.user_id} className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700/50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      <span className="text-xs text-slate-700 dark:text-slate-300">{m.full_name}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {roleLabel[m.role] ?? m.role}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!node.dept.director && !node.dept.manager && node.allMembers.length === 0 && node.workflowDirectors.length === 0 && (
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark text-center py-4">
              Brak przypisanych osób
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NodeCard({ node }: { node: TreeNode }) {
  const [showModal, setShowModal] = useState(false);
  const hasLimit = node.dept.max_invoice_amount || node.dept.max_monthly_amount;

  return (
    <>
      {showModal && <MembersModal node={node} onClose={() => setShowModal(false)} />}

      <div className="flex flex-col items-center gap-2">
        <button
          onClick={() => setShowModal(true)}
          className="bg-light-surface dark:bg-dark-surface border border-slate-200 dark:border-slate-700/50 rounded-lg p-3 min-w-[160px] max-w-[200px] shadow-sm hover:shadow-md hover:border-brand-primary/40 dark:hover:border-brand-primary/40 transition-all text-left group"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className="p-1.5 bg-brand-primary/10 dark:bg-brand-primary/20 rounded-md flex-shrink-0">
              <Building2 className="w-3.5 h-3.5 text-brand-primary" />
            </div>
            <span className="text-xs font-bold text-text-primary-light dark:text-text-primary-dark truncate flex-1">
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
            <div className="ml-auto opacity-0 group-hover:opacity-60 transition-opacity">
              <Users className="w-3 h-3 text-brand-primary" />
            </div>
          </div>
        </button>
      </div>
    </>
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
              <div className="w-px h-6 bg-slate-300 dark:bg-slate-600" />

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

const contractSteps = [
  {
    key: 'draft',
    label: 'Szkic',
    sublabel: 'Autor',
    icon: FileText,
    color: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-600',
    ringColor: 'ring-slate-300 dark:ring-slate-600',
  },
  {
    key: 'pending_specialist',
    label: 'Specjalista',
    sublabel: 'Weryfikacja',
    icon: UserCheck,
    color: 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-400 border-sky-300 dark:border-sky-700',
    ringColor: 'ring-sky-300 dark:ring-sky-600',
  },
  {
    key: 'pending_manager',
    label: 'Kierownik',
    sublabel: 'Akceptacja',
    icon: Briefcase,
    color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700',
    ringColor: 'ring-amber-300 dark:ring-amber-600',
  },
  {
    key: 'pending_director',
    label: 'Dyrektor',
    sublabel: 'Akceptacja',
    icon: Crown,
    color: 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700',
    ringColor: 'ring-orange-300 dark:ring-orange-600',
  },
  {
    key: 'pending_ceo',
    label: 'CEO',
    sublabel: 'Zatwierdzenie',
    icon: Crown,
    color: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700',
    ringColor: 'ring-blue-300 dark:ring-blue-600',
  },
  {
    key: 'pending_signature',
    label: 'Do podpisu',
    sublabel: 'CEO',
    icon: PenTool,
    color: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 border-teal-300 dark:border-teal-700',
    ringColor: 'ring-teal-300 dark:ring-teal-600',
  },
  {
    key: 'signed',
    label: 'Podpisana',
    sublabel: 'Zakonczona',
    icon: CheckCircle2,
    color: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700',
    ringColor: 'ring-green-300 dark:ring-green-600',
  },
];

function ContractFlowDiagram() {
  return (
    <div className="space-y-5">
      <div className="relative">
        <div className="absolute top-1/2 left-8 right-8 h-px bg-slate-200 dark:bg-slate-700 -translate-y-1/2 hidden md:block" />

        <div className="flex flex-col md:flex-row items-center md:justify-between gap-3 md:gap-1 relative">
          {contractSteps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center gap-2 md:gap-0 md:flex-col">
                <div className={`relative z-10 flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border ${step.color} min-w-[100px] text-center shadow-sm`}>
                  <div className={`p-1.5 rounded-full ring-2 ${step.ringColor} bg-white dark:bg-slate-900`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold whitespace-nowrap">{step.label}</span>
                  <span className="text-[9px] opacity-70 -mt-1">{step.sublabel}</span>
                </div>
                {i < contractSteps.length - 1 && (
                  <ArrowDown className="w-4 h-4 text-slate-400 dark:text-slate-500 rotate-[-90deg] md:hidden" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <div className="h-px w-8 bg-red-300 dark:bg-red-700" />
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 shadow-sm">
            <XCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            <span className="text-xs font-semibold text-red-700 dark:text-red-400">Odrzucona</span>
          </div>
          <div className="h-px w-8 bg-red-300 dark:bg-red-700" />
        </div>
        <div className="flex items-center gap-1">
          <ArrowUp className="w-3 h-3 text-red-400 rotate-180" />
          <span className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
            Wraca do szkicu na kazdym etapie akceptacji
          </span>
        </div>
      </div>
    </div>
  );
}

function ContractApprovalChain() {
  const roles = [
    { label: 'Specjalista', desc: 'Sprawdza poprawnosc formalna', color: 'border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-900/20', icon: UserCheck, iconColor: 'text-sky-600 dark:text-sky-400' },
    { label: 'Kierownik', desc: 'Weryfikuje merytorycznie', color: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20', icon: Briefcase, iconColor: 'text-amber-600 dark:text-amber-400' },
    { label: 'Dyrektor', desc: 'Zatwierdzenie strategiczne', color: 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20', icon: Crown, iconColor: 'text-orange-600 dark:text-orange-400' },
    { label: 'CEO', desc: 'Finalna akceptacja i podpis', color: 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20', icon: Crown, iconColor: 'text-blue-600 dark:text-blue-400' },
  ];

  return (
    <div className="flex flex-col items-center gap-0">
      {roles.map((role, i) => {
        const Icon = role.icon;
        return (
          <div key={role.label} className="flex flex-col items-center">
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${role.color} min-w-[220px]`}>
              <div className="flex-shrink-0">
                <Icon className={`w-4 h-4 ${role.iconColor}`} />
              </div>
              <div>
                <div className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark">
                  {role.label}
                </div>
                <div className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark">
                  {role.desc}
                </div>
              </div>
            </div>
            {i < roles.length - 1 && (
              <div className="flex flex-col items-center">
                <div className="w-px h-2 bg-slate-300 dark:bg-slate-600" />
                <ArrowDown className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                <div className="w-px h-2 bg-slate-300 dark:bg-slate-600" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function DepartmentFlowChart({ departments }: { departments: Department[] }) {
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [workflowDirectorsMap, setWorkflowDirectorsMap] = useState<Record<string, DeptMember[]>>({});
  const [allMembersMap, setAllMembersMap] = useState<Record<string, DeptMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showTree, setShowTree] = useState(true);
  const [showFlow, setShowFlow] = useState(true);
  const [showContractFlow, setShowContractFlow] = useState(true);

  useEffect(() => {
    loadMemberData();
  }, [departments]);

  const loadMemberData = async () => {
    try {
      const { data, error } = await supabase
        .from('department_members')
        .select('department_id, user_id, user:user_id(id, full_name, role)');

      if (error) throw error;

      const counts: Record<string, number> = {};
      const wdMap: Record<string, DeptMember[]> = {};
      const amMap: Record<string, DeptMember[]> = {};

      const deptDirectorMap: Record<string, string | null> = {};
      departments.forEach(d => {
        deptDirectorMap[d.id] = d.director_id;
      });

      data?.forEach((row: { department_id: string; user_id: string; user: { id: string; full_name: string; role: string } | null }) => {
        if (!row.user) return;
        counts[row.department_id] = (counts[row.department_id] || 0) + 1;

        const formalDirectorId = deptDirectorMap[row.department_id];
        const member: DeptMember = {
          user_id: row.user_id,
          full_name: row.user.full_name,
          role: row.user.role,
        };

        if (row.user_id !== formalDirectorId) {
          if (row.user.role === 'Dyrektor') {
            if (!wdMap[row.department_id]) wdMap[row.department_id] = [];
            wdMap[row.department_id].push(member);
          } else {
            if (!amMap[row.department_id]) amMap[row.department_id] = [];
            amMap[row.department_id].push(member);
          }
        }
      });

      setMemberCounts(counts);
      setWorkflowDirectorsMap(wdMap);
      setAllMembersMap(amMap);
    } catch (err) {
      console.error('Error loading member counts:', err);
    } finally {
      setLoading(false);
    }
  };

  const tree = buildTree(departments, memberCounts, workflowDirectorsMap, allMembersMap);

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

      <div className="bg-light-surface dark:bg-dark-surface rounded-lg shadow-sm border border-slate-200 dark:border-slate-700/50 overflow-hidden">
        <button
          onClick={() => setShowContractFlow(!showContractFlow)}
          className="w-full px-3 py-2 bg-light-surface-variant dark:bg-dark-surface-variant border-b border-slate-200 dark:border-slate-700/50 flex items-center justify-between"
        >
          <div className="flex items-center gap-1.5">
            <ScrollText className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
            <h2 className="text-sm font-semibold text-text-primary-light dark:text-text-primary-dark">
              Model przeplywu umowy
            </h2>
          </div>
          {showContractFlow ? (
            <ChevronDown className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-secondary-light dark:text-text-secondary-dark" />
          )}
        </button>

        {showContractFlow && (
          <div className="p-4 space-y-6">
            <div>
              <h3 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-4 text-center">
                Cykl zycia umowy
              </h3>
              <ContractFlowDiagram />
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-4">
              <h3 className="text-xs font-semibold text-text-primary-light dark:text-text-primary-dark mb-4 text-center">
                Lancuch akceptacji
              </h3>
              <ContractApprovalChain />
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700/50 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Send className="w-3 h-3 text-blue-500" />
                    <span className="text-[11px] font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Sekwencyjna akceptacja
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
                    Umowa przechodzi kolejno przez specjaliste, kierownika, dyrektora i CEO. Kazda rola musi zatwierdzic przed przekazaniem dalej.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant">
                  <div className="flex items-center gap-1.5 mb-1">
                    <XCircle className="w-3 h-3 text-red-500" />
                    <span className="text-[11px] font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Odrzucenie
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
                    Na kazdym etapie akceptacji osoba weryfikujaca moze odrzucic umowe. Odrzucona umowa wraca do statusu szkicu.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant">
                  <div className="flex items-center gap-1.5 mb-1">
                    <PenTool className="w-3 h-3 text-teal-500" />
                    <span className="text-[11px] font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Podpis
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
                    Po zatwierdzeniu przez CEO umowa trafia do podpisu. Tylko CEO moze zlozyc finalny podpis zamykajacy proces.
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-light-surface-variant dark:bg-dark-surface-variant">
                  <div className="flex items-center gap-1.5 mb-1">
                    <FileText className="w-3 h-3 text-slate-500" />
                    <span className="text-[11px] font-semibold text-text-primary-light dark:text-text-primary-dark">
                      Audyt
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary-light dark:text-text-secondary-dark leading-relaxed">
                    Kazda akceptacja i odrzucenie jest rejestrowane z komentarzem, data i osoba podejmujaca decyzje.
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
