import type { Metadata } from 'next';
import { AuthForm } from '../AuthForm';
export const metadata: Metadata = { title: 'Reset your password · Slate' };
export default function AuthPage() { return <AuthForm mode="forgot"/>; }
