
import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const clearAuthState = () => {
    console.log('Clearing auth state');
    setSession(null);
    setUser(null);
  };

  useEffect(() => {
    let mounted = true;

    // Get initial session
    const getInitialSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting session:', error);
          if (mounted) {
            clearAuthState();
            setLoading(false);
          }
          return;
        }

        if (mounted) {
          if (session?.user) {
            console.log('Initial session found:', { userId: session.user.id });
            setSession(session);
            setUser(session.user);
          } else {
            console.log('No initial session found');
            clearAuthState();
          }
          setLoading(false);
        }
      } catch (error) {
        console.error('Session check failed:', error);
        if (mounted) {
          clearAuthState();
          setLoading(false);
        }
      }
    };

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event, session ? 'session exists' : 'no session');
        
        if (!mounted) return;

        if (event === 'SIGNED_OUT' || !session) {
          clearAuthState();
          setLoading(false);
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          if (session?.user) {
            setSession(session);
            setUser(session.user);
          } else {
            clearAuthState();
          }
          setLoading(false);
        }
      }
    );

    // Get initial session
    getInitialSession();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, phoneNumber?: string, timezone?: string) => {
    // Use secure-auth edge function for rate limiting and enhanced security
    const { data, error } = await supabase.functions.invoke('secure-auth', {
      body: {
        action: 'signup',
        email,
        password,
        phoneNumber,
        timezone
      }
    });

    if (error) return { data: null, error };
    return { data: data.data, error: null };
  };

  const signIn = async (email: string, password: string) => {
    try {
      // Step 1: Validate with security checks
      const { data: validationData, error: validationError } = await supabase.functions.invoke('secure-auth', {
        body: {
          action: 'signin',
          email,
          password
        }
      });

      if (validationError) {
        return { data: null, error: validationError };
      }

      if (!validationData?.validation_passed) {
        return { data: null, error: new Error('Security validation failed') };
      }

      // Step 2: Perform actual client-side authentication
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        // Handle failed login attempt tracking
        await supabase.functions.invoke('track-login-failure', {
          body: { email, error: authError.message }
        }).catch(console.error); // Don't fail main flow if tracking fails

        return { data: null, error: authError };
      }

      return { data: authData, error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { data: null, error: error instanceof Error ? error : new Error('Unknown error') };
    }
  };

  const signOut = async () => {
    console.log('Attempting sign out');
    
    try {
      clearAuthState();
      const { error } = await supabase.auth.signOut();
      
      if (error) {
        console.log('Server sign out failed, but local state cleared:', error.message);
      }
      
      return { error: null };
    } catch (error) {
      console.error('Sign out error:', error);
      return { error: null };
    }
  };

  const resetPassword = async (email: string) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });
    
    return { data, error };
  };

  return {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    isAuthenticated: !!user && !!session
  };
};
