import type { User } from 'firebase/auth';

export const ADMIN_EMAILS = [
  'shreyasghimire71@gmail.com',
  'shreyasextra65@gmail.com',
  'modshiftt@gmaill.com',
] as const;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (ADMIN_EMAILS as readonly string[]).includes(normalized);
}

export function isAdminUser(user: User | null | undefined): boolean {
  if (!user || !user.emailVerified || !user.email) return false;
  return isAdminEmail(user.email);
}
