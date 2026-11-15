import type { Metadata } from "next";
import { AuthForm } from "../AuthForm";
export const metadata: Metadata = { title: "Log in · Slate" };
export default function AuthPage() {
  return <AuthForm mode="login" />;
}
