import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Upload, Filter, FileText, Calendar, Building2, CheckCircle, Clock, XCircle, AlertCircle } from 'lucide-react';

interface Invoice {
  id: string;
  invoice_number: string | null;
  supplier_name: string | null;
  gross_amount: number | null;
  currency: string;
  issue_date: string | null;
  status: string;
  department: string | null;
  rejection_reason: string | null;
  created_at: string;
}

interface DyrektorDashboardProps {
  onUpload: () => void;
  onManageDepartments: () => void;
  onManageManagers: () => void;
}

export default function DyrektorDashboard({ onUpload, onManageDepartments, onManageManagers }: DyrektorDashboardProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [departments, setDepartments] = useState<string[]>([]);
  const [verifyingInvoice, setVerifyingInvoice] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  useEffect(() => {
    loadInvoices();
    loadDepartments();
  }, []);

  async function loadInvoices() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          department:department_id(id, name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInvoices(data || []);

      const years = Array.from(new Set(
        data?.filter(inv => inv.issue_date).map(inv => new Date(inv.issue_date).getFullYear()) || []
      ));
      setAvailableYears(years.sort((a, b) => b - a));
    } catch (err) {
      console.error('Error loading invoices:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadDepartments() {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('name')
        .order('name');

      if (error) throw error;
      setDepartments(data.map(d => d.name));
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  }

  async function handleAccept(invoiceId: string) {
    try {
      setError(null);
      const { error } = await supabase
        .from('invoices')
        .update({ status: 'accepted' })
        .eq('id', invoiceId);

      if (error) throw error;
      loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invoice');
    }
  }

  async function handleReject(invoiceId: string) {
    if (!rejectionReason.trim()) {
      setError('Rejection reason is required');
      return;
    }

    try {
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('invoices')
        .update({
          status: 'rejected',
          rejection_reason: rejectionReason.trim(),
          rejected_by: user?.id,
          rejected_at: new Date().toISOString()
        })
        .eq('id', invoiceId);

      if (error) throw error;

      setVerifyingInvoice(null);
      setRejectionReason('');
      loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject invoice');
    }
  }

  const filteredInvoices = invoices.filter(inv => {
    const departmentMatch = selectedDepartment === 'all' || inv.department?.name === selectedDepartment;
    const statusMatch = selectedStatus === 'all' || inv.status === selectedStatus;
    const yearMatch = selectedYear === 'all' || (inv.issue_date && new Date(inv.issue_date).getFullYear().toString() === selectedYear);
    const monthMatch = selectedMonth === 'all' || (inv.issue_date && (new Date(inv.issue_date).getMonth() + 1).toString() === selectedMonth);
    return departmentMatch && statusMatch && yearMatch && monthMatch;
  });

  const stats = {
    accepted: invoices.filter(i => i.status === 'accepted').length,
    pending: invoices.filter(i => i.status === 'pending' || i.status === 'in_review').length,
    rejected: invoices.filter(i => i.status === 'rejected').length,
  };

  function getStatusColor(status: string) {
    switch (status) {
      case 'accepted': return 'bg-green-100 text-green-800';
      case 'rejected': return 'bg-red-100 text-red-800';
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'in_review': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'accepted': return <CheckCircle className="w-3 h-3" />;
      case 'rejected': return <XCircle className="w-3 h-3" />;
      case 'pending': return <Clock className="w-3 h-3" />;
      case 'in_review': return <AlertCircle className="w-3 h-3" />;
      default: return null;
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case 'accepted': return 'Accepted';
      case 'rejected': return 'Rejected';
      case 'pending': return 'Pending';
      case 'in_review': return 'In Review';
      default: return status;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Building2 className="w-8 h-8 text-slate-700" />
              <h1 className="text-3xl font-bold text-slate-900">Director Dashboard</h1>
            </div>
            <p className="text-slate-600">Manage invoices, departments, and team members</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onManageDepartments}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-600 text-white font-medium rounded-lg hover:bg-slate-700 transition-all"
            >
              <Building2 className="w-4 h-4" />
              Departments
            </button>
            <button
              onClick={onManageManagers}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-600 text-white font-medium rounded-lg hover:bg-slate-700 transition-all"
            >
              Manager Limits
            </button>
            <button
              onClick={onUpload}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg"
            >
              <Upload className="w-5 h-5" />
              Upload Invoice
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">Error</h3>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-sm font-medium text-slate-600">Accepted</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900">{stats.accepted}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
              <h3 className="text-sm font-medium text-slate-600">To Verify</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900">{stats.pending}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-red-100 rounded-lg">
                <XCircle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-sm font-medium text-slate-600">Rejected</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900">{stats.rejected}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-slate-600" />
              <h2 className="text-lg font-semibold text-slate-900">Invoices</h2>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">Dział:</label>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Wszystkie</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">Status:</label>
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Wszystkie</option>
                  <option value="accepted">Zaakceptowane</option>
                  <option value="pending">Oczekujące</option>
                  <option value="in_review">Do weryfikacji</option>
                  <option value="rejected">Odrzucone</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">Rok:</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Wszystkie</option>
                  {availableYears.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-700">Miesiąc:</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">Wszystkie</option>
                  <option value="1">Styczeń</option>
                  <option value="2">Luty</option>
                  <option value="3">Marzec</option>
                  <option value="4">Kwiecień</option>
                  <option value="5">Maj</option>
                  <option value="6">Czerwiec</option>
                  <option value="7">Lipiec</option>
                  <option value="8">Sierpień</option>
                  <option value="9">Wrzesień</option>
                  <option value="10">Październik</option>
                  <option value="11">Listopad</option>
                  <option value="12">Grudzień</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Invoice #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Department
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-slate-400" />
                        <span className="font-medium text-slate-900">
                          {invoice.invoice_number || 'N/A'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {invoice.supplier_name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        <Building2 className="w-3 h-3" />
                        {invoice.department?.name || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-slate-900">
                        {invoice.gross_amount?.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) || '0.00'}
                      </span>
                      <span className="text-sm text-slate-500 ml-1">{invoice.currency}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}>
                        {getStatusIcon(invoice.status)}
                        {getStatusLabel(invoice.status)}
                      </span>
                      {invoice.rejection_reason && (
                        <p className="text-xs text-red-600 mt-1">{invoice.rejection_reason}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {(invoice.status === 'pending' || invoice.status === 'in_review') && (
                        <div className="flex items-center justify-end gap-2">
                          {verifyingInvoice === invoice.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="Rejection reason..."
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                              />
                              <button
                                onClick={() => handleReject(invoice.id)}
                                className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => {
                                  setVerifyingInvoice(null);
                                  setRejectionReason('');
                                  setError(null);
                                }}
                                className="px-3 py-1.5 text-slate-600 text-sm font-medium hover:text-slate-900 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => handleAccept(invoice.id)}
                                className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => setVerifyingInvoice(invoice.id)}
                                className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredInvoices.length === 0 && (
            <div className="px-6 py-12 text-center">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No invoices found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
