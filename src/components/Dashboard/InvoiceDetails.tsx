import { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, MessageSquare, User, Calendar, DollarSign, FileText, ExternalLink, Edit2, Save, Clock, Trash2, CreditCard, ArrowRight, Undo2, Upload, Mail, HardDrive, FileCheck, RefreshCw, AlertTriangle, Download, ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import type { Database } from '../../lib/database.types';
import { InvoiceTags } from './InvoiceTags';
import { getAccessibleDepartments } from '../../lib/departmentUtils';
import { TransferInvoiceModal } from './TransferInvoiceModal';

const AURA_HERBALS_NIP = '5851490834';

type Invoice = Database['public']['Tables']['invoices']['Row'];
type Approval = Database['public']['Tables']['approvals']['Row'];
type AuditLog = Database['public']['Tables']['audit_logs']['Row'];
type InvoiceDepartment = Database['public']['Tables']['invoice_departments']['Row'];

interface InvoiceDetailsProps {
  invoice: Invoice;
  onClose: () => void;
  onUpdate: () => void;
}

interface ApprovalWithProfile extends Approval {
  approver: {
    full_name: string;
    role: string;
  };
}

interface AuditLogWithUser extends AuditLog {
  user?: {
    full_name: string;
    role: string;
  } | null;
}

const statusLabels: Record<string, string> = {
  draft: 'Robocze',
  waiting: 'Oczekujące',
  in_review: 'W weryfikacji',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  paid: 'Opłacona',
};

function getUserSpecificStatus(invoice: Invoice, currentUserId: string): string {
  if (invoice.status === 'draft') return 'draft';
  if (invoice.status === 'accepted') return 'accepted';
  if (invoice.status === 'rejected') return 'rejected';
  if (invoice.status === 'paid') return 'paid';

  if (invoice.status === 'waiting') {
    if (invoice.current_approver_id === currentUserId) {
      return 'waiting';
    }
    if (invoice.uploaded_by === currentUserId) {
      return 'in_review';
    }
    return 'in_review';
  }

  return invoice.status;
}

export function InvoiceDetails({ invoice, onClose, onUpdate }: InvoiceDetailsProps) {
  const { user, profile } = useAuth();
  const [currentInvoice, setCurrentInvoice] = useState<Invoice>(invoice);
  const [approvals, setApprovals] = useState<ApprovalWithProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogWithUser[]>([]);
  const [invoiceDepartments, setInvoiceDepartments] = useState<InvoiceDepartment[]>([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedInvoice, setEditedInvoice] = useState<Partial<Invoice>>({
    ...currentInvoice,
    supplier_name: currentInvoice.supplier_name?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
    supplier_nip: currentInvoice.supplier_nip?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
  });
  const [availableDepartments, setAvailableDepartments] = useState<{id: string, name: string}[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPaidConfirm, setShowPaidConfirm] = useState(false);
  const [isFromKSEF, setIsFromKSEF] = useState(false);
  const [ksefInvoiceId, setKsefInvoiceId] = useState<string | null>(null);
  const [showUnassignKSEFConfirm, setShowUnassignKSEFConfirm] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [ksefPdfBase64, setKsefPdfBase64] = useState<string | null>(null);
  const [loadingKsefPdf, setLoadingKsefPdf] = useState(false);
  const [pdfLoadAttempted, setPdfLoadAttempted] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [costCenters, setCostCenters] = useState<Array<{id: string, code: string, description: string, is_active: boolean}>>([]);
  const [costCenterSearch, setCostCenterSearch] = useState('');
  const [showCostCenterDropdown, setShowCostCenterDropdown] = useState(false);
  const [duplicateInvoices, setDuplicateInvoices] = useState<Array<{id: string, invoice_number: string, created_at: string}>>([]);
  const [invoiceDepartmentInfo, setInvoiceDepartmentInfo] = useState<{director_id: string | null, uploader_role: string | null} | null>(null);
  const [showAdminRejectModal, setShowAdminRejectModal] = useState(false);
  const [adminRejectComment, setAdminRejectComment] = useState('');

  const isInvalidSupplier = currentInvoice.supplier_nip === AURA_HERBALS_NIP ||
    (currentInvoice.supplier_nip?.includes('[BŁĄD]')) ||
    (currentInvoice.supplier_name?.includes('[BŁĄD'));

  const isInvalidBuyer = currentInvoice.buyer_nip &&
    currentInvoice.buyer_nip.replace(/[^0-9]/g, '') !== AURA_HERBALS_NIP &&
    currentInvoice.buyer_nip.replace(/[^0-9]/g, '') !== '8222407812';

  const isDuplicate = duplicateInvoices.length > 0;

  const loadPdfAndKsefIfNeeded = async () => {
    let resolvedPdfBase64 = currentInvoice.pdf_base64;

    if (!resolvedPdfBase64) {
      const { data } = await supabase
        .from('invoices')
        .select('pdf_base64')
        .eq('id', currentInvoice.id)
        .maybeSingle();
      if (data?.pdf_base64) {
        resolvedPdfBase64 = data.pdf_base64;
        setCurrentInvoice(prev => ({ ...prev, pdf_base64: data.pdf_base64 }));
      }
    }

    if (!resolvedPdfBase64 && !currentInvoice.file_url && currentInvoice.source === 'ksef') {
      setLoadingKsefPdf(true);
      try {
        const pdf = await fetchKsefPdf();
        if (pdf) {
          setKsefPdfBase64(pdf);
          await supabase.from('invoices').update({ pdf_base64: pdf }).eq('id', currentInvoice.id);
        }
      } catch (error) {
        console.error('Error loading KSEF PDF:', error);
      } finally {
        setLoadingKsefPdf(false);
        setPdfLoadAttempted(true);
      }
    }
  };

  useEffect(() => {
    loadApprovals();
    loadAuditLogs();
    loadDepartments();
    loadInvoiceDepartments();
    checkIfFromKSEF();
    loadPdfAndKsefIfNeeded();
    loadCostCenters();
    checkDuplicates();
    loadInvoiceDepartmentInfo();
  }, [currentInvoice.id]);

  const checkDuplicates = async () => {
    try {
      if (!currentInvoice.invoice_number) {
        setDuplicateInvoices([]);
        return;
      }

      let query = supabase
        .from('invoices')
        .select('id, invoice_number, created_at')
        .eq('invoice_number', currentInvoice.invoice_number)
        .neq('id', currentInvoice.id);

      if (currentInvoice.supplier_nip) {
        const cleanNip = currentInvoice.supplier_nip.replace(/[^0-9]/g, '');
        query = query.ilike('supplier_nip', `%${cleanNip}%`);
      } else if (currentInvoice.supplier_name) {
        const cleanName = currentInvoice.supplier_name.replace(/\[BŁĄD[^\]]*\]\s*/g, '').trim();
        query = query.ilike('supplier_name', `%${cleanName}%`);
      } else {
        setDuplicateInvoices([]);
        return;
      }

      const { data, error } = await query;

      if (error) throw error;

      setDuplicateInvoices(data || []);
    } catch (error) {
      console.error('Error checking duplicates:', error);
      setDuplicateInvoices([]);
    }
  };

  const checkIfFromKSEF = async () => {
    try {
      const ksefReferenceNumber = (invoice as any).ksef_reference_number;

      if (ksefReferenceNumber) {
        const { data, error } = await supabase
          .from('ksef_invoices')
          .select('id')
          .eq('ksef_reference_number', ksefReferenceNumber)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          setIsFromKSEF(true);
          setKsefInvoiceId(data.id);
        }
      } else {
        const { data, error } = await supabase
          .from('ksef_invoices')
          .select('id')
          .eq('transferred_to_invoice_id', currentInvoice.id)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          setIsFromKSEF(true);
          setKsefInvoiceId(data.id);
        }
      }
    } catch (error) {
      console.error('Error checking if invoice is from KSEF:', error);
    }
  };

  const fetchKsefPdf = async (): Promise<string | null> => {
    const { data: ksefRecord } = await supabase
      .from('ksef_invoices')
      .select('xml_content, ksef_reference_number, pdf_base64')
      .eq('transferred_to_invoice_id', currentInvoice.id)
      .maybeSingle();

    if (!ksefRecord) return null;

    if (ksefRecord.pdf_base64) return ksefRecord.pdf_base64;

    if (ksefRecord.ksef_reference_number) {
      try {
        const ksefProxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ksef-proxy`;
        const pdfParams = new URLSearchParams({
          path: `/api/external/invoices/${encodeURIComponent(ksefRecord.ksef_reference_number)}/pdf`,
        });
        const pdfResponse = await fetch(`${ksefProxyUrl}?${pdfParams}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
        });
        if (pdfResponse.ok) {
          const pdfBlob = await pdfResponse.blob();
          const pdfArrayBuffer = await pdfBlob.arrayBuffer();
          const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfArrayBuffer)));
          console.log(`PDF downloaded from KSEF API (${pdfBlob.size} bytes)`);
          await supabase
            .from('ksef_invoices')
            .update({ pdf_base64: pdfBase64 })
            .eq('transferred_to_invoice_id', currentInvoice.id);
          return pdfBase64;
        } else {
          console.warn(`PDF download from KSEF API failed (${pdfResponse.status}), trying XML generation`);
        }
      } catch (e) {
        console.error('PDF fetch from KSEF API failed:', e);
      }
    }

    if (ksefRecord.xml_content && ksefRecord.ksef_reference_number) {
      try {
        const genResponse = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-ksef-pdf`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              xml: ksefRecord.xml_content,
              ksefNumber: ksefRecord.ksef_reference_number,
            }),
          }
        );
        if (genResponse.ok) {
          const pdfArrayBuffer = await genResponse.arrayBuffer();
          const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfArrayBuffer)));
          console.log(`PDF generated from XML (${pdfArrayBuffer.byteLength} bytes)`);
          await supabase
            .from('ksef_invoices')
            .update({ pdf_base64: pdfBase64 })
            .eq('transferred_to_invoice_id', currentInvoice.id);
          return pdfBase64;
        } else {
          console.warn(`PDF generation from XML failed (${genResponse.status})`);
        }
      } catch (e) {
        console.error('PDF generation from XML failed:', e);
      }
    }

    return null;
  };

  const loadKsefPdfIfNeeded = async () => {
    if (currentInvoice.pdf_base64 || currentInvoice.file_url) return;
    if (currentInvoice.source !== 'ksef') return;

    setLoadingKsefPdf(true);
    try {
      const pdf = await fetchKsefPdf();
      if (pdf) {
        setKsefPdfBase64(pdf);
        await supabase.from('invoices').update({ pdf_base64: pdf }).eq('id', currentInvoice.id);
      }
    } catch (error) {
      console.error('Error loading KSEF PDF:', error);
    } finally {
      setLoadingKsefPdf(false);
      setPdfLoadAttempted(true);
    }
  };

  const handleGenerateKsefPdf = async () => {
    setGeneratingPdf(true);
    try {
      const pdf = await fetchKsefPdf();
      if (pdf) {
        setKsefPdfBase64(pdf);
        await supabase.from('invoices').update({ pdf_base64: pdf }).eq('id', currentInvoice.id);
        onUpdate();
      } else {
        alert('Nie udalo sie wygenerowac PDF. Sprobuj ponownie pozniej.');
      }
    } catch (error) {
      console.error('Error generating KSEF PDF:', error);
      alert('Wystapil blad podczas generowania PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const loadApprovals = async () => {
    try {
      const { data, error } = await supabase
        .from('approvals')
        .select(`
          *,
          approver:approver_id(full_name, role)
        `)
        .eq('invoice_id', currentInvoice.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setApprovals(data || []);
    } catch (error) {
      console.error('Error loading approvals:', error);
    }
  };

  const loadAuditLogs = async () => {
    try {
      const { data: logs, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('invoice_id', currentInvoice.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (logs && logs.length > 0) {
        const userIds = logs.map(log => log.user_id).filter(Boolean);

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name, role')
            .in('id', userIds);

          const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

          const enrichedLogs = logs.map(log => ({
            ...log,
            user: log.user_id ? profileMap.get(log.user_id) : null
          }));

          setAuditLogs(enrichedLogs);
        } else {
          setAuditLogs(logs);
        }
      } else {
        setAuditLogs([]);
      }
    } catch (error) {
      console.error('Error loading audit logs:', error);
    }
  };

  const loadDepartments = async () => {
    try {
      if (!profile) return;

      const accessibleDepts = await getAccessibleDepartments(profile);
      setAvailableDepartments(accessibleDepts);
    } catch (error) {
      console.error('Error loading departments:', error);
    }
  };

  const loadInvoiceDepartments = async () => {
    try {
      const { data, error } = await supabase
        .from('invoice_departments')
        .select(`
          *,
          department:departments(id, name)
        `)
        .eq('invoice_id', currentInvoice.id)
        .order('is_primary', { ascending: false });

      if (error) throw error;
      setInvoiceDepartments(data || []);
    } catch (error) {
      console.error('Error loading invoice departments:', error);
    }
  };

  const loadInvoiceDepartmentInfo = async () => {
    try {
      if (!currentInvoice.department_id) {
        setInvoiceDepartmentInfo(null);
        return;
      }

      const { data: deptData, error: deptError } = await supabase
        .from('departments')
        .select('director_id')
        .eq('id', currentInvoice.department_id)
        .maybeSingle();

      if (deptError) throw deptError;

      const { data: uploaderData, error: uploaderError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', currentInvoice.uploaded_by)
        .maybeSingle();

      if (uploaderError) throw uploaderError;

      setInvoiceDepartmentInfo({
        director_id: deptData?.director_id || null,
        uploader_role: uploaderData?.role || null,
      });
    } catch (error) {
      console.error('Error loading invoice department info:', error);
      setInvoiceDepartmentInfo(null);
    }
  };

  const loadCostCenters = async () => {
    try {
      const { data, error } = await supabase
        .from('cost_centers')
        .select('id, code, description, is_active')
        .eq('is_active', true)
        .order('display_order');

      if (error) throw error;
      setCostCenters(data || []);
    } catch (error) {
      console.error('Error loading cost centers:', error);
      setCostCenters([]);
    }
  };

  const handleApprove = async (action: 'approved' | 'rejected') => {
    if (!profile) return;

    setLoading(true);
    try {
      const { error: approvalError } = await supabase
        .from('approvals')
        .insert({
          invoice_id: currentInvoice.id,
          approver_id: profile.id,
          approver_role: profile.role,
          action,
          comment: comment || null,
        });

      if (approvalError) throw approvalError;

      let newStatus = action === 'approved' ? 'accepted' : 'rejected';
      let nextApproverId = null;

      if (action === 'approved' && currentInvoice.department_id) {
        if (profile.role === 'Kierownik') {
          newStatus = 'accepted';
          nextApproverId = null;
        } else {
          const { data: nextApprover, error: approverError } = await supabase
            .rpc('get_next_approver_in_department', {
              dept_id: currentInvoice.department_id,
              user_role: profile.role,
            });

          if (approverError) {
            console.error('Error getting next approver:', approverError);
          }

          if (nextApprover) {
            newStatus = 'waiting';
            nextApproverId = nextApprover;
          } else {
            newStatus = 'accepted';
            nextApproverId = null;
          }
        }
      }

      const updateData: any = { status: newStatus };
      if (action === 'approved') {
        updateData.current_approver_id = nextApproverId;
      }

      const { data, error: updateError } = await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', currentInvoice.id)
        .select()
        .single();

      if (updateError) throw updateError;

      Object.assign(invoice, data);

      // Move file to unpaid folder when fully accepted
      const fileId = currentInvoice.google_drive_id || currentInvoice.user_drive_file_id;
      if (newStatus === 'accepted' && fileId && currentInvoice.department_id) {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: deptData } = await supabase
          .from('departments')
          .select('google_drive_unpaid_folder_id')
          .eq('id', currentInvoice.department_id)
          .single();

        if (deptData?.google_drive_unpaid_folder_id && session?.access_token) {
          try {
            const moveResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/move-file-on-google-drive`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fileId: fileId,
                  targetFolderId: deptData.google_drive_unpaid_folder_id,
                }),
              }
            );

            if (!moveResponse.ok) {
              console.error('Failed to move file to unpaid folder:', await moveResponse.text());
            } else {
              console.log('✓ File moved to unpaid folder on Google Drive');
            }
          } catch (moveError) {
            console.error('Error moving file on Google Drive:', moveError);
          }
        }
      }

      await loadApprovals();
      await loadAuditLogs();

      setComment('');
      onUpdate();
    } catch (error) {
      console.error('Error processing approval:', error);
    } finally {
      setLoading(false);
    }
  };

  const canApprove = () => {
    if (!profile) {
      return false;
    }

    // Only current_approver can approve
    if (currentInvoice.current_approver_id !== profile.id) {
      return false;
    }

    return currentInvoice.status === 'pending' || currentInvoice.status === 'waiting';
  };

  const canEdit = () => {
    if (!profile) {
      return false;
    }

    // Admins can always edit
    if (profile.is_admin) {
      return true;
    }

    // Can edit draft or rejected if I'm current_approver or (no approver assigned and I'm uploader)
    if (currentInvoice.status === 'draft' || currentInvoice.status === 'rejected') {
      if (currentInvoice.current_approver_id === profile.id ||
          (!currentInvoice.current_approver_id && currentInvoice.uploaded_by === profile.id)) {
        return true;
      }

      // Dyrektor może edytować faktury draft lub odrzucone z działów, których jest dyrektorem
      if (profile.role === 'Dyrektor' && invoiceDepartmentInfo) {
        if (invoiceDepartmentInfo.director_id === profile.id) {
          return true;
        }
      }

      // Kierownik może edytować faktury draft lub odrzucone Specjalistów ze swojego działu
      if (profile.role === 'Kierownik' && invoiceDepartmentInfo) {
        if (
          currentInvoice.department_id === profile.department_id &&
          invoiceDepartmentInfo.uploader_role === 'Specjalista'
        ) {
          return true;
        }
      }
    }

    // Can edit waiting/pending if I'm current_approver
    if ((currentInvoice.status === 'waiting' || currentInvoice.status === 'pending') &&
        currentInvoice.current_approver_id === profile.id) {
      return true;
    }

    return false;
  };

  const canTransfer = () => {
    if (!profile) {
      return false;
    }

    // Admin może zawsze
    if (profile.is_admin) {
      return true;
    }

    // Uploader może transferować swoje faktury draft lub odrzucone
    if ((currentInvoice.status === 'draft' || currentInvoice.status === 'rejected') && currentInvoice.uploaded_by === profile.id) {
      return true;
    }

    // Current approver może transferować faktury
    if (currentInvoice.current_approver_id === profile.id) {
      return true;
    }

    // Dyrektor może transferować faktury draft lub odrzucone z działów, których jest dyrektorem
    if (profile.role === 'Dyrektor' && (currentInvoice.status === 'draft' || currentInvoice.status === 'rejected') && invoiceDepartmentInfo) {
      if (invoiceDepartmentInfo.director_id === profile.id) {
        return true;
      }
    }

    // Kierownik może transferować faktury draft lub odrzucone Specjalistów ze swojego działu
    if (profile.role === 'Kierownik' && (currentInvoice.status === 'draft' || currentInvoice.status === 'rejected') && invoiceDepartmentInfo) {
      if (
        currentInvoice.department_id === profile.department_id &&
        invoiceDepartmentInfo.uploader_role === 'Specjalista'
      ) {
        return true;
      }
    }

    // Accepted invoices - admin or non-uploader can transfer
    if (currentInvoice.status === 'accepted' && currentInvoice.uploaded_by !== profile.id) {
      return true;
    }

    return false;
  };

  const handleSaveEdit = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('invoices')
        .update({
          invoice_number: editedInvoice.invoice_number,
          supplier_name: editedInvoice.supplier_name,
          supplier_nip: editedInvoice.supplier_nip,
          buyer_name: editedInvoice.buyer_name,
          buyer_nip: editedInvoice.buyer_nip,
          issue_date: editedInvoice.issue_date,
          due_date: editedInvoice.due_date,
          net_amount: editedInvoice.net_amount,
          tax_amount: editedInvoice.tax_amount,
          gross_amount: editedInvoice.gross_amount,
          currency: editedInvoice.currency,
          department_id: editedInvoice.department_id,
          status: editedInvoice.status,
          description: editedInvoice.description,
          cost_center_id: (editedInvoice as any).bez_mpk ? null : (editedInvoice.cost_center_id || null),
          bez_mpk: !!(editedInvoice as any).bez_mpk,
          pz_number: (editedInvoice as any).pz_number || null,
        })
        .eq('id', currentInvoice.id);

      if (error) throw error;

      // If invoice doesn't have a PDF, generate one and upload to Google Drive
      if (!currentInvoice.pdf_base64 && !currentInvoice.file_url && profile) {
        try {
          console.log('📄 Faktura bez PDF - generowanie...');

          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error('No active session');

          // Generate PDF
          const generateResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-invoice-pdf`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                invoiceId: currentInvoice.id,
                returnBase64: true,
              }),
            }
          );

          if (generateResponse.ok) {
            const { base64 } = await generateResponse.json();
            console.log('✓ PDF wygenerowany');

            // Get department info
            if (editedInvoice.department_id || currentInvoice.department_id) {
              const { data: department } = await supabase
                .from('departments')
                .select('google_drive_draft_folder_id')
                .eq('id', editedInvoice.department_id || currentInvoice.department_id)
                .maybeSingle();

              if (department?.google_drive_draft_folder_id) {
                console.log('☁️ Upload PDF na Google Drive...');

                // Upload to Google Drive
                const uploadResponse = await fetch(
                  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-google-drive`,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${session.access_token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      fileBase64: base64,
                      fileName: `${editedInvoice.invoice_number?.replace(/\//g, '_') || currentInvoice.id}.pdf`,
                      folderId: department.google_drive_draft_folder_id,
                      mimeType: 'application/pdf',
                      userId: user?.id,
                      invoiceId: currentInvoice.id,
                    }),
                  }
                );

                if (uploadResponse.ok) {
                  console.log('✓ PDF przesłany na Google Drive');
                } else {
                  console.warn('⚠️ Nie udało się przesłać PDF na Google Drive');
                }
              }
            }
          }
        } catch (pdfError) {
          console.error('Error generating/uploading PDF:', pdfError);
          // Don't fail the save operation if PDF generation fails
        }
      }

      const { data: refreshed } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', currentInvoice.id)
        .maybeSingle();
      if (refreshed) {
        setCurrentInvoice(refreshed);
        setEditedInvoice({
          ...refreshed,
          supplier_name: refreshed.supplier_name?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
          supplier_nip: refreshed.supplier_nip?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
        });
      }

      setIsEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating invoice:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      // Get user session for proper authorization
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('No active session');
      }

      // Delete from department folder (google_drive_id)
      if (currentInvoice.google_drive_id) {
        try {
          const deleteResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-from-google-drive`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fileId: currentInvoice.google_drive_id,
              }),
            }
          );

          if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            console.error('Failed to delete from department folder:', errorText);
          } else {
            console.log('✓ File deleted from department folder');
          }
        } catch (driveError) {
          console.error('Error deleting from department folder:', driveError);
        }
      }

      // Delete from user's personal folder (user_drive_file_id)
      if (currentInvoice.user_drive_file_id) {
        try {
          const deleteResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-from-google-drive`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fileId: currentInvoice.user_drive_file_id,
                ownerUserId: currentInvoice.drive_owner_user_id ?? undefined,
              }),
            }
          );

          if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            console.error('Failed to delete from user folder:', errorText);
          } else {
            console.log('✓ File deleted from user personal folder');
          }
        } catch (driveError) {
          console.error('Error deleting from user folder:', driveError);
        }
      }

      if (currentInvoice.file_url) {
        const filePath = currentInvoice.file_url.split('/').pop();
        if (filePath) {
          const { error: storageError } = await supabase.storage
            .from('documents')
            .remove([`invoices/${filePath}`]);

          if (storageError) {
            console.error('Error deleting file from storage:', storageError);
          }
        }
      }

      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', currentInvoice.id);

      if (error) throw error;

      onClose();
      onUpdate();
    } catch (error) {
      console.error('Error deleting invoice:', error);
      alert('Nie udało się usunąć faktury. Sprawdź uprawnienia.');
    } finally {
      setLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!profile) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('invoices')
        .update({
          paid_at: new Date().toISOString(),
          paid_by: profile.id,
          status: 'paid',
        })
        .eq('id', currentInvoice.id)
        .select('id, status, paid_at, paid_by')
        .single();

      if (error) {
        console.error('Error updating invoice as paid:', error);
        throw error;
      }

      if (!data || data.status !== 'paid') {
        console.error('Invoice status not updated correctly:', data);
        throw new Error('Status faktury nie został zaktualizowany na "paid"');
      }

      // Move file to paid folder on Google Drive
      const fileId = currentInvoice.google_drive_id || currentInvoice.user_drive_file_id;
      if (fileId && currentInvoice.department_id) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          console.error('No active session for Google Drive operation');
        } else {
          const { data: deptData } = await supabase
            .from('departments')
            .select('google_drive_paid_folder_id')
            .eq('id', currentInvoice.department_id)
            .maybeSingle();

          if (deptData?.google_drive_paid_folder_id) {
            try {
              const moveResponse = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/move-file-on-google-drive`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    fileId: fileId,
                    targetFolderId: deptData.google_drive_paid_folder_id,
                  }),
                }
              );

              if (!moveResponse.ok) {
                console.error('Failed to move file to paid folder:', await moveResponse.text());
              } else {
                console.log('✓ File moved to paid folder on Google Drive');
              }
            } catch (moveError) {
              console.error('Error moving file on Google Drive:', moveError);
            }
          }
        }
      }

      setShowPaidConfirm(false);
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error marking invoice as paid:', error);
      alert('Nie udało się oznaczyć faktury jako opłaconą');
    } finally {
      setLoading(false);
    }
  };

  const handleForwardToCirculation = async () => {
    if (!profile) return;

    setLoading(true);
    try {
      if (currentInvoice.status === 'draft') {
        if (!currentInvoice.department_id) {
          alert('Proszę przypisać dział przed przesłaniem faktury do obiegu.');
          setLoading(false);
          return;
        }

        // Sprawdź czy przełożony przejmuje fakturę podwładnego
        // Jeśli tak, użyj roli uploadera aby rozpocząć workflow od początku
        let roleForWorkflow = profile.role;

        if (currentInvoice.uploaded_by !== profile.id && invoiceDepartmentInfo?.uploader_role) {
          // Przełożony przejmuje fakturę - użyj roli uploadera
          roleForWorkflow = invoiceDepartmentInfo.uploader_role;
        }

        const { data: nextApprover, error: approverError } = await supabase
          .rpc('get_next_approver_in_department', {
            dept_id: currentInvoice.department_id,
            user_role: roleForWorkflow,
          });

        if (approverError) {
          console.error('Error getting next approver:', approverError);
          alert('Nie udało się znaleźć następnego akceptującego');
          setLoading(false);
          return;
        }

        if (!nextApprover) {
          alert('Brak dostępnego akceptującego w hierarchii działu');
          setLoading(false);
          return;
        }

        const { error: updateError } = await supabase
          .from('invoices')
          .update({
            status: 'waiting',
            current_approver_id: nextApprover,
          })
          .eq('id', currentInvoice.id);

        if (updateError) throw updateError;

        // Move file on Google Drive if applicable
        if (currentInvoice.user_drive_file_id && currentInvoice.department_id) {
          try {
            const { data: department, error: deptError } = await supabase
              .from('departments')
              .select('google_drive_draft_folder_id')
              .eq('id', currentInvoice.department_id)
              .single();

            if (!deptError && department?.google_drive_draft_folder_id) {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.access_token) {
                const moveResponse = await fetch(
                  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/move-file-on-google-drive`,
                  {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${session.access_token}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      fileId: currentInvoice.user_drive_file_id,
                      targetFolderId: department.google_drive_draft_folder_id,
                    }),
                  }
                );

                if (!moveResponse.ok) {
                  console.error('Failed to move file on Google Drive:', await moveResponse.text());
                }
              }
            }
          } catch (moveError) {
            console.error('Error moving file on Google Drive:', moveError);
          }
        }

        alert('Faktura została przesłana do akceptacji');
        onUpdate();
        onClose();
      } else if (currentInvoice.status === 'accepted') {
        if (!currentInvoice.department_id) {
          alert('Faktura musi mieć przypisany dział.');
          setLoading(false);
          return;
        }

        const { data: nextApprover, error: approverError } = await supabase
          .rpc('get_next_approver_in_department', {
            dept_id: currentInvoice.department_id,
            user_role: profile.role,
          });

        if (approverError) {
          console.error('Error getting next approver:', approverError);
          alert('Nie udało się znaleźć następnego akceptującego');
          setLoading(false);
          return;
        }

        if (!nextApprover) {
          alert('Faktura została już zaakceptowana przez wszystkich. Nie ma już kolejnego właściciela w procesie.');
          setLoading(false);
          return;
        }

        const { error: updateError } = await supabase
          .from('invoices')
          .update({
            status: 'waiting',
            current_approver_id: nextApprover,
          })
          .eq('id', currentInvoice.id);

        if (updateError) throw updateError;

        alert('Faktura została przekazana do kolejnego akceptującego');
        onUpdate();
        onClose();
      }
    } catch (error) {
      console.error('Error forwarding invoice:', error);
      alert('Nie udało się przekazać faktury do obiegu');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAndTransferKSEF = async () => {
    if (!ksefInvoiceId || !profile) return;

    setLoading(true);
    try {
      console.log('🔄 === ROZPOCZYNAM TRANSFER FAKTURY KSEF DO OBIEGU ===');
      console.log('Invoice ID:', currentInvoice.id);
      console.log('KSEF Invoice ID:', ksefInvoiceId);
      console.log('User ID:', profile.id);

      // Step 1: Get user's department
      console.log('📂 Pobieranie informacji o dziale użytkownika...');
      const { data: department, error: deptError } = await supabase
        .from('departments')
        .select('id, name, google_drive_draft_folder_id')
        .eq('id', profile.department_id)
        .maybeSingle();

      if (deptError || !department) {
        throw new Error('Nie znaleziono działu użytkownika');
      }
      console.log('✓ Dział:', department.name);

      // Step 2: Get PDF from KSEF invoice
      console.log('📄 Pobieranie PDF z KSEF invoice...');
      const { data: ksefInvoice, error: ksefError } = await supabase
        .from('ksef_invoices')
        .select('pdf_base64, invoice_number, supplier_name, supplier_nip, buyer_name, buyer_nip, gross_amount, net_amount, tax_amount, currency, issue_date')
        .eq('id', ksefInvoiceId)
        .maybeSingle();

      if (ksefError) throw ksefError;
      if (!ksefInvoice?.pdf_base64) {
        throw new Error('Brak PDF dla tej faktury KSEF');
      }
      console.log('✓ PDF base64 pobrany, długość:', ksefInvoice.pdf_base64.length);

      // Step 3: Upload to Google Drive if configured
      let driveFileUrl: string | null = null;
      let googleDriveId: string | null = null;

      if (department.google_drive_draft_folder_id) {
        try {
          console.log('☁️ Przesyłanie PDF na Google Drive...');
          console.log('Folder ID:', department.google_drive_draft_folder_id);

          if (!user) {
            throw new Error('Brak zalogowanego użytkownika');
          }

          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            throw new Error('No active session');
          }

          const uploadResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-to-google-drive`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fileBase64: ksefInvoice.pdf_base64,
                fileName: `${ksefInvoice.invoice_number.replace(/\//g, '_')}.pdf`,
                folderId: department.google_drive_draft_folder_id,
                mimeType: 'application/pdf',
                userId: user.id,
              }),
            }
          );

          if (uploadResponse.ok) {
            const uploadResult = await uploadResponse.json();
            googleDriveId = uploadResult.fileId;
            driveFileUrl = `https://drive.google.com/file/d/${uploadResult.fileId}/view`;
            console.log('✓ PDF przesłany na Google Drive:', driveFileUrl);
          } else {
            const errorText = await uploadResponse.text();
            console.warn('⚠️ Nie udało się przesłać PDF na Google Drive:', errorText);
          }
        } catch (uploadError) {
          console.error('❌ Google Drive upload failed:', uploadError);
        }
      } else {
        console.warn('⚠️ Brak skonfigurowanego folderu Google Drive dla tego działu');
      }

      // Step 4: Get exchange rate if needed
      console.log('💱 Sprawdzanie kursu wymiany...');
      let exchangeRate = 1;
      let plnGrossAmount = ksefInvoice.gross_amount;

      if (ksefInvoice.currency !== 'PLN' && ksefInvoice.issue_date) {
        try {
          const rateResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-exchange-rate`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                currency: ksefInvoice.currency,
                date: ksefInvoice.issue_date,
              }),
            }
          );

          if (rateResponse.ok) {
            const rateData = await rateResponse.json();
            exchangeRate = rateData.rate;
            plnGrossAmount = ksefInvoice.gross_amount * exchangeRate;
            console.log('✓ Kurs wymiany:', exchangeRate, 'PLN =', plnGrossAmount);
          } else {
            console.warn('⚠️ Nie udało się pobrać kursu wymiany, używam 1:1');
          }
        } catch (rateError) {
          console.error('❌ Błąd pobierania kursu wymiany:', rateError);
        }
      }

      // Step 5: Update invoice with all data
      console.log('💾 Aktualizowanie faktury...');
      const updateData: Partial<Invoice> = {
        status: 'draft',
        uploaded_by: profile.id,
        department_id: profile.department_id,
        current_approver_id: profile.id,
        pdf_base64: ksefInvoice.pdf_base64,
        file_url: driveFileUrl,
        google_drive_id: googleDriveId,
        pln_gross_amount: plnGrossAmount,
        exchange_rate: exchangeRate,
        buyer_name: ksefInvoice.buyer_name || null,
        buyer_nip: ksefInvoice.buyer_nip || null,
      };

      const { error: updateError } = await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', currentInvoice.id);

      if (updateError) throw updateError;
      console.log('✓ Faktura zaktualizowana pomyślnie');

      // Step 6: Run OCR if uploaded to Google Drive
      if (driveFileUrl) {
        try {
          console.log('🔍 === URUCHAMIANIE OCR DLA FAKTURY KSEF ===');
          const ocrResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-invoice-ocr`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fileUrl: driveFileUrl,
                invoiceId: currentInvoice.id,
              }),
            }
          );

          if (ocrResponse.ok) {
            const ocrData = await ocrResponse.json();
            console.log('✓ OCR zakończone pomyślnie:', ocrData);
          } else {
            const ocrError = await ocrResponse.text();
            console.error('❌ OCR nie powiodło się:', ocrError);
          }
        } catch (ocrError) {
          console.error('❌ Błąd OCR (non-blocking):', ocrError);
        }
      } else {
        console.log('ℹ️ Pomijam OCR - brak pliku na Google Drive');
      }

      console.log('✅ === TRANSFER FAKTURY ZAKOŃCZONY POMYŚLNIE ===');

      // Wait a bit and reload the data
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refresh invoice data
      console.log('🔄 Odświeżam dane faktury...');
      const { data: updatedInvoice, error: refreshError } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', currentInvoice.id)
        .maybeSingle();

      if (refreshError) {
        console.error('Błąd odświeżania faktury:', refreshError);
      } else if (updatedInvoice) {
        setCurrentInvoice(updatedInvoice as Invoice);
        console.log('✓ Dane faktury odświeżone');
      }

      onUpdate();
    } catch (error) {
      console.error('❌ Error confirming KSEF invoice:', error);
      alert(error instanceof Error ? error.message : 'Nie udało się potwierdzić faktury');
    } finally {
      setLoading(false);
    }
  };

  const handleUnassignFromKSEF = async () => {
    if (!ksefInvoiceId) return;

    setLoading(true);
    try {
      if (currentInvoice.google_drive_id) {
        try {
          const deleteResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-from-google-drive`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                fileId: currentInvoice.google_drive_id,
              }),
            }
          );

          if (!deleteResponse.ok) {
            console.error('Failed to delete from Google Drive:', await deleteResponse.text());
          } else {
            console.log('✓ File deleted from Google Drive');
          }
        } catch (driveError) {
          console.error('Error deleting from Google Drive:', driveError);
        }
      }

      const { error: updateKsefError } = await supabase
        .from('ksef_invoices')
        .update({
          transferred_to_invoice_id: null,
          transferred_to_department_id: null,
          transferred_at: null,
        })
        .eq('id', ksefInvoiceId);

      if (updateKsefError) throw updateKsefError;

      const { data: checkInvoice } = await supabase
        .from('invoices')
        .select('id')
        .eq('id', currentInvoice.id)
        .maybeSingle();

      if (checkInvoice) {
        const { error: deleteInvoiceError } = await supabase
          .from('invoices')
          .delete()
          .eq('id', currentInvoice.id);

        if (deleteInvoiceError) throw deleteInvoiceError;
      }

      alert('Faktura została cofnięta z obiegu. Znajdziesz ją ponownie w sekcji KSEF.');
      setShowUnassignKSEFConfirm(false);
      onClose();
      onUpdate();
    } catch (error) {
      console.error('Error unassigning invoice from KSEF:', error);
      alert('Nie udało się cofnąć przypisania faktury z KSEF');
    } finally {
      setLoading(false);
    }
  };

  const handleReprocessOCR = async () => {
    if (!currentInvoice.file_url && !currentInvoice.pdf_base64) {
      alert('Brak pliku do przetworzenia');
      return;
    }

    setIsReprocessing(true);
    try {
      const requestBody: any = {
        invoiceId: currentInvoice.id,
      };

      if (currentInvoice.file_url) {
        requestBody.fileUrl = currentInvoice.file_url;
      } else if (currentInvoice.pdf_base64) {
        requestBody.pdfBase64 = currentInvoice.pdf_base64;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-invoice-ocr`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Błąd przetwarzania: ${errorText}`);
      }

      const result = await response.json();
      console.log('OCR reprocessing result:', result);

      if (result.suggestedTags && result.suggestedTags.length > 0) {
        for (const tag of result.suggestedTags) {
          if (tag.confidence >= 0.7) {
            const { error: tagError } = await supabase
              .from('invoice_tags')
              .upsert({
                invoice_id: currentInvoice.id,
                tag_id: tag.id,
              }, {
                onConflict: 'invoice_id,tag_id',
                ignoreDuplicates: true,
              });

            if (tagError) {
              console.error('Error auto-applying tag:', tagError);
            }
          }
        }
      }

      if (result.validationError) {
        alert(`UWAGA: ${result.validationError}\n\nFaktura została przetworzona, ale wymaga ręcznej korekty danych.`);
      } else {
        alert('Faktura została ponownie przetworzona przez AI');
      }
      onUpdate();
    } catch (error) {
      console.error('Error reprocessing invoice:', error);
      alert('Nie udało się ponownie przetworzyć faktury');
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleTransferToDepartment = async (departmentId: string, userId: string) => {
    if (!profile) return;

    try {
      const { error: rpcError } = await supabase.rpc('transfer_invoice_to_department', {
        p_invoice_id: currentInvoice.id,
        p_department_id: departmentId,
        p_approver_id: userId,
      });

      if (rpcError) throw rpcError;

      // Move file on Google Drive if applicable
      if (currentInvoice.user_drive_file_id) {
        try {
          // Get target department's draft folder
          const { data: department, error: deptError } = await supabase
            .from('departments')
            .select('google_drive_draft_folder_id')
            .eq('id', departmentId)
            .single();

          if (!deptError && department?.google_drive_draft_folder_id) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) {
              const moveResponse = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/move-file-on-google-drive`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    fileId: currentInvoice.user_drive_file_id,
                    targetFolderId: department.google_drive_draft_folder_id,
                  }),
                }
              );

              if (!moveResponse.ok) {
                console.error('Failed to move file on Google Drive:', await moveResponse.text());
              }
            }
          }
        } catch (moveError) {
          console.error('Error moving file on Google Drive:', moveError);
          // Don't throw - file move is not critical for transfer
        }
      }

      alert('Faktura została przesłana do wybranej osoby');
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error transferring invoice to department:', error);
      throw error;
    }
  };

  const handleDirectApproval = async () => {
    if (!profile || !currentInvoice.department_id) return;

    setLoading(true);
    try {
      // Pobierz informacje o dziale
      const { data: department, error: deptError } = await supabase
        .from('departments')
        .select('manager_id, director_id')
        .eq('id', currentInvoice.department_id)
        .single();

      if (deptError) throw deptError;

      const isManager = profile.role === 'Kierownik';
      const isDirector = profile.role === 'Dyrektor';

      if (!isManager && !isDirector) {
        alert('Tylko Kierownik lub Dyrektor może użyć tej opcji');
        setLoading(false);
        return;
      }

      // Sprawdź czy użytkownik jest uprawniony do akceptacji tej faktury
      const canApproveAsManager = isManager &&
        department?.manager_id === profile.id &&
        invoiceDepartmentInfo?.uploader_role === 'Specjalista';

      const canApproveAsDirector = isDirector &&
        department?.director_id === profile.id &&
        (invoiceDepartmentInfo?.uploader_role === 'Specjalista' ||
         invoiceDepartmentInfo?.uploader_role === 'Kierownik');

      if (!canApproveAsManager && !canApproveAsDirector) {
        alert('Nie masz uprawnień do bezpośredniej akceptacji tej faktury');
        setLoading(false);
        return;
      }

      // Dodaj wpisy approval dla pominiętych osób
      const approvalsToInsert = [];

      if (isDirector && invoiceDepartmentInfo?.uploader_role === 'Specjalista') {
        // Dyrektor akceptuje fakturę Specjalisty - dodaj approval za Kierownika i Dyrektora
        if (department?.manager_id) {
          approvalsToInsert.push({
            invoice_id: currentInvoice.id,
            approver_id: department.manager_id,
            approver_role: 'Kierownik',
            action: 'approved',
            comment: `Automatycznie zaakceptowane przez Dyrektora ${profile.full_name}`,
          });
        }
        approvalsToInsert.push({
          invoice_id: currentInvoice.id,
          approver_id: profile.id,
          approver_role: 'Dyrektor',
          action: 'approved',
          comment: comment || 'Bezpośrednia akceptacja przez Dyrektora',
        });
      } else if (isDirector && invoiceDepartmentInfo?.uploader_role === 'Kierownik') {
        // Dyrektor akceptuje fakturę Kierownika - dodaj approval za Dyrektora
        approvalsToInsert.push({
          invoice_id: currentInvoice.id,
          approver_id: profile.id,
          approver_role: 'Dyrektor',
          action: 'approved',
          comment: comment || 'Bezpośrednia akceptacja przez Dyrektora',
        });
      } else if (isManager && invoiceDepartmentInfo?.uploader_role === 'Specjalista') {
        // Kierownik akceptuje fakturę Specjalisty - dodaj approval za Kierownika
        approvalsToInsert.push({
          invoice_id: currentInvoice.id,
          approver_id: profile.id,
          approver_role: 'Kierownik',
          action: 'approved',
          comment: comment || 'Bezpośrednia akceptacja przez Kierownika',
        });
      }

      if (approvalsToInsert.length > 0) {
        const { error: approvalError } = await supabase
          .from('approvals')
          .insert(approvalsToInsert);

        if (approvalError) throw approvalError;
      }

      // Określ następnego approvera
      const { data: nextApprover, error: approverError } = await supabase
        .rpc('get_next_approver_in_department', {
          dept_id: currentInvoice.department_id,
          user_role: profile.role,
        });

      if (approverError) {
        console.error('Error getting next approver:', approverError);
      }

      let newStatus = 'accepted';
      let nextApproverId = null;
      if (nextApprover) {
        newStatus = 'waiting';
        nextApproverId = nextApprover;
      }

      // Zaktualizuj fakturę
      const { data, error: updateError } = await supabase
        .from('invoices')
        .update({
          status: newStatus,
          current_approver_id: nextApproverId
        })
        .eq('id', currentInvoice.id)
        .select()
        .single();

      if (updateError) throw updateError;

      Object.assign(invoice, data);

      // Move file to unpaid folder when fully accepted
      const fileId = currentInvoice.google_drive_id || currentInvoice.user_drive_file_id;
      if (newStatus === 'accepted' && fileId && currentInvoice.department_id) {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: deptData } = await supabase
          .from('departments')
          .select('google_drive_unpaid_folder_id')
          .eq('id', currentInvoice.department_id)
          .single();

        if (deptData?.google_drive_unpaid_folder_id && session?.access_token) {
          try {
            const moveResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/move-file-on-google-drive`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fileId: fileId,
                  targetFolderId: deptData.google_drive_unpaid_folder_id,
                }),
              }
            );

            if (!moveResponse.ok) {
              console.error('Failed to move file to unpaid folder:', await moveResponse.text());
            } else {
              console.log('✓ File moved to unpaid folder on Google Drive');
            }
          } catch (moveError) {
            console.error('Error moving file on Google Drive:', moveError);
          }
        }
      }

      await loadApprovals();
      await loadAuditLogs();

      setComment('');
      alert('Faktura została zaakceptowana');
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error processing direct approval:', error);
      alert('Nie udało się zaakceptować faktury');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminApproval = async () => {
    if (!profile || !profile.is_admin) return;

    setLoading(true);
    try {
      const { data: department } = await supabase
        .from('departments')
        .select('manager_id, director_id')
        .eq('id', currentInvoice.department_id)
        .maybeSingle();

      const approvalsToInsert: any[] = [];

      const uploaderRole = invoiceDepartmentInfo?.uploader_role;

      if (uploaderRole === 'Specjalista') {
        if (department?.manager_id) {
          approvalsToInsert.push({
            invoice_id: currentInvoice.id,
            approver_id: department.manager_id,
            approver_role: 'Kierownik',
            action: 'approved',
            comment: `Akceptacja administracyjna przez ${profile.full_name}`,
          });
        }
        if (department?.director_id) {
          approvalsToInsert.push({
            invoice_id: currentInvoice.id,
            approver_id: department.director_id,
            approver_role: 'Dyrektor',
            action: 'approved',
            comment: `Akceptacja administracyjna przez ${profile.full_name}`,
          });
        }
      } else if (uploaderRole === 'Kierownik') {
        if (department?.director_id) {
          approvalsToInsert.push({
            invoice_id: currentInvoice.id,
            approver_id: department.director_id,
            approver_role: 'Dyrektor',
            action: 'approved',
            comment: `Akceptacja administracyjna przez ${profile.full_name}`,
          });
        }
      }

      if (approvalsToInsert.length > 0) {
        const { error: approvalError } = await supabase
          .from('approvals')
          .insert(approvalsToInsert);
        if (approvalError) throw approvalError;
      }

      const { data, error: updateError } = await supabase
        .from('invoices')
        .update({ status: 'accepted', current_approver_id: null })
        .eq('id', currentInvoice.id)
        .select()
        .single();

      if (updateError) throw updateError;

      Object.assign(invoice, data);

      await supabase.from('audit_logs').insert({
        invoice_id: currentInvoice.id,
        user_id: profile.id,
        action: 'admin_approved',
        description: `Akceptacja administracyjna — faktura zatwierdzona z pominięciem obiegu dokumentów przez ${profile.full_name}`,
      });

      const fileId = currentInvoice.google_drive_id || currentInvoice.user_drive_file_id;
      if (fileId && currentInvoice.department_id) {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: deptData } = await supabase
          .from('departments')
          .select('google_drive_unpaid_folder_id')
          .eq('id', currentInvoice.department_id)
          .single();

        if (deptData?.google_drive_unpaid_folder_id && session?.access_token) {
          try {
            await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/move-file-on-google-drive`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fileId,
                  targetFolderId: deptData.google_drive_unpaid_folder_id,
                }),
              }
            );
          } catch (moveError) {
            console.error('Error moving file on Google Drive:', moveError);
          }
        }
      }

      await loadApprovals();
      await loadAuditLogs();

      setComment('');
      alert('Faktura została zaakceptowana administracyjnie');
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error processing admin approval:', error);
      alert('Nie udało się wykonać akceptacji administracyjnej');
    } finally {
      setLoading(false);
    }
  };

  const handleAdminRejection = async (reason: string) => {
    if (!profile || !profile.is_admin) return;

    setLoading(true);
    try {
      const { data, error: updateError } = await supabase
        .from('invoices')
        .update({ status: 'rejected', current_approver_id: null, paid_at: null, paid_by: null })
        .eq('id', currentInvoice.id)
        .select()
        .single();

      if (updateError) throw updateError;

      Object.assign(invoice, data);
      setCurrentInvoice(data);

      await supabase.from('approvals').insert({
        invoice_id: currentInvoice.id,
        approver_id: profile.id,
        approver_role: profile.role,
        action: 'rejected',
        comment: reason || `Odrzucenie administracyjne przez ${profile.full_name}`,
      });

      await supabase.from('audit_logs').insert({
        invoice_id: currentInvoice.id,
        user_id: profile.id,
        action: 'admin_rejected',
        description: `Odrzucenie administracyjne — faktura odrzucona przez ${profile.full_name}${reason ? `: ${reason}` : ''}`,
      });

      await loadApprovals();
      await loadAuditLogs();

      onUpdate();
    } catch (error) {
      console.error('Error processing admin rejection:', error);
      alert('Nie udało się wykonać odrzucenia administracyjnego');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAIData = async () => {
    if (!profile) return;

    setLoading(true);
    try {
      const { error: auditError } = await supabase
        .from('audit_logs')
        .insert({
          invoice_id: currentInvoice.id,
          user_id: profile.id,
          action: 'update',
          description: 'Użytkownik potwierdził dane rozpoznane przez AI',
        });

      if (auditError) throw auditError;

      await loadAuditLogs();
      alert('Dane AI zostały potwierdzone');
    } catch (error) {
      console.error('Error confirming AI data:', error);
      alert('Nie udało się potwierdzić danych');
    } finally {
      setLoading(false);
    }
  };

  const handleRecallInvoice = async () => {
    if (!profile || !user) return;

    const isOwner = currentInvoice.uploaded_by === profile.id;
    const confirmMessage = profile.is_admin && !isOwner
      ? 'Czy na pewno chcesz cofnąć tę fakturę do edycji? Jako administrator cofasz fakturę innego użytkownika.'
      : 'Czy na pewno chcesz cofnąć tę fakturę do edycji? Faktura zostanie wycofana z weryfikacji i powrócisz do statusu roboczego.';

    const confirmed = window.confirm(confirmMessage);

    if (!confirmed) return;

    setLoading(true);
    try {
      const previousApproverId = currentInvoice.current_approver_id;

      const { error } = await supabase
        .from('invoices')
        .update({
          status: 'draft',
          current_approver_id: null,
        })
        .eq('id', currentInvoice.id);

      if (error) throw error;

      const auditDescription = profile.is_admin && !isOwner
        ? 'Faktura cofnięta do edycji przez administratora'
        : 'Faktura cofnięta do edycji przez właściciela';

      const { error: auditError } = await supabase
        .from('audit_logs')
        .insert({
          invoice_id: currentInvoice.id,
          user_id: profile.id,
          action: 'recall',
          description: auditDescription,
        });

      if (auditError) console.error('Error creating audit log:', auditError);

      if (previousApproverId) {
        const notificationMessage = profile.is_admin && !isOwner
          ? `Faktura ${currentInvoice.invoice_number || 'bez numeru'} została cofnięta do edycji przez administratora`
          : `Faktura ${currentInvoice.invoice_number || 'bez numeru'} została cofnięta do edycji przez właściciela`;

        const { error: notifError } = await supabase
          .from('notifications')
          .insert({
            user_id: previousApproverId,
            type: 'invoice_recalled',
            title: 'Faktura cofnięta',
            message: notificationMessage,
            invoice_id: currentInvoice.id,
          });

        if (notifError) console.error('Error creating notification:', notifError);
      }

      alert('Faktura została cofnięta do edycji');
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error recalling invoice:', error);
      alert('Nie udało się cofnąć faktury');
    } finally {
      setLoading(false);
    }
  };

  const needsKsefPdf = currentInvoice.source === 'ksef' && !currentInvoice.pdf_base64 && !currentInvoice.file_url && !ksefPdfBase64 && pdfLoadAttempted && !loadingKsefPdf;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-light-surface dark:bg-dark-surface rounded-2xl shadow-2xl w-full max-w-[95vw] h-[90vh] my-8 flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
          <h2 className="text-2xl font-semibold text-text-primary-light dark:text-text-primary-dark">Szczegóły faktury</h2>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                {!currentInvoice.paid_at && (
                  profile?.is_admin ||
                  profile?.role === 'Dyrektor' ||
                  ((currentInvoice.status === 'draft' || currentInvoice.status === 'rejected') && currentInvoice.uploaded_by === profile?.id)
                ) && (
                  <button
                    onClick={() => setShowPaidConfirm(true)}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Oznacz jako opłaconą</span>
                  </button>
                )}
                {isFromKSEF && (currentInvoice.status === 'draft' || currentInvoice.status === 'rejected') && canTransfer() && (
                  <>
                    <button
                      onClick={() => setShowTransferModal(true)}
                      disabled={loading}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ArrowRight className="w-4 h-4" />
                      <span>Prześlij</span>
                    </button>
                    <button
                      onClick={() => setShowUnassignKSEFConfirm(true)}
                      className="flex items-center gap-2 px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition font-medium"
                    >
                      <Undo2 className="w-4 h-4" />
                      <span>Cofnij z KSEF</span>
                    </button>
                  </>
                )}
                {(currentInvoice.status === 'draft' || currentInvoice.status === 'rejected') && canTransfer() && !isFromKSEF && (
                  <>
                    <button
                      onClick={handleReprocessOCR}
                      disabled={isReprocessing || loading}
                      className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Ponownie przetworz fakturę przez AI aby poprawić rozpoznanie danych"
                    >
                      <RefreshCw className={`w-4 h-4 ${isReprocessing ? 'animate-spin' : ''}`} />
                      <span>{isReprocessing ? 'Przetwarzanie...' : 'Przetwórz Ponownie'}</span>
                    </button>
                    <button
                      onClick={() => setShowTransferModal(true)}
                      disabled={loading}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ArrowRight className="w-4 h-4" />
                      <span>Prześlij</span>
                    </button>
                  </>
                )}
                {currentInvoice.status === 'waiting' && (currentInvoice.uploaded_by === profile?.id || profile?.is_admin) && (
                  <button
                    onClick={handleRecallInvoice}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Cofnij fakturę do edycji"
                  >
                    <Undo2 className="w-4 h-4" />
                    <span>Cofnij</span>
                  </button>
                )}
                {currentInvoice.status === 'accepted' && canTransfer() && (
                  <button
                    onClick={() => setShowTransferModal(true)}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowRight className="w-4 h-4" />
                    <span>Prześlij</span>
                  </button>
                )}
                {profile?.is_admin && currentInvoice.status !== 'rejected' && currentInvoice.status !== 'draft' && (
                  <button
                    onClick={() => setShowAdminRejectModal(true)}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    <span>Odrzuć</span>
                  </button>
                )}
                {((currentInvoice.status === 'draft' && currentInvoice.uploaded_by === profile?.id) || profile?.is_admin) && !isFromKSEF && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Usuń</span>
                  </button>
                )}
                {canEdit() && (
                  <button
                    onClick={() => {
                      setEditedInvoice({
                        ...invoice,
                        supplier_name: currentInvoice.supplier_name?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
                        supplier_nip: currentInvoice.supplier_nip?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
                      });
                      setIsEditing(true);
                    }}
                    className="flex items-center gap-2 px-3 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium"
                  >
                    <Edit2 className="w-4 h-4" />
                    <span>Edytuj</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setEditedInvoice({
                      ...invoice,
                      supplier_name: currentInvoice.supplier_name?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
                      supplier_nip: currentInvoice.supplier_nip?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
                    });
                  }}
                  className="px-3 py-2 bg-slate-200 dark:bg-slate-700 text-text-primary-light dark:text-text-primary-dark rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition font-medium"
                >
                  Anuluj
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={loading}
                  className="flex items-center gap-2 px-3 py-2 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>Zapisz</span>
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
            >
              <X className="w-5 h-5 text-text-primary-light dark:text-text-primary-dark" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 h-full">
            {(currentInvoice.file_url || currentInvoice.pdf_base64 || ksefPdfBase64 || loadingKsefPdf || generatingPdf || needsKsefPdf) && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">Podgląd dokumentu</h3>
                  {currentInvoice.file_url && (
                    <a
                      href={currentInvoice.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-2 text-brand-primary hover:text-brand-primary/80 font-medium text-sm"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Otwórz w nowej karcie</span>
                    </a>
                  )}
                </div>
                <div className="flex-1 border-2 border-slate-300 dark:border-slate-600 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800">
                  {generatingPdf ? (
                    <div className="flex flex-col items-center justify-center gap-4 p-8 h-full">
                      <RefreshCw className="w-12 h-12 text-brand-primary animate-spin" />
                      <p className="text-slate-600 dark:text-slate-400">Generowanie podgladu PDF...</p>
                    </div>
                  ) : loadingKsefPdf ? (
                    <div className="flex flex-col items-center justify-center gap-4 p-8 h-full">
                      <RefreshCw className="w-12 h-12 text-brand-primary animate-spin" />
                      <p className="text-slate-600 dark:text-slate-400">Pobieranie PDF z KSEF...</p>
                    </div>
                  ) : (currentInvoice.pdf_base64 || ksefPdfBase64) ? (
                    <iframe
                      src={`data:application/pdf;base64,${currentInvoice.pdf_base64 || ksefPdfBase64}`}
                      className="w-full h-full"
                      title="Podgląd faktury PDF"
                      style={{ border: 'none', minHeight: '600px' }}
                    />
                  ) : isFromKSEF && currentInvoice.status === 'draft' ? (
                    <div className="flex flex-col items-center justify-center gap-6 p-8 h-full">
                      <FileCheck className="w-20 h-20 text-blue-400 dark:text-blue-500" />
                      <div className="text-center max-w-md">
                        <p className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">
                          Faktura z systemu KSEF
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                          Ta faktura została automatycznie pobrana z Krajowego Systemu e-Faktur i przypisana do Ciebie.
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                          Sprawdź szczegóły i potwierdź, aby przenieść ją do obiegu dokumentów.
                        </p>
                        <button
                          onClick={handleConfirmAndTransferKSEF}
                          disabled={loading}
                          className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <FileCheck className="w-5 h-5" />
                          <span>Potwierdź i przenieś</span>
                        </button>
                      </div>
                    </div>
                  ) : needsKsefPdf ? (
                    <div className="flex flex-col items-center justify-center gap-6 p-8 h-full">
                      <Download className="w-20 h-20 text-slate-300 dark:text-slate-600" />
                      <div className="text-center">
                        <p className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Brak podgladu PDF
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                          PDF nie zostal pobrany podczas importu z KSeF
                        </p>
                        <button
                          onClick={handleGenerateKsefPdf}
                          className="inline-flex items-center gap-2 px-6 py-3 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium shadow-md hover:shadow-lg"
                        >
                          <Download className="w-5 h-5" />
                          <span>Pobierz PDF</span>
                        </button>
                      </div>
                    </div>
                  ) : currentInvoice.file_url && currentInvoice.file_url.toLowerCase().endsWith('.pdf') ? (
                    <div className="flex flex-col items-center justify-center gap-6 p-8 h-full">
                      <FileText className="w-24 h-24 text-slate-400" />
                      <div className="text-center">
                        <p className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Podgląd niedostępny
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                          {currentInvoice.invoice_number || 'Faktura'}
                        </p>
                        <a
                          href={currentInvoice.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-6 py-3 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium"
                        >
                          <ExternalLink className="w-5 h-5" />
                          <span>Otwórz PDF w nowej karcie</span>
                        </a>
                      </div>
                    </div>
                  ) : currentInvoice.file_url.includes('drive.google.com') ? (
                    <div className="flex flex-col items-center justify-center gap-6 p-8 h-full">
                      <FileText className="w-24 h-24 text-slate-400" />
                      <div className="text-center">
                        <p className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Dokument w Google Drive
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                          {currentInvoice.invoice_number || 'Faktura'}
                        </p>
                        <a
                          href={currentInvoice.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-6 py-3 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium"
                        >
                          <ExternalLink className="w-5 h-5" />
                          <span>Otwórz w Google Drive</span>
                        </a>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={currentInvoice.file_url}
                      alt="Podgląd faktury"
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col h-full overflow-y-auto space-y-4 pr-2">
              <div className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Informacje podstawowe
                  </h3>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Numer faktury</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedInvoice.invoice_number || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, invoice_number: e.target.value })}
                          className="w-full mt-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                        />
                      ) : (
                        <p className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                          {currentInvoice.invoice_number || 'Przetwarzanie...'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Status</label>
                      {isEditing ? (
                        <select
                          value={editedInvoice.status || currentInvoice.status}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, status: e.target.value as any })}
                          className="w-full mt-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                        >
                          <option value="draft">Robocze</option>
                          <option value="waiting">Oczekujące</option>
                          <option value="in_review">W weryfikacji</option>
                          <option value="accepted">Zaakceptowana</option>
                          <option value="rejected">Odrzucona</option>
                          <option value="paid">Opłacona</option>
                        </select>
                      ) : (
                        <p className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                          {statusLabels[getUserSpecificStatus(currentInvoice, profile?.id || '')] || currentInvoice.status}
                        </p>
                      )}
                    </div>
                  </div>

                  {isInvalidSupplier && (
                    <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-600 dark:border-red-500 rounded-lg p-3 flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-red-900 dark:text-red-300 text-sm">Błędny sprzedawca!</p>
                        <p className="text-red-800 dark:text-red-400 text-xs mt-0.5">
                          Aura Herbals (NIP: 5851490834) to kupujący (nabywca), nie sprzedawca (dostawca).
                          AI prawdopodobnie pomyliło strony na fakturze. Użyj przycisku "Przetwórz ponownie przez AI" lub popraw dane ręcznie.
                        </p>
                      </div>
                    </div>
                  )}

                  {isDuplicate && (
                    <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-600 dark:border-red-500 rounded-lg p-3 flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-red-900 dark:text-red-300 text-sm">DUPLIKAT!</p>
                        <p className="text-red-800 dark:text-red-400 text-xs mt-0.5">
                          W systemie znajduje się {duplicateInvoices.length} {duplicateInvoices.length === 1 ? 'inna faktura' : 'innych faktur'}
                          {' '}o tym samym numerze ({currentInvoice.invoice_number})
                          {currentInvoice.supplier_nip ? ` i NIP dostawcy (${currentInvoice.supplier_nip})` : ` i nazwie dostawcy (${currentInvoice.supplier_name})`}.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Dostawca</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedInvoice.supplier_name || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, supplier_name: e.target.value })}
                          className={`w-full mt-1 px-3 py-2 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm ${
                            isInvalidSupplier
                              ? 'border-2 border-red-600 dark:border-red-500'
                              : 'border border-slate-300 dark:border-slate-600'
                          }`}
                        />
                      ) : (
                        <p className={`text-base font-semibold mt-1 ${
                          isInvalidSupplier
                            ? 'text-red-600 dark:text-red-500'
                            : 'text-text-primary-light dark:text-text-primary-dark'
                        }`}>
                          {(currentInvoice.supplier_name || 'Przetwarzanie...').replace(/\[BŁĄD[^\]]*\]\s*/g, '')}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">NIP / VAT ID</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedInvoice.supplier_nip || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, supplier_nip: e.target.value })}
                          className={`w-full mt-1 px-3 py-2 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm ${
                            isInvalidSupplier
                              ? 'border-2 border-red-600 dark:border-red-500'
                              : 'border border-slate-300 dark:border-slate-600'
                          }`}
                        />
                      ) : (
                        <p className={`text-base font-semibold mt-1 ${
                          isInvalidSupplier
                            ? 'text-red-600 dark:text-red-500'
                            : 'text-text-primary-light dark:text-text-primary-dark'
                        }`}>
                          {(currentInvoice.supplier_nip || '—').replace(/\[BŁĄD[^\]]*\]\s*/g, '')}
                        </p>
                      )}
                    </div>
                  </div>

                  {isInvalidBuyer && (
                    <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-600 dark:border-red-500 rounded-lg p-3 flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-red-900 dark:text-red-300 text-sm">BŁĘDNY ODBIORCA!</p>
                        <p className="text-red-800 dark:text-red-400 text-xs mt-0.5">
                          Faktura wystawiona na inną firmę niż Aura Herbals Sp. z o.o. (NIP: 5851490834).
                          Sprawdź czy to prawidłowy dokument.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Odbiorca</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedInvoice.buyer_name || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, buyer_name: e.target.value })}
                          className={`w-full mt-1 px-3 py-2 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm ${
                            isInvalidBuyer
                              ? 'border-2 border-red-600 dark:border-red-500'
                              : 'border border-slate-300 dark:border-slate-600'
                          }`}
                        />
                      ) : (
                        <p className={`text-base font-semibold mt-1 ${
                          isInvalidBuyer
                            ? 'text-red-600 dark:text-red-500'
                            : 'text-text-primary-light dark:text-text-primary-dark'
                        }`}>
                          {currentInvoice.buyer_name || '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">NIP Odbiorcy</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedInvoice.buyer_nip || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, buyer_nip: e.target.value })}
                          className={`w-full mt-1 px-3 py-2 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm ${
                            isInvalidBuyer
                              ? 'border-2 border-red-600 dark:border-red-500'
                              : 'border border-slate-300 dark:border-slate-600'
                          }`}
                        />
                      ) : (
                        <p className={`text-base font-semibold mt-1 ${
                          isInvalidBuyer
                            ? 'text-red-600 dark:text-red-500'
                            : 'text-text-primary-light dark:text-text-primary-dark'
                        }`}>
                          {currentInvoice.buyer_nip || '—'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Data wystawienia</label>
                      {isEditing ? (
                        <input
                          type="date"
                          value={editedInvoice.issue_date || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, issue_date: e.target.value })}
                          className="w-full mt-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                        />
                      ) : (
                        <p className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                          {currentInvoice.issue_date
                            ? new Date(currentInvoice.issue_date).toLocaleDateString('pl-PL')
                            : '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Termin płatności</label>
                      {isEditing ? (
                        <input
                          type="date"
                          value={editedInvoice.due_date || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, due_date: e.target.value })}
                          className="w-full mt-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                        />
                      ) : (
                        <p className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                          {currentInvoice.due_date
                            ? new Date(currentInvoice.due_date).toLocaleDateString('pl-PL')
                            : '—'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Dział główny (MPK)
                      </label>
                      {isEditing ? (
                        <select
                          value={editedInvoice.department_id || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, department_id: e.target.value })}
                          className="w-full mt-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                        >
                          <option value="">Wybierz dział</option>
                          {availableDepartments.map(dept => (
                            <option key={dept.id} value={dept.id}>{dept.name}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                          {currentInvoice.department?.name || '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Powiązanie z PZ
                      </label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={(editedInvoice as any).pz_number || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, pz_number: e.target.value } as any)}
                          placeholder="Numer PZ"
                          className="w-full mt-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                        />
                      ) : (
                        <p className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                          {(currentInvoice as any).pz_number || '—'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Waluta</label>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedInvoice.currency || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, currency: e.target.value })}
                          className="w-full mt-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                        />
                      ) : (
                        <p className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                          {currentInvoice.currency || '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Zrodlo</label>
                      <div className="mt-1">
                        {(() => {
                          const sourceConfig = {
                            manual: { label: 'Dodana recznie', icon: Upload, color: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
                            email: { label: 'Email', icon: Mail, color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
                            google_drive: { label: 'Google Drive', icon: HardDrive, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
                            ksef: { label: 'KSeF', icon: FileCheck, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
                          };
                          const rawSource = (invoice as any).source || 'manual';
                          const sourceKey = rawSource.startsWith('email:') ? 'email' : rawSource;
                          const emailAddress = rawSource.startsWith('email:') ? rawSource.substring(6) : null;
                          const src = sourceConfig[sourceKey as keyof typeof sourceConfig] || sourceConfig.manual;
                          const Icon = src.icon;
                          return (
                            <div className="flex flex-col gap-1">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium ${src.color}`}>
                                <Icon className="w-3.5 h-3.5" />
                                {src.label}
                              </span>
                              {emailAddress && (
                                <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark ml-0.5">
                                  {emailAddress}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Opis</label>
                      {isEditing ? (
                        <textarea
                          value={editedInvoice.description || ''}
                          onChange={(e) => setEditedInvoice({ ...editedInvoice, description: e.target.value })}
                          rows={2}
                          className="w-full mt-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary resize-none text-sm"
                          placeholder="Dodaj opis lub notatki do faktury..."
                        />
                      ) : (
                        <p className="text-sm text-text-primary-light dark:text-text-primary-dark mt-1">
                          {currentInvoice.description || '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Opis MPK
                      </label>
                      {isEditing ? (
                        <div className="mt-1 space-y-2">
                          <div className="relative">
                              <input
                                type="text"
                                value={(() => {
                                  const selected = costCenters.find(cc => cc.id === editedInvoice.cost_center_id);
                                  return selected ? `${selected.code} - ${selected.description}` : costCenterSearch;
                                })()}
                                onChange={(e) => {
                                  setCostCenterSearch(e.target.value);
                                  setShowCostCenterDropdown(true);
                                  if (!e.target.value) {
                                    setEditedInvoice({ ...editedInvoice, cost_center_id: null });
                                  }
                                }}
                                onFocus={() => setShowCostCenterDropdown(true)}
                                placeholder="Wyszukaj kod lub opis MPK..."
                                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                              />
                              {showCostCenterDropdown && (() => {
                                const searchLower = costCenterSearch.toLowerCase();
                                const filtered = costCenters.filter(cc =>
                                  cc.code.toLowerCase().includes(searchLower) ||
                                  cc.description.toLowerCase().includes(searchLower)
                                );

                                return filtered.length > 0 ? (
                                  <div className="absolute z-50 w-full mt-1 bg-light-surface dark:bg-dark-surface border border-slate-300 dark:border-slate-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                    {filtered.map(cc => (
                                      <button
                                        key={cc.id}
                                        type="button"
                                        onClick={() => {
                                          setEditedInvoice({ ...editedInvoice, cost_center_id: cc.id });
                                          setCostCenterSearch('');
                                          setShowCostCenterDropdown(false);
                                        }}
                                        className="w-full text-left px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-700 border-b border-slate-200 dark:border-slate-700 last:border-b-0 text-sm"
                                      >
                                        <span className="font-medium text-brand-primary">{cc.code}</span>
                                        <span className="text-text-primary-light dark:text-text-primary-dark"> - {cc.description}</span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null;
                              })()}
                              {editedInvoice.cost_center_id && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditedInvoice({ ...editedInvoice, cost_center_id: null });
                                    setCostCenterSearch('');
                                  }}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-text-primary-light dark:text-text-primary-dark mt-1">
                            {(() => {
                              if ((currentInvoice as any).bez_mpk) return 'BEZ MPK';
                              const cc = costCenters.find(c => c.id === (currentInvoice as any).cost_center_id);
                              return cc ? `${cc.code} - ${cc.description}` : '—';
                            })()}
                          </p>
                        )}
                    </div>
                  </div>
                </div>
              </div>

              {profile?.mpk_override_bez_mpk && isEditing && (
                <div className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-xl p-4">
                  <label className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!(editedInvoice as any).bez_mpk}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setEditedInvoice({
                          ...editedInvoice,
                          cost_center_id: checked ? null : editedInvoice.cost_center_id,
                          ...(checked ? { bez_mpk: true } : { bez_mpk: false }),
                        } as any);
                        if (checked) {
                          setCostCenterSearch('');
                          setShowCostCenterDropdown(false);
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-brand-primary focus:ring-brand-primary"
                    />
                    <div>
                      <span className="text-sm font-medium text-text-primary-light dark:text-text-primary-dark">
                        Przypisz do kosztów BEZ MPK
                      </span>
                      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark mt-0.5">
                        Faktura zostanie wyeksportowana z kodem działu i nazwą działu "BEZ MPK"
                      </p>
                    </div>
                  </label>
                </div>
              )}

              <div className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-xl p-5">
                <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark mb-4 flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Kwoty
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-light-surface dark:bg-dark-surface rounded-lg">
                    <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Netto</label>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editedInvoice.net_amount != null ? editedInvoice.net_amount : ''}
                        onChange={(e) => setEditedInvoice({ ...editedInvoice, net_amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                        className="w-full mt-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                      />
                    ) : (
                      <p className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark mt-1">
                        {currentInvoice.net_amount != null
                          ? `${currentInvoice.net_amount.toFixed(2)} ${currentInvoice.currency}`
                          : '—'}
                      </p>
                    )}
                  </div>
                  <div className="text-center p-3 bg-light-surface dark:bg-dark-surface rounded-lg">
                    <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">VAT</label>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editedInvoice.tax_amount != null ? editedInvoice.tax_amount : ''}
                        onChange={(e) => setEditedInvoice({ ...editedInvoice, tax_amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                        className="w-full mt-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                      />
                    ) : (
                      <p className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark mt-1">
                        {currentInvoice.tax_amount != null
                          ? `${currentInvoice.tax_amount.toFixed(2)} ${currentInvoice.currency}`
                          : '—'}
                      </p>
                    )}
                  </div>
                  <div className="text-center p-3 bg-brand-primary/10 rounded-lg">
                    <label className="text-xs font-medium text-brand-primary uppercase tracking-wide">Brutto</label>
                    {isEditing ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editedInvoice.gross_amount != null ? editedInvoice.gross_amount : ''}
                        onChange={(e) => setEditedInvoice({ ...editedInvoice, gross_amount: e.target.value === '' ? null : parseFloat(e.target.value) })}
                        className="w-full mt-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                      />
                    ) : (
                      <div className="mt-1">
                        <p className="text-lg font-bold text-brand-primary">
                          {currentInvoice.gross_amount != null
                            ? `${currentInvoice.gross_amount.toFixed(2)} ${currentInvoice.currency}`
                            : '—'}
                        </p>
                        {currentInvoice.currency !== 'PLN' && currentInvoice.pln_gross_amount != null && (
                          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">
                            = {currentInvoice.pln_gross_amount.toFixed(2)} PLN
                            {currentInvoice.exchange_rate && (
                              <span className="text-xs ml-1">
                                (kurs: {currentInvoice.exchange_rate.toFixed(4)})
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <InvoiceTags
                invoiceId={currentInvoice.id}
                isEditing={isEditing}
                supplierName={currentInvoice.supplier_name}
                supplierNip={currentInvoice.supplier_nip}
                description={currentInvoice.description}
                grossAmount={currentInvoice.gross_amount}
                currency={currentInvoice.currency}
                departmentId={currentInvoice.department_id}
                showConfirmButton={!isEditing && currentInvoice.status === 'draft' && currentInvoice.uploaded_by === profile?.id}
                onConfirmAIData={handleConfirmAIData}
                confirmLoading={loading}
              />

              {approvals.length > 0 && (
                <div className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-xl p-5">
                  <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark mb-3 flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Historia akceptacji
                  </h3>
                  <div className="space-y-2">
                    {approvals.map((approval) => (
                      <div
                        key={approval.id}
                        className={`flex items-start gap-3 p-3 rounded-lg ${
                          approval.action === 'approved'
                            ? 'bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900'
                            : 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900'
                        }`}
                      >
                        {approval.action === 'approved' ? (
                          <CheckCircle className="w-5 h-5 text-status-success flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="font-medium text-sm text-text-primary-light dark:text-text-primary-dark">
                              {approval.approver.full_name}
                            </p>
                            <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">
                              {new Date(approval.created_at).toLocaleDateString('pl-PL')}
                            </span>
                          </div>
                          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                            {approval.approver.role}
                          </p>
                          {approval.comment && (
                            <p className="text-xs text-text-primary-light dark:text-text-primary-dark mt-1 italic">
                              "{approval.comment}"
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {auditLogs.length > 0 && (
                <div className="bg-light-surface-variant dark:bg-dark-surface-variant rounded-xl p-5">
                  <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark mb-3 flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Historia zmian
                  </h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-start gap-2 p-2 bg-light-surface dark:bg-dark-surface rounded text-xs"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-text-primary-light dark:text-text-primary-dark">
                            {log.description}
                          </p>
                          {log.user && (
                            <p className="text-text-secondary-light dark:text-text-secondary-dark">
                              {log.user.full_name}
                            </p>
                          )}
                        </div>
                        <span className="text-text-secondary-light dark:text-text-secondary-dark whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString('pl-PL', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {canApprove() && (
                <div className="bg-gradient-to-br from-brand-primary/5 to-brand-primary/10 dark:from-brand-primary/10 dark:to-brand-primary/5 rounded-xl p-5 border-2 border-brand-primary/20">
                  <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark mb-4 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5" />
                    Twoja decyzja
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-text-primary-light dark:text-text-primary-dark mb-2">
                        Komentarz (opcjonalnie)
                      </label>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary focus:border-transparent resize-none text-sm"
                        placeholder="Dodaj komentarz do swojej decyzji..."
                        disabled={loading}
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleApprove('rejected')}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-status-error text-white rounded-lg hover:bg-status-error/90 transition font-medium disabled:opacity-50 shadow-md"
                      >
                        <XCircle className="w-5 h-5" />
                        <span>Odrzuć</span>
                      </button>
                      <button
                        onClick={() => handleApprove('approved')}
                        disabled={loading}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-status-success text-white rounded-lg hover:bg-status-success/90 transition font-medium disabled:opacity-50 shadow-md"
                      >
                        <CheckCircle className="w-5 h-5" />
                        <span>Zaakceptuj</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showAdminRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <ShieldAlert className="w-6 h-6 text-red-600 dark:text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Odrzuć fakturę
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Wybierz rodzaj odrzucenia
                </p>
              </div>
              <button
                onClick={() => { setShowAdminRejectModal(false); setAdminRejectComment(''); }}
                className="ml-auto p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Powód odrzucenia <span className="text-red-500">*</span>
              </label>
              <textarea
                value={adminRejectComment}
                onChange={(e) => setAdminRejectComment(e.target.value)}
                rows={3}
                placeholder="Wpisz powód odrzucenia..."
                className={`w-full px-3 py-2 border rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none text-sm ${adminRejectComment.trim() ? 'border-slate-300 dark:border-slate-600' : 'border-red-400 dark:border-red-600'}`}
              />
              {!adminRejectComment.trim() && (
                <p className="mt-1 text-xs text-red-500">Powód odrzucenia jest wymagany</p>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Odrzucenie administracyjne
              </p>
              <button
                onClick={async () => {
                  if (!adminRejectComment.trim()) return;
                  setShowAdminRejectModal(false);
                  await handleAdminRejection(adminRejectComment);
                  setAdminRejectComment('');
                }}
                disabled={loading || !adminRejectComment.trim()}
                className="w-full flex items-center gap-3 p-4 bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 hover:border-red-400 transition group"
              >
                <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg">
                  <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-red-800 dark:text-red-300">
                    Odrzucenie administracyjne
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Cofa fakturę do statusu "Odrzucona" niezależnie od etapu
                  </p>
                </div>
              </button>

              {canApprove() && (
                <>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider pt-1">
                    Standardowe odrzucenie
                  </p>
                  <button
                    onClick={async () => {
                      if (!adminRejectComment.trim()) return;
                      setShowAdminRejectModal(false);
                      setComment(adminRejectComment);
                      setAdminRejectComment('');
                      await handleApprove('rejected');
                    }}
                    disabled={loading || !adminRejectComment.trim()}
                    className="w-full flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-700/50 border-2 border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-slate-400 transition group"
                  >
                    <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                      <XCircle className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        Standardowe odrzucenie
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        Odrzucenie w ramach normalnego obiegu dokumentów
                      </p>
                    </div>
                  </button>
                </>
              )}
            </div>

            <button
              onClick={() => { setShowAdminRejectModal(false); setAdminRejectComment(''); }}
              className="mt-4 w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition text-sm font-medium"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600 dark:text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Usuń fakturę
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Tej operacji nie można cofnąć
                </p>
              </div>
            </div>

            <p className="text-slate-700 dark:text-slate-300 mb-6">
              Czy na pewno chcesz usunąć fakturę <strong>{currentInvoice.invoice_number || 'bez numeru'}</strong>?
              Zostaną również usunięte wszystkie powiązane dane, w tym historia akceptacji i logi audytu.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
                className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Usuwanie...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Usuń fakturę</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaidConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-light-surface dark:bg-dark-surface rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
                  <CreditCard className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">
                    Oznacz jako opłaconą
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Pomiń proces akceptacji
                  </p>
                </div>
              </div>
            </div>

            <p className="text-slate-700 dark:text-slate-300 mb-6">
              Oznaczając fakturę jako opłaconą, pomijasz proces akceptacji dokumentu i płatności
              przekazując fakturę bezpośrednio do systemu OCR Administracji.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowPaidConfirm(false)}
                disabled={loading}
                className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                onClick={handleMarkAsPaid}
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Oznaczanie...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4" />
                    <span>Oznacz jako opłaconą</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUnassignKSEFConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900/20 flex items-center justify-center">
                <Undo2 className="w-6 h-6 text-orange-600 dark:text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Cofnij przypisanie z KSEF
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Tej operacji nie można cofnąć
                </p>
              </div>
            </div>

            <p className="text-slate-700 dark:text-slate-300 mb-6">
              Czy na pewno chcesz cofnąć przypisanie faktury <strong>{currentInvoice.invoice_number || 'bez numeru'}</strong>?
              Faktura wróci do listy nieprzypisanych faktur KSEF, a plik zostanie usunięty z Google Drive.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowUnassignKSEFConfirm(false)}
                disabled={loading}
                className="flex-1 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition font-medium disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                onClick={handleUnassignFromKSEF}
                disabled={loading}
                className="flex-1 px-4 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Cofanie...</span>
                  </>
                ) : (
                  <>
                    <Undo2 className="w-4 h-4" />
                    <span>Cofnij przypisanie</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransferModal && (
        <TransferInvoiceModal
          invoiceId={currentInvoice.id}
          currentDepartmentId={currentInvoice.department_id}
          currentInvoiceStatus={currentInvoice.status}
          uploadedBy={currentInvoice.uploaded_by}
          onClose={() => setShowTransferModal(false)}
          onTransferToApproval={handleForwardToCirculation}
          onTransferToDepartment={handleTransferToDepartment}
          onDirectApproval={handleDirectApproval}
          onAdminApproval={profile?.is_admin ? handleAdminApproval : undefined}
        />
      )}
    </div>
  );
}
