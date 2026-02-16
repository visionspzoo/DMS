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
    const { role, department_id, is_admin, id: userId } = profile;

    // CEO widzi wszystkie działy
    if (role === 'CEO') {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');

      if (error) throw error;
      return data || [];
    }

    // Admin zawsze widzi wszystkie działy
    if (is_admin) {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');

      if (error) throw error;
      return data || [];
    }

    // Dyrektor widzi działy, których jest dyrektorem + swój dział + wszystkie poddziały
    if (role === 'Dyrektor') {
      const deptIds: string[] = [];

      // 1. Pobierz działy, których Dyrektor jest dyrektorem (director_id)
      const { data: directorDepts, error: directorError } = await supabase
        .from('departments')
        .select('id, name')
        .eq('director_id', userId);

      if (!directorError && directorDepts) {
        deptIds.push(...directorDepts.map(d => d.id));
      }

      // 2. Pobierz hierarchię działów jeśli ma przypisany department_id
      if (department_id) {
        const { data, error } = await supabase.rpc('get_department_hierarchy', {
          dept_id: department_id,
        });

        if (!error && data) {
          const hierarchyIds = data.map((d: any) => d.department_id);
          hierarchyIds.forEach((id: string) => {
            if (!deptIds.includes(id)) {
              deptIds.push(id);
            }
          });
        } else if (!deptIds.includes(department_id)) {
          // Fallback: dodaj przynajmniej swój dział
          deptIds.push(department_id);
        }
      }

      // Pobierz wszystkie działy
      if (deptIds.length > 0) {
        const { data: depts, error: deptsError } = await supabase
          .from('departments')
          .select('id, name')
          .in('id', deptIds)
          .order('name');

        if (deptsError) throw deptsError;
        return depts || [];
      }

      return [];
    }

    // Kierownik lub Specjalista: sprawdź user_department_access
    const { data: accessData, error: accessError } = await supabase
      .from('user_department_access')
      .select('department_id')
      .eq('user_id', userId);

    if (accessError) throw accessError;

    // Jeśli ma przypisane dodatkowe działy, użyj ich
    if (accessData && accessData.length > 0) {
      const deptIds = accessData.map(a => a.department_id);

      // Dodaj też swój główny dział jeśli istnieje
      if (department_id && !deptIds.includes(department_id)) {
        deptIds.push(department_id);
      }

      const { data: depts, error: deptsError } = await supabase
        .from('departments')
        .select('id, name')
        .in('id', deptIds)
        .order('name');

      if (deptsError) throw deptsError;
      return depts || [];
    }

    // Jeśli nie ma dodatkowych uprawnień, pokaż tylko swój dział
    if (department_id) {
      const { data: deptData, error: deptError } = await supabase
        .from('departments')
        .select('id, name')
        .eq('id', department_id)
        .order('name');

      if (deptError) throw deptError;
      return deptData || [];
    }

    // Jeśli użytkownik nie ma działu, nie pokazuj żadnych działów
    return [];
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
