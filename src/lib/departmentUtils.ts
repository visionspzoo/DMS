import { supabase } from './supabase';
import type { Database } from './database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type Department = Database['public']['Tables']['departments']['Row'];

interface AccessibleDepartment {
  id: string;
  name: string;
}

/**
 * Pobiera działy dostępne dla użytkownika na podstawie:
 * - Roli (CEO widzi wszystkie, Dyrektor widzi swój + poddziały, Kierownik widzi swój)
 * - Uprawnień w user_department_access
 * - is_admin (Admin zawsze widzi wszystkie działy)
 */
export async function getAccessibleDepartments(
  profile: Profile | null
): Promise<AccessibleDepartment[]> {
  if (!profile) return [];

  try {
    const { data, error } = await supabase
      .from('departments')
      .select('id, name')
      .order('name');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error loading accessible departments:', error);
    return [];
  }
}

/**
 * Sprawdza czy użytkownik ma dostęp do danego działu
 */
export async function hasAccessToDepartment(
  profile: Profile | null,
  departmentId: string
): Promise<boolean> {
  if (!profile) return false;

  const accessibleDepts = await getAccessibleDepartments(profile);
  return accessibleDepts.some(d => d.id === departmentId);
}
