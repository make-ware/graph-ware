import { Library, Network, Settings, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The application's top-level destinations.
 *
 * Both the desktop bar and the mobile sheet render this same array. They used
 * to declare their own lists, which is how desktop ended up with no visible
 * links at all while the sheet carried four — the two navigations drifted
 * because nothing tied them together.
 */
export const PRIMARY_LINKS: NavLink[] = [
  { href: '/graphs', label: 'Graphs', icon: Network },
  { href: '/library', label: 'Library', icon: Library },
  { href: '/workspaces', label: 'Workspaces', icon: Users },
];

/** Account destinations — in the avatar menu on desktop, in the sheet on mobile. */
export const ACCOUNT_LINKS: NavLink[] = [
  { href: '/profile', label: 'Profile', icon: Settings },
];

/** Where an unauthenticated caller may go. No icons — these render as buttons. */
export const GUEST_LINKS: Array<{ href: string; label: string }> = [
  { href: '/login', label: 'Login' },
  { href: '/signup', label: 'Sign Up' },
];

/**
 * Whether `href` is the section the caller is currently in.
 *
 * Prefix matching, but only on a `/` boundary: `/graphs/new` is inside Graphs,
 * while a hypothetical `/graphset` is not. `/` is exact-only, or it would light
 * up every link.
 */
export function isActivePath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
