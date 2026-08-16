import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@project/shared';
import { AuthContext } from '@/contexts/auth-context';
import { NavigationBar } from '@/components/layout/navigation-bar';
import {
  ACCOUNT_LINKS,
  PRIMARY_LINKS,
  isActivePath,
} from '@/components/layout/nav-links';

// The global setup pins `usePathname` to '/'; these tests need to move it.
const pathname = vi.hoisted(() => ({ current: '/' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => pathname.current,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock('@/lib/pocketbase', () => ({
  default: {
    authStore: {
      isValid: false,
      record: null,
      onChange: vi.fn(() => vi.fn()),
      clear: vi.fn(),
    },
  },
}));

const logout = vi.fn();

const testUser = {
  id: 'u1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  created: '',
  updated: '',
  collectionId: 'users',
  collectionName: 'users',
} as unknown as User;

function renderNav(
  props: React.ComponentProps<typeof NavigationBar> = {},
  { isAuthenticated = true }: { isAuthenticated?: boolean } = {}
) {
  return render(
    <AuthContext.Provider
      value={
        {
          user: isAuthenticated ? testUser : null,
          isLoading: false,
          isAuthenticated,
          login: vi.fn(),
          signup: vi.fn(),
          logout,
          updateProfile: vi.fn(),
          changePassword: vi.fn(),
        } as unknown as React.ContextType<typeof AuthContext>
      }
    >
      <NavigationBar {...props} />
    </AuthContext.Provider>
  );
}

/**
 * happy-dom does not evaluate Tailwind's media queries, so these assert on
 * rendered structure and on the responsive class names themselves — never on
 * computed styles, which would silently pass whatever the classes said.
 */
describe('navigation consistency', () => {
  beforeEach(() => {
    pathname.current = '/';
  });

  it('offers the same destinations on desktop and in the mobile menu', async () => {
    const user = userEvent.setup();
    renderNav();

    const desktop = screen.getByRole('navigation');
    const desktopHrefs = within(desktop)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));
    expect(desktopHrefs).toEqual(PRIMARY_LINKS.map((link) => link.href));

    await user.click(
      screen.getByRole('button', { name: /open navigation menu/i })
    );

    const dialog = await screen.findByRole('dialog');
    const sheetHrefs = within(dialog)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'));

    // The sheet adds the account links; it must never *omit* a primary one,
    // which is exactly how the two navigations had drifted apart.
    for (const link of [...PRIMARY_LINKS, ...ACCOUNT_LINKS]) {
      expect(sheetHrefs).toContain(link.href);
    }
  });

  it('renders both layouts rather than branching on a media-query hook', () => {
    const { container } = renderNav();

    // Both must exist in one render — a JS branch would emit only one, which is
    // what made a phone paint the desktop bar until hydration.
    expect(container.querySelector('.md\\:hidden')).not.toBeNull();
    expect(container.querySelector('.md\\:flex')).not.toBeNull();
  });

  it('marks the section the caller is in', () => {
    pathname.current = '/graphs/new';
    renderNav();

    const graphs = screen.getByRole('link', { name: /graphs/i });
    expect(graphs).toHaveAttribute('aria-current', 'page');

    const library = screen.getByRole('link', { name: /library/i });
    expect(library).not.toHaveAttribute('aria-current');
  });

  it('keeps the brand and the menu on the compact variant', () => {
    renderNav({ variant: 'compact' });

    expect(
      screen.getByRole('link', { name: /graph ware home/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /open navigation menu/i })
    ).toBeInTheDocument();
    // The compact bar drops the inline link row; the menu still carries it.
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('offers login and sign up when signed out', () => {
    renderNav({}, { isAuthenticated: false });

    expect(screen.getByRole('link', { name: /login/i })).toHaveAttribute(
      'href',
      '/login'
    );
    expect(screen.getByRole('link', { name: /sign up/i })).toHaveAttribute(
      'href',
      '/signup'
    );
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('isActivePath', () => {
  it('matches a section and its descendants', () => {
    expect(isActivePath('/graphs', '/graphs')).toBe(true);
    expect(isActivePath('/graphs/new', '/graphs')).toBe(true);
    expect(isActivePath('/graphs/abc/edit', '/graphs')).toBe(true);
  });

  it('does not match on a bare string prefix', () => {
    expect(isActivePath('/graphset', '/graphs')).toBe(false);
    expect(isActivePath('/library', '/graphs')).toBe(false);
  });

  it('treats the root as exact', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/graphs', '/')).toBe(false);
  });

  it('tolerates a null pathname', () => {
    expect(isActivePath(null, '/graphs')).toBe(false);
  });
});
