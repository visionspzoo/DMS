export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'Administrator' | 'CEO' | 'Dyrektor' | 'Kierownik' | 'Specjalista';
export type InvoiceStatus = 'draft' | 'waiting' | 'pending' | 'in_review' | 'approved' | 'accepted' | 'rejected' | 'paid';
export type ApprovalAction = 'approved' | 'rejected';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: UserRole;
          department_id: string | null;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
          preferred_llm_model: string;
          department?: {
            id: string;
            name: string;
          } | null;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          role: UserRole;
          department_id?: string | null;
          is_admin?: boolean;
          preferred_llm_model?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string;
          role?: UserRole;
          department_id?: string | null;
          is_admin?: boolean;
          preferred_llm_model?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      invoices: {
        Row: {
          id: string;
          invoice_number: string | null;
          supplier_name: string | null;
          supplier_nip: string | null;
          issue_date: string | null;
          due_date: string | null;
          net_amount: number | null;
          tax_amount: number | null;
          gross_amount: number | null;
          currency: string;
          file_url: string;
          pdf_base64: string | null;
          google_drive_id: string | null;
          ocr_data: Json | null;
          status: InvoiceStatus;
          uploaded_by: string;
          created_at: string;
          updated_at: string;
          department_id: string | null;
          department?: {
            id: string;
            name: string;
          } | null;
          rejection_reason: string | null;
          rejected_by: string | null;
          rejected_at: string | null;
          paid_at: string | null;
          paid_by: string | null;
          description: string | null;
        };
        Insert: {
          id?: string;
          invoice_number?: string | null;
          supplier_name?: string | null;
          supplier_nip?: string | null;
          issue_date?: string | null;
          due_date?: string | null;
          net_amount?: number | null;
          tax_amount?: number | null;
          gross_amount?: number | null;
          currency?: string;
          file_url: string;
          pdf_base64?: string | null;
          google_drive_id?: string | null;
          ocr_data?: Json | null;
          status?: InvoiceStatus;
          uploaded_by: string;
          created_at?: string;
          updated_at?: string;
          department_id?: string | null;
          rejection_reason?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          description?: string | null;
        };
        Update: {
          id?: string;
          invoice_number?: string | null;
          supplier_name?: string | null;
          supplier_nip?: string | null;
          issue_date?: string | null;
          due_date?: string | null;
          net_amount?: number | null;
          tax_amount?: number | null;
          gross_amount?: number | null;
          currency?: string;
          file_url?: string;
          pdf_base64?: string | null;
          google_drive_id?: string | null;
          ocr_data?: Json | null;
          status?: InvoiceStatus;
          uploaded_by?: string;
          created_at?: string;
          updated_at?: string;
          department_id?: string | null;
          rejection_reason?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          description?: string | null;
        };
      };
      approvals: {
        Row: {
          id: string;
          invoice_id: string;
          approver_id: string;
          approver_role: string;
          action: ApprovalAction;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          invoice_id: string;
          approver_id: string;
          approver_role: string;
          action: ApprovalAction;
          comment?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          approver_id?: string;
          approver_role?: string;
          action?: ApprovalAction;
          comment?: string | null;
          created_at?: string;
        };
      };
      workflow_rules: {
        Row: {
          id: string;
          role: UserRole;
          order: number;
          required: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          role: UserRole;
          order: number;
          required?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          role?: UserRole;
          order?: number;
          required?: boolean;
          created_at?: string;
        };
      };
      departments: {
        Row: {
          id: string;
          name: string;
          parent_department_id: string | null;
          manager_id: string | null;
          max_invoice_amount: number | null;
          max_monthly_amount: number | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          parent_department_id?: string | null;
          manager_id?: string | null;
          max_invoice_amount?: number | null;
          max_monthly_amount?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          parent_department_id?: string | null;
          manager_id?: string | null;
          max_invoice_amount?: number | null;
          max_monthly_amount?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
      };
      audit_logs: {
        Row: {
          id: string;
          invoice_id: string;
          user_id: string;
          action: string;
          details: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          invoice_id: string;
          user_id: string;
          action: string;
          details?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          user_id?: string;
          action?: string;
          details?: Json | null;
          created_at?: string;
        };
      };
      invoice_departments: {
        Row: {
          id: string;
          invoice_id: string;
          department_id: string;
          is_primary: boolean;
          created_at: string;
          department?: {
            id: string;
            name: string;
          } | null;
        };
        Insert: {
          id?: string;
          invoice_id: string;
          department_id: string;
          is_primary?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          department_id?: string;
          is_primary?: boolean;
          created_at?: string;
        };
      };
    };
  };
}
