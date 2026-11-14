/** Email link types Slate's /auth/confirm accepts (Supabase's EmailOtpType values). */
export const CONFIRM_TYPES = ['email', 'signup', 'recovery', 'invite', 'magiclink', 'email_change'] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];
