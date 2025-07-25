
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTimezone } from '@/hooks/useTimezone';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useCSRFToken } from '@/components/CSRFToken';
import { sanitizeInput, detectSuspiciousActivity, logSecurityEvent, checkClientRateLimit } from '@/utils/securityMonitoring';
import { Eye, EyeOff } from 'lucide-react';

interface SignUpFormProps {
  loading: boolean;
  setLoading: (loading: boolean) => void;
  onSignUpSuccess: (phoneNumber: string) => void;
}

export const SignUpForm = ({ loading, setLoading, onSignUpSuccess }: SignUpFormProps) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [smsConsent, setSmsConsent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const { signUp } = useAuth();
  const { toast } = useToast();
  const { userTimezone } = useTimezone();
  const { csrfToken, validateAndRefreshToken } = useCSRFToken();

  const consentText = "I authorize Journal By Text to send journaling reminders and prompts to the provided phone number using automated means. Message/data rates apply. Message frequency varies. Text HELP for help or STOP to opt out. Consent is not a condition of purchase. See privacy policy.";

  const formatPhoneNumber = (input: string) => {
    // Remove all non-digit characters
    const digits = input.replace(/\D/g, '');
    
    // If it starts with 1, remove it (we'll add +1 later)
    const cleanDigits = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
    
    // Ensure we have exactly 10 digits
    if (cleanDigits.length === 10) {
      return `+1${cleanDigits}`;
    }
    
    return null;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow user to type, but limit to reasonable length
    if (value.replace(/\D/g, '').length <= 11) {
      setPhoneNumber(value);
    }
  };

  const storeSmsConsent = async (userId: string, formattedPhone: string) => {
    try {
      const { error } = await supabase
        .from('sms_consents')
        .insert({
          user_id: userId,
          phone_number: formattedPhone,
          consent_text: consentText,
          user_agent: navigator.userAgent,
        });

      if (error) {
        console.error('Failed to store SMS consent:', error);
      } else {
        console.log('SMS consent recorded successfully');
      }
    } catch (error) {
      console.error('Error storing SMS consent:', error);
    }
  };

  const sendSignupConfirmation = async (formattedPhone: string) => {
    try {
      const { error } = await supabase.functions.invoke('send-signup-confirmation', {
        body: { phoneNumber: formattedPhone }
      });

      if (error) throw error;
      
      console.log('Signup confirmation SMS sent successfully');
    } catch (error) {
      console.error('Error sending signup confirmation:', error);
      // Don't throw here - we don't want to block signup for SMS issues
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      // CSRF protection
      const validToken = validateAndRefreshToken();
      if (!validToken) {
        throw new Error('Security token validation failed. Please refresh the page.');
      }

      // Client-side rate limiting
      if (!checkClientRateLimit('signup', 3)) {
        throw new Error('Too many signup attempts. Please wait before trying again.');
      }

      // Input validation and sanitization
      if (!email) {
        throw new Error('Email is required for account creation');
      }
      if (!phoneNumber) {
        throw new Error('Phone number is required for account creation');
      }
      if (!smsConsent) {
        throw new Error('You must agree to receive SMS messages to use SMS Journal');
      }

      const sanitizedEmail = sanitizeInput(email, 254);
      const sanitizedPhone = phoneNumber ? sanitizeInput(phoneNumber, 20) : '';

      // Check for suspicious activity
      if (detectSuspiciousActivity(email) || detectSuspiciousActivity(phoneNumber)) {
        await logSecurityEvent({
          event_type: 'suspicious_signup_attempt',
          identifier: email,
          details: {
            suspicious_email: email,
            suspicious_phone: phoneNumber,
            user_agent: navigator.userAgent
          },
          severity: 'high'
        });
        throw new Error('Invalid input detected. Please check your information.');
      }
      
      // Format and validate phone number
      const formattedPhone = formatPhoneNumber(sanitizedPhone);
      if (!formattedPhone) {
        throw new Error('Please enter a valid 10-digit US phone number');
      }
      
      const { data, error } = await signUp(sanitizedEmail, password, formattedPhone, userTimezone);
      if (error) {
        // Handle specific error for duplicate phone number
        if (error.message.includes('duplicate key value violates unique constraint "profiles_phone_number_unique"')) {
          throw new Error('This phone number is already registered with another account. Please use a different phone number or sign in to your existing account.');
        }
        throw error;
      }
      
      // Store SMS consent record after successful signup
      if (data.user?.id) {
        await storeSmsConsent(data.user.id, formattedPhone);
        
        // Send signup confirmation SMS
        await sendSignupConfirmation(formattedPhone);
      }
      
      onSignUpSuccess(formattedPhone);
      toast({
        title: "Account created!",
        description: "We've sent a confirmation message to your phone. Please reply YES to start journaling via SMS."
      });
    } catch (error: any) {
      // Log failed signup attempt
      await logSecurityEvent({
        event_type: 'failed_signup',
        identifier: email || 'unknown',
        details: {
          error: error.message,
          user_agent: navigator.userAgent
        },
        severity: 'low'
      });

      toast({
        title: "Sign up failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSignUp} className="space-y-4">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <div>
        <Label htmlFor="signup-email">Email</Label>
        <Input 
          id="signup-email" 
          type="email" 
          value={email} 
          onChange={e => setEmail(e.target.value)} 
          placeholder="your@email.com" 
          required 
        />
        <p className="text-xs text-slate-500 mt-1">
          Used for account verification and recovery
        </p>
      </div>
      <div>
        <Label htmlFor="signup-phone">Phone Number</Label>
        <Input 
          id="signup-phone" 
          type="tel" 
          value={phoneNumber} 
          onChange={handlePhoneChange} 
          placeholder="5551234567" 
          required
        />
        <p className="text-xs text-slate-500 mt-1">
          Enter your 10-digit US phone number (we'll automatically add +1). Each phone number can only be used for one account.
        </p>
      </div>
      <div className="flex items-start space-x-2">
        <Checkbox 
          id="sms-consent" 
          checked={smsConsent}
          onCheckedChange={(checked) => setSmsConsent(checked === true)}
        />
        <div className="grid gap-1.5 leading-none">
          <Label 
            htmlFor="sms-consent"
            className="text-sm font-normal leading-snug peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            I authorize Journal By Text to send journaling reminders and prompts to the provided phone number using automated means. Message/data rates apply. Message frequency varies. Text HELP for help or STOP to opt out. Consent is not a condition of purchase. See{' '}
            <Link to="/privacy" className="text-blue-600 hover:text-blue-700 underline">
              privacy policy
            </Link>
            .
          </Label>
        </div>
      </div>
      <div>
        <Label htmlFor="signup-password">Password</Label>
        <div className="relative">
          <Input 
            id="signup-password" 
            type={showPassword ? "text" : "password"}
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            required 
            minLength={8}
            pattern="^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$"
            title="Password must be at least 8 characters long and contain uppercase, lowercase, and at least one number"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4 text-slate-400 hover:text-slate-600" />
            ) : (
              <Eye className="h-4 w-4 text-slate-400 hover:text-slate-600" />
            )}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Minimum 8 characters with uppercase, lowercase, and at least one number
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Creating account...' : 'Sign Up'}
      </Button>
    </form>
  );
};
