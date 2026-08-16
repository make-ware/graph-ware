/**
 * The avatar fallback: initials from a name, else the first letter of the
 * email, else a neutral `U`.
 *
 * Shared because the desktop bar and the mobile sheet both draw the avatar and
 * would otherwise each carry a copy.
 */
export function userInitials(name?: string, email?: string): string {
  if (name) {
    const initials = name
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    if (initials) return initials;
  }
  if (email) return email[0].toUpperCase();
  return 'U';
}
