import { supabase } from './supabase';
import type { Database } from './database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

interface AccessibleDepartment {
  id: string;
  name: string;
}

export async function getAccessibleDepartments(
  profile: Profile | null
): Promise<AccessibleDepartment[]> {
  if (!profile) return [];

  try {
    if (profile.is_admin || profile.role === 'CEO') {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data || [];
    }

    const departmentIds = new Set<string>();

    if (profile.department_id) {
      departmentIds.add(profile.department_id);
    }

    if (profile.role === 'Dyrektor') {
      const { data: directedDepts } = await supabase
        .from('departments')
        .select('id, name')
        .eq('director_id', profile.id);
      if (directedDepts) {
        directedDepts.forEach(d => departmentIds.add(d.id));
      }
    }

    if (profile.role === 'Kierownik') {
      const { data: managedDepts } = await supabase
        .from('departments')
        .select('id, name')
        .eq('manager_id', profile.id);
      if (managedDepts) {
        managedDepts.forEach(d => departmentIds.add(d.id));
      }
    }

    const { data: memberDepts } = await supabase
      .from('department_members')
      .select('department_id')
      .eq('user_id', profile.id);
    if (memberDepts) {
      memberDepts.forEach(m => departmentIds.add(m.department_id));
    }

    const { data: accessDepts } = await supabase
      .from('user_department_access')
      .select('department_id')
      .eq('user_id', profile.id);
    if (accessDepts) {
      accessDepts.forEach(a => departmentIds.add(a.department_id));
    }

    if (departmentIds.size === 0) return [];

    const { data, error } = await supabase
      .from('departments')
      .select('id, name')
      .in('id', Array.from(departmentIds))
      .order('name');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error loading accessible departments:', error);
    return [];
  }
}

export async function getAllDepartments(): Promise<AccessibleDepartment[]> {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('id, name')
      .order('name');
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error loading all departments:', error);
    return [];
  }
}

export async function hasAccessToDepartment(
  profile: Profile | null,
  departmentId: string
): Promise<boolean> {
  if (!profile) return false;

  const accessibleDepts = await getAccessibleDepartments(profile);
  return accessibleDepts.some(d => d.id === departmentId);
}
