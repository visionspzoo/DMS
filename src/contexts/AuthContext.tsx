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
  monthly_invoice_limit?: number | null;
  single_invoice_limit?: number | null;
  last_login_at?: string;
  created_at?: string;
  can_access_ksef_config?: boolean;
  mpk_override_bez_mpk?: boolean;
  has_mpk_access?: boolean;
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

  const loadProfile = async (userId: string, email?: string | null, retryCount = 0) => {
    const MAX_RETRIES = 10; // Zwiększ z 5 do 10 dla zaproszeń
    const RETRY_DELAY = 1500; // Zwiększ z 1000ms do 1500ms

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

        supabase.rpc('update_last_login').catch(() => {});

        // Wyczyść token zaproszenia jeśli był zapisany
        const invitationToken = localStorage.getItem('invitation_token');
        if (invitationToken) {
          localStorage.removeItem('invitation_token');
        }

        setProfile(data);
        setLoading(false);
      } else {
        if (retryCount < MAX_RETRIES) {
          console.log(`Profile not found, retrying in ${RETRY_DELAY}ms... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          return loadProfile(userId, email, retryCount + 1);
        }

        console.warn('No profile found for user after all retries. User must be invited to access the system.');

        await supabase.auth.signOut();

        alert('Brak dostępu: Musisz otrzymać zaproszenie aby uzyskać dostęp do systemu. Skontaktuj się z administratorem.');

        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    } catch (error) {
      console.error('Error loading profile:', error);
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
