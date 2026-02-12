import { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, MessageSquare, User, Calendar, DollarSign, FileText, ExternalLink, Edit2, Save, Clock, Trash2, CreditCard, ArrowRight, Undo2, Upload, Mail, HardDrive, FileCheck, RefreshCw, AlertTriangle } from 'lucide-react';
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
  const { profile } = useAuth();
  const [approvals, setApprovals] = useState<ApprovalWithProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogWithUser[]>([]);
  const [invoiceDepartments, setInvoiceDepartments] = useState<InvoiceDepartment[]>([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedInvoice, setEditedInvoice] = useState<Partial<Invoice>>({
    ...invoice,
    supplier_name: invoice.supplier_name?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
    supplier_nip: invoice.supplier_nip?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
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
  const [costCenters, setCostCenters] = useState<Array<{id: string, code: string, description: string, is_active: boolean}>>([]);
  const [costCenterSearch, setCostCenterSearch] = useState('');
  const [showCostCenterDropdown, setShowCostCenterDropdown] = useState(false);

  const isInvalidBuyer = invoice.supplier_nip === AURA_HERBALS_NIP ||
    (invoice.supplier_nip?.includes('[BŁĄD]')) ||
    (invoice.supplier_name?.includes('[BŁĄD'));

  useEffect(() => {
    loadApprovals();
    loadAuditLogs();
    loadDepartments();
    loadInvoiceDepartments();
    checkIfFromKSEF();
    loadKsefPdfIfNeeded();
    loadCostCenters();
  }, [invoice.id]);

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
          .eq('transferred_to_invoice_id', invoice.id)
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

  const loadKsefPdfIfNeeded = async () => {
    if (invoice.pdf_base64 || invoice.file_url) return;
    if (invoice.source !== 'ksef') return;

    setLoadingKsefPdf(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: ksefRecord } = await supabase
        .from('ksef_invoices')
        .select('xml_content, ksef_reference_number, pdf_base64')
        .eq('transferred_to_invoice_id', invoice.id)
        .maybeSingle();

      if (!ksefRecord) return;

      if (ksefRecord.pdf_base64) {
        setKsefPdfBase64(ksefRecord.pdf_base64);
        return;
      }

      if (ksefRecord.xml_content && ksefRecord.ksef_reference_number) {
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
          setKsefPdfBase64(pdfBase64);
          return;
        }
      }

      if (ksefRecord.ksef_reference_number) {
        const ksefProxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ksef-proxy`;
        const pdfParams = new URLSearchParams({
          path: `/api/external/invoices/${encodeURIComponent(ksefRecord.ksef_reference_number)}/pdf`,
        });

        const pdfResponse = await fetch(`${ksefProxyUrl}?${pdfParams}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });

        if (pdfResponse.ok) {
          const pdfBlob = await pdfResponse.blob();
          const pdfArrayBuffer = await pdfBlob.arrayBuffer();
          const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfArrayBuffer)));
          setKsefPdfBase64(pdfBase64);
        }
      }
    } catch (error) {
      console.error('Error loading KSEF PDF:', error);
    } finally {
      setLoadingKsefPdf(false);
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
        .eq('invoice_id', invoice.id)
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
        .eq('invoice_id', invoice.id)
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
        .eq('invoice_id', invoice.id)
        .order('is_primary', { ascending: false });

      if (error) throw error;
      setInvoiceDepartments(data || []);
    } catch (error) {
      console.error('Error loading invoice departments:', error);
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
          invoice_id: invoice.id,
          approver_id: profile.id,
          approver_role: profile.role,
          action,
          comment: comment || null,
        });

      if (approvalError) throw approvalError;

      let newStatus = action === 'approved' ? 'accepted' : 'rejected';

      if (action === 'approved' && invoice.department_id) {
        const { data: nextApprover, error: approverError } = await supabase
          .rpc('get_next_approver_in_department', {
            dept_id: invoice.department_id,
            user_role: profile.role,
          });

        if (approverError) {
          console.error('Error getting next approver:', approverError);
        }

        if (nextApprover) {
          newStatus = 'waiting';
        } else {
          newStatus = 'accepted';
        }
      }

      const { data, error: updateError } = await supabase
        .from('invoices')
        .update({ status: newStatus })
        .eq('id', invoice.id)
        .select()
        .single();

      if (updateError) throw updateError;

      Object.assign(invoice, data);

      if (newStatus === 'accepted' && invoice.google_drive_id && invoice.department_id) {
        const { data: deptData } = await supabase
          .from('departments')
          .select('google_drive_unpaid_folder_id')
          .eq('id', invoice.department_id)
          .single();

        if (deptData?.google_drive_unpaid_folder_id) {
          try {
            const moveResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/move-file-on-google-drive`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fileId: invoice.google_drive_id,
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

    if (invoice.uploaded_by === profile.id) {
      return false;
    }

    return invoice.status === 'pending' || invoice.status === 'waiting';
  };

  const canEdit = () => {
    if (!profile) {
      return false;
    }

    if (invoice.status === 'draft' && invoice.uploaded_by === profile.id) {
      return true;
    }

    if (invoice.uploaded_by !== profile.id && (invoice.status === 'waiting' || invoice.status === 'pending')) {
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
          issue_date: editedInvoice.issue_date,
          due_date: editedInvoice.due_date,
          net_amount: editedInvoice.net_amount,
          tax_amount: editedInvoice.tax_amount,
          gross_amount: editedInvoice.gross_amount,
          currency: editedInvoice.currency,
          department_id: editedInvoice.department_id,
          status: editedInvoice.status,
          description: editedInvoice.description,
          cost_center_id: editedInvoice.cost_center_id || null,
        })
        .eq('id', invoice.id);

      if (error) throw error;

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
      if (invoice.google_drive_id) {
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
                fileId: invoice.google_drive_id,
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

      if (invoice.file_url) {
        const filePath = invoice.file_url.split('/').pop();
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
        .eq('id', invoice.id);

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
      const { error } = await supabase
        .from('invoices')
        .update({
          paid_at: new Date().toISOString(),
          paid_by: profile.id,
          status: 'accepted',
        })
        .eq('id', invoice.id);

      if (error) throw error;

      if (invoice.google_drive_id && invoice.department_id) {
        const { data: deptData } = await supabase
          .from('departments')
          .select('google_drive_paid_folder_id')
          .eq('id', invoice.department_id)
          .single();

        if (deptData?.google_drive_paid_folder_id) {
          try {
            const moveResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/move-file-on-google-drive`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  fileId: invoice.google_drive_id,
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
      if (invoice.status === 'draft') {
        if (!invoice.department_id) {
          alert('Proszę przypisać dział przed przesłaniem faktury do obiegu.');
          setLoading(false);
          return;
        }

        const { data: nextApprover, error: approverError } = await supabase
          .rpc('get_next_approver_in_department', {
            dept_id: invoice.department_id,
            user_role: profile.role,
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
          })
          .eq('id', invoice.id);

        if (updateError) throw updateError;

        alert('Faktura została przesłana do akceptacji');
        onUpdate();
        onClose();
      } else if (invoice.status === 'accepted') {
        if (!invoice.department_id) {
          alert('Faktura musi mieć przypisany dział.');
          setLoading(false);
          return;
        }

        const { data: nextApprover, error: approverError } = await supabase
          .rpc('get_next_approver_in_department', {
            dept_id: invoice.department_id,
            user_role: profile.role,
          });

        if (approverError) {
          console.error('Error getting next approver:', approverError);
          alert('Nie udało się znaleźć następnego akceptującego');
          setLoading(false);
          return;
        }

        if (!nextApprover) {
          alert('Faktura została już zaakceptowana przez wszystkich. Nie ma już kolejnych akceptujących.');
          setLoading(false);
          return;
        }

        const { error: updateError } = await supabase
          .from('invoices')
          .update({
            status: 'waiting',
          })
          .eq('id', invoice.id);

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

  const handleUnassignFromKSEF = async () => {
    if (!ksefInvoiceId) return;

    setLoading(true);
    try {
      if (invoice.google_drive_id) {
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
                fileId: invoice.google_drive_id,
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
        .eq('id', invoice.id)
        .maybeSingle();

      if (checkInvoice) {
        const { error: deleteInvoiceError } = await supabase
          .from('invoices')
          .delete()
          .eq('id', invoice.id);

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
    if (!invoice.file_url && !invoice.pdf_base64) {
      alert('Brak pliku do przetworzenia');
      return;
    }

    setIsReprocessing(true);
    try {
      const requestBody: any = {
        invoiceId: invoice.id,
      };

      if (invoice.file_url) {
        requestBody.fileUrl = invoice.file_url;
      } else if (invoice.pdf_base64) {
        requestBody.pdfBase64 = invoice.pdf_base64;
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
                invoice_id: invoice.id,
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
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          department_id: departmentId,
          current_approver_id: userId,
          status: 'waiting',
        })
        .eq('id', invoice.id);

      if (updateError) throw updateError;

      alert('Faktura została przesłana do wybranej osoby');
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error transferring invoice to department:', error);
      throw error;
    }
  };

  const handleConfirmAIData = async () => {
    if (!profile) return;

    setLoading(true);
    try {
      const { error: auditError } = await supabase
        .from('audit_logs')
        .insert({
          invoice_id: invoice.id,
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-light-surface dark:bg-dark-surface rounded-2xl shadow-2xl w-full max-w-[95vw] h-[90vh] my-8 flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700/50 flex-shrink-0">
          <h2 className="text-2xl font-semibold text-text-primary-light dark:text-text-primary-dark">Szczegóły faktury</h2>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                {isFromKSEF && invoice.status === 'draft' && (profile?.role === 'Administrator' || invoice.uploaded_by === profile?.id) && (
                  <button
                    onClick={() => setShowUnassignKSEFConfirm(true)}
                    className="flex items-center gap-2 px-3 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition font-medium"
                  >
                    <Undo2 className="w-4 h-4" />
                    <span>Cofnij z KSEF</span>
                  </button>
                )}
                {invoice.status === 'draft' && invoice.uploaded_by === profile?.id && (
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
                {invoice.status === 'accepted' && invoice.uploaded_by !== profile?.id && (
                  <button
                    onClick={() => setShowTransferModal(true)}
                    disabled={loading}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowRight className="w-4 h-4" />
                    <span>Prześlij</span>
                  </button>
                )}
                {!invoice.paid_at && invoice.status !== 'accepted' && (
                  <button
                    onClick={() => setShowPaidConfirm(true)}
                    className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Oznacz jako opłaconą</span>
                  </button>
                )}
                {invoice.status === 'draft' && invoice.uploaded_by === profile?.id && !isFromKSEF && (
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
                        supplier_name: invoice.supplier_name?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
                        supplier_nip: invoice.supplier_nip?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
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
                      supplier_name: invoice.supplier_name?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
                      supplier_nip: invoice.supplier_nip?.replace(/\[BŁĄD[^\]]*\]\s*/g, ''),
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
            {(invoice.file_url || invoice.pdf_base64 || ksefPdfBase64 || loadingKsefPdf) && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-text-primary-light dark:text-text-primary-dark">Podgląd dokumentu</h3>
                  {invoice.file_url && (
                    <a
                      href={invoice.file_url}
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
                  {loadingKsefPdf ? (
                    <div className="flex flex-col items-center justify-center gap-4 p-8 h-full">
                      <RefreshCw className="w-12 h-12 text-brand-primary animate-spin" />
                      <p className="text-slate-600 dark:text-slate-400">Pobieranie PDF z KSEF...</p>
                    </div>
                  ) : (invoice.pdf_base64 || ksefPdfBase64) ? (
                    <iframe
                      src={`data:application/pdf;base64,${invoice.pdf_base64 || ksefPdfBase64}`}
                      className="w-full h-full"
                      title="Podgląd faktury PDF"
                      style={{ border: 'none', minHeight: '600px' }}
                    />
                  ) : invoice.file_url && invoice.file_url.toLowerCase().endsWith('.pdf') ? (
                    <div className="flex flex-col items-center justify-center gap-6 p-8 h-full">
                      <FileText className="w-24 h-24 text-slate-400" />
                      <div className="text-center">
                        <p className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Podgląd niedostępny
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                          {invoice.invoice_number || 'Faktura'}
                        </p>
                        <a
                          href={invoice.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 px-6 py-3 bg-brand-primary text-white rounded-lg hover:bg-brand-primary-hover transition font-medium"
                        >
                          <ExternalLink className="w-5 h-5" />
                          <span>Otwórz PDF w nowej karcie</span>
                        </a>
                      </div>
                    </div>
                  ) : invoice.file_url.includes('drive.google.com') ? (
                    <div className="flex flex-col items-center justify-center gap-6 p-8 h-full">
                      <FileText className="w-24 h-24 text-slate-400" />
                      <div className="text-center">
                        <p className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">
                          Dokument w Google Drive
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                          {invoice.invoice_number || 'Faktura'}
                        </p>
                        <a
                          href={invoice.file_url}
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
                      src={invoice.file_url}
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
                          {invoice.invoice_number || 'Przetwarzanie...'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">Status</label>
                      {isEditing ? (
                        <select
                          value={editedInvoice.status || invoice.status}
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
                          {statusLabels[getUserSpecificStatus(invoice, profile?.id || '')] || invoice.status}
                        </p>
                      )}
                    </div>
                  </div>

                  {isInvalidBuyer && (
                    <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-600 dark:border-red-500 rounded-lg p-3 flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-red-900 dark:text-red-300 text-sm">Błędny nabywca!</p>
                        <p className="text-red-800 dark:text-red-400 text-xs mt-0.5">
                          Aura Herbals (NIP: 5851490834) to kupujący (nabywca), nie sprzedawca (dostawca).
                          AI prawdopodobnie pomyliło strony na fakturze. Użyj przycisku "Przetwórz ponownie przez AI" lub popraw dane ręcznie.
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
                          {(invoice.supplier_name || 'Przetwarzanie...').replace(/\[BŁĄD[^\]]*\]\s*/g, '')}
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
                          {(invoice.supplier_nip || '—').replace(/\[BŁĄD[^\]]*\]\s*/g, '')}
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
                          {invoice.issue_date
                            ? new Date(invoice.issue_date).toLocaleDateString('pl-PL')
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
                          {invoice.due_date
                            ? new Date(invoice.due_date).toLocaleDateString('pl-PL')
                            : '—'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Dział główny
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
                          {invoice.department?.name || '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Dział nadrzędny
                      </label>
                      <p className="text-base font-semibold text-text-primary-light dark:text-text-primary-dark mt-1">
                        {invoice.department?.parent?.name || '—'}
                      </p>
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
                          {invoice.currency || '—'}
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
                          {invoice.description || '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark uppercase tracking-wide">
                        Miejsce powstawania kosztu (MPK)
                      </label>
                      {isEditing ? (
                        <div className="relative mt-1">
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
                      ) : (
                        <p className="text-sm text-text-primary-light dark:text-text-primary-dark mt-1">
                          {(() => {
                            const cc = costCenters.find(c => c.id === (invoice as any).cost_center_id);
                            return cc ? `${cc.code} - ${cc.description}` : '—';
                          })()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

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
                        value={editedInvoice.net_amount || ''}
                        onChange={(e) => setEditedInvoice({ ...editedInvoice, net_amount: parseFloat(e.target.value) })}
                        className="w-full mt-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                      />
                    ) : (
                      <p className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark mt-1">
                        {invoice.net_amount
                          ? `${invoice.net_amount.toFixed(2)} ${invoice.currency}`
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
                        value={editedInvoice.tax_amount || ''}
                        onChange={(e) => setEditedInvoice({ ...editedInvoice, tax_amount: parseFloat(e.target.value) })}
                        className="w-full mt-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                      />
                    ) : (
                      <p className="text-lg font-bold text-text-primary-light dark:text-text-primary-dark mt-1">
                        {invoice.tax_amount
                          ? `${invoice.tax_amount.toFixed(2)} ${invoice.currency}`
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
                        value={editedInvoice.gross_amount || ''}
                        onChange={(e) => setEditedInvoice({ ...editedInvoice, gross_amount: parseFloat(e.target.value) })}
                        className="w-full mt-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-light-surface dark:bg-dark-surface text-text-primary-light dark:text-text-primary-dark focus:ring-2 focus:ring-brand-primary text-sm"
                      />
                    ) : (
                      <div className="mt-1">
                        <p className="text-lg font-bold text-brand-primary">
                          {invoice.gross_amount
                            ? `${invoice.gross_amount.toFixed(2)} ${invoice.currency}`
                            : '—'}
                        </p>
                        {invoice.currency !== 'PLN' && invoice.pln_gross_amount && (
                          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark mt-1">
                            = {invoice.pln_gross_amount.toFixed(2)} PLN
                            {invoice.exchange_rate && (
                              <span className="text-xs ml-1">
                                (kurs: {invoice.exchange_rate.toFixed(4)})
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
                invoiceId={invoice.id}
                isEditing={isEditing}
                supplierName={invoice.supplier_name}
                supplierNip={invoice.supplier_nip}
                description={invoice.description}
                grossAmount={invoice.gross_amount}
                currency={invoice.currency}
                departmentId={invoice.department_id}
                showConfirmButton={!isEditing && invoice.status === 'draft' && invoice.uploaded_by === profile?.id}
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
              Czy na pewno chcesz usunąć fakturę <strong>{invoice.invoice_number || 'bez numeru'}</strong>?
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
              Czy na pewno chcesz cofnąć przypisanie faktury <strong>{invoice.invoice_number || 'bez numeru'}</strong>?
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
          invoiceId={invoice.id}
          currentDepartmentId={invoice.department_id}
          onClose={() => setShowTransferModal(false)}
          onTransferToApproval={handleForwardToCirculation}
          onTransferToDepartment={handleTransferToDepartment}
        />
      )}
    </div>
  );
}
