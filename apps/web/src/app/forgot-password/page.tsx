import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthLayout } from '@/components/marketing/auth-layout';
import { ForgotPasswordForm } from './forgot-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Forgot your password?" subtitle="Enter your work email and we’ll send you a link to choose a new one."
      footer={<>Remembered it? <Link href="/login" className="font-medium text-primary hover:underline">Back to sign in</Link></>}>
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
