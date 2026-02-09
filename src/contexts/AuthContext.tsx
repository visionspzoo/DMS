import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { UserRole } from '../lib/database.types';

interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_admin: boolean;
  department_id: string | null;
  last_login_at?: string;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        setUser(session.user);
        loadProfile(session.user.id, session.user.email || undefined);
      } else {
        setLoading(false);
      }
      if (window.location.hash) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted || event === 'INITIAL_SESSION') return;

      if (session?.user) {
        setUser(session.user);
        (async () => {
          if (mounted) await loadProfile(session.user.id, session.user.email || undefined);
        })();
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (userId: string, email?: string | null) => {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      if (!data && email) {
        const { data: emailProfile, error: emailError } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', email)
          .maybeSingle();

        if (!emailError && emailProfile) {
          data = emailProfile;
        }
      }

      if (data) {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        const googleName = authUser?.user_metadata?.full_name || authUser?.user_metadata?.name;
        if (googleName && googleName !== data.full_name) {
          await supabase
            .from('profiles')
            .update({ full_name: googleName })
            .eq('id', data.id);
          data = { ...data, full_name: googleName };
        }

        await supabase.rpc('update_last_login');

        setProfile(data);
      } else {
        // No profile found - user needs a valid invitation to access the system
        console.warn('No profile found for user. User must be invited to access the system.');

        // Sign out the user since they don't have a valid profile
        await supabase.auth.signOut();

        // Show error message
        alert('Brak dostępu: Musisz otrzymać zaproszenie aby uzyskać dostęp do systemu. Skontaktuj się z administratorem.');

        setUser(null);
        setProfile(null);
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
