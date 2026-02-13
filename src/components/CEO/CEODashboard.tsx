import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Upload, Filter, FileText, Calendar, Building2, CheckCircle, Download } from 'lucide-react';

interface Invoice {
  id: string;
  invoice_number: string | null;
  supplier_name: string | null;
  gross_amount: number | null;
  currency: string;
  issue_date: string | null;
  status: string;
  department: string | null;
  created_at: string;
  pln_gross_amount: number | null;
  exchange_rate: number | null;
}

interface CEODashboardProps {
  onUpload: () => void;
}

export default function CEODashboard({ onUpload }: CEODashboardProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [departments, setDepartments] = useState<string[]>([]);
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
      let query = supabase
        .from('invoices')
        .select(`
          *,
          department:department_id(id, name)
        `)
        .eq('status', 'accepted')
        .order('created_at', { ascending: false });

      const { data, error } = await query;

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
        .select('id, name')
        .order('name');

      if (error) throw error;

      const deptMap: {[key: string]: string} = {};
      data?.forEach(d => {
        deptMap[d.id] = d.name;
      });
      setDepartments(data?.map(d => d.name) || []);
    } catch (err) {
      console.error('Error loading departments:', err);
    }
  }

  const filteredInvoices = invoices.filter(inv => {
    const departmentMatch = selectedDepartment === 'all' || inv.department?.name === selectedDepartment;
    const yearMatch = selectedYear === 'all' || (inv.issue_date && new Date(inv.issue_date).getFullYear().toString() === selectedYear);
    const monthMatch = selectedMonth === 'all' || (inv.issue_date && (new Date(inv.issue_date).getMonth() + 1).toString() === selectedMonth);
    return departmentMatch && yearMatch && monthMatch;
  });

  const totalAmount = filteredInvoices.reduce((sum, inv) => sum + (inv.pln_gross_amount || inv.gross_amount || 0), 0);

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
              <h1 className="text-3xl font-bold text-slate-900">CEO Dashboard</h1>
            </div>
            <p className="text-slate-600">Overview of accepted invoices across departments</p>
          </div>
          <button
            onClick={onUpload}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg"
          >
            <Upload className="w-5 h-5" />
            Upload Invoice
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-sm font-medium text-slate-600">Accepted Invoices</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900">{filteredInvoices.length}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-sm font-medium text-slate-600">Total Value</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900">
              {totalAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Building2 className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="text-sm font-medium text-slate-600">Departments</h3>
            </div>
            <p className="text-3xl font-bold text-slate-900">{departments.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-slate-600" />
              <h2 className="text-lg font-semibold text-slate-900">Accepted Invoices</h2>
            </div>
            <div className="flex items-center gap-4">
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
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Status
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
                      <div className="flex flex-col gap-0.5">
                        <div>
                          <span className="font-semibold text-slate-900">
                            {invoice.gross_amount?.toLocaleString('pl-PL', { minimumFractionDigits: 2 }) || '0.00'}
                          </span>
                          <span className="text-sm text-slate-500 ml-1">{invoice.currency}</span>
                        </div>
                        {invoice.currency !== 'PLN' && invoice.pln_gross_amount && (
                          <div className="text-xs text-slate-500">
                            ≈ {invoice.pln_gross_amount.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        {invoice.issue_date
                          ? new Date(invoice.issue_date).toLocaleDateString()
                          : 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3" />
                        Accepted
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredInvoices.length === 0 && (
            <div className="px-6 py-12 text-center">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No accepted invoices found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
