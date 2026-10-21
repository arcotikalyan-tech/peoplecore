import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthLayout } from '@/components/marketing/auth-layout';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Sign up', robots: { index: true, follow: true } };

export default function SignupPage() {
  return (
    <AuthLayout
      title="Sign up for PeopleCore"
      subtitle="Tell us about your company. We’ll create your workspace and help you bring your people and payroll across."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link></>}
    >
      <SignupForm />
    </AuthLayout>
  );
}
