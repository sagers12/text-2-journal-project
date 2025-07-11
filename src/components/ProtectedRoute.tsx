
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const { user, session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    console.log('ProtectedRoute - Auth state:', { 
      loading, 
      hasUser: !!user, 
      hasSession: !!session,
      userId: user?.id 
    });
    
    // Only redirect if we're done loading and there's no valid session
    if (!loading && (!user || !session)) {
      console.log('Redirecting to sign-in - missing auth');
      navigate('/sign-in', { replace: true });
    }
  }, [user, session, loading, navigate]);

  // Show loading while auth state is being determined
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  // Don't render children if no auth
  if (!user || !session) {
    return null;
  }

  return <>{children}</>;
};
