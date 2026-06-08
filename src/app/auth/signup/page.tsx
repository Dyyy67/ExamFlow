'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail, Lock, User, Building2 } from 'lucide-react';
import { Button, Input, Card } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    school_name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
      options: {
        data: {
          full_name: formData.name,
          school_name: formData.school_name,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-navy-900 py-12">
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-tr from-indigo-900/40 via-navy-900 to-blue-900/40 pointer-events-none" />
      
      <div className="z-10 w-full max-w-md px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Create Account</h1>
          <p className="text-gray-400">Join ExamFlow to start grading smarter</p>
        </div>

        <Card padding="lg">
          <form onSubmit={handleSignup} className="flex flex-col gap-4">
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
                {error}
              </div>
            )}
            
            <Input
              name="name"
              label="Full Name"
              type="text"
              placeholder="Jane Doe"
              icon={<User size={18} />}
              value={formData.name}
              onChange={handleChange}
              required
            />

            <Input
              name="school_name"
              label="School Name"
              type="text"
              placeholder="Springfield High School"
              icon={<Building2 size={18} />}
              value={formData.school_name}
              onChange={handleChange}
              required
            />
            
            <Input
              name="email"
              label="Email Address"
              type="email"
              placeholder="teacher@school.edu"
              icon={<Mail size={18} />}
              value={formData.email}
              onChange={handleChange}
              required
            />
            
            <Input
              name="password"
              label="Password"
              type="password"
              placeholder="••••••••"
              icon={<Lock size={18} />}
              value={formData.password}
              onChange={handleChange}
              required
            />

            <Input
              name="confirmPassword"
              label="Confirm Password"
              type="password"
              placeholder="••••••••"
              icon={<Lock size={18} />}
              value={formData.confirmPassword}
              onChange={handleChange}
              required
            />
            
            <Button type="submit" loading={loading} className="w-full mt-2">
              Create Account
            </Button>
            
            <div className="text-center mt-4">
              <Link href="/auth/login" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                Already have an account? Sign in
              </Link>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
