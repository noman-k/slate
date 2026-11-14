import type { Metadata } from 'next';
import { AuthForm } from '../AuthForm';
export const metadata: Metadata = { title: 'Create an account · Slate' };
export default function AuthPage() { return <AuthForm mode="register"/>; }
