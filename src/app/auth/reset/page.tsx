import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";
export const metadata: Metadata = { title: "Set a new password · Slate" };
export default function AuthPage() {
  return <AuthForm mode="reset" />;
}
