import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthContext } from '@/contexts/auth-context';
import Home from '@/app/(shell)/page';

// Property test generator for user data
function generateRandomUser() {
  const id = Math.random().toString(36).substring(7);
  const names = [
    'Alice',
    'Bob',
    'Charlie',
    'Diana',
    'Eve',
    'Frank',
    'Grace',
    'Henry',
  ];
  const domains = ['example.com', 'test.org', 'demo.net', 'sample.io'];

  const name =
    names[Math.floor(Math.random() * names.length)] +
    Math.random().toString(36).substring(2, 5);
  const email = `${name.toLowerCase()}@${domains[Math.floor(Math.random() * domains.length)]}`;

  return {
    id,
    name,
    email,
    password: 'password123',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    collectionId: 'users',
    collectionName: 'users',
    expand: {},
  };
}

// Mock auth context provider for testing
function MockAuthProvider({
  children,
  user,
  isAuthenticated = false,
  isLoading = false,
}: {
  children: React.ReactNode;
  user?: any;
  isAuthenticated?: boolean;
  isLoading?: boolean;
}) {
  const mockValue = {
    user: user || null,
    isLoading,
    isAuthenticated,
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    updateProfile: vi.fn(),
    changePassword: vi.fn(),
  };

  return (
    <AuthContext.Provider value={mockValue}>{children}</AuthContext.Provider>
  );
}

describe('Personalized Content Property Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Property 11: Personalized Content
   * For any authenticated user, personalized content (such as welcome messages
   * with their name) should be displayed correctly.
   */
  it('Property 11: Personalized Content - should display user name in welcome message', () => {
    const testUsers = Array.from({ length: 5 }, generateRandomUser);

    for (const testUser of testUsers) {
      const { unmount } = render(
        <MockAuthProvider user={testUser} isAuthenticated={true}>
          <Home />
        </MockAuthProvider>
      );

      const welcomeMessage = screen.getByRole('heading', {
        name: new RegExp(`Welcome back, ${testUser.name}`, 'i'),
      });
      expect(welcomeMessage).toBeInTheDocument();
      expect(welcomeMessage.textContent).toContain(testUser.name);
      expect(welcomeMessage.textContent).not.toBe('Welcome back, ');

      unmount();
    }
  });

  it('Property 11: Personalized Content - should display email when name is not available', () => {
    const testUsers = Array.from({ length: 3 }, () => ({
      ...generateRandomUser(),
      name: '', // Remove name
    }));

    for (const testUser of testUsers) {
      const { unmount } = render(
        <MockAuthProvider user={testUser} isAuthenticated={true}>
          <Home />
        </MockAuthProvider>
      );

      // Should fall back to email when name is not available
      const welcomeMessage = screen.getByRole('heading', {
        name: new RegExp(`Welcome back, ${testUser.email}`, 'i'),
      });
      expect(welcomeMessage).toBeInTheDocument();
      expect(welcomeMessage.textContent).toContain(testUser.email);

      unmount();
    }
  });

  it('Property 11: Personalized Content - should display user info in account section', () => {
    const testUsers = [
      ...Array.from({ length: 3 }, generateRandomUser),
      { ...generateRandomUser(), name: '' },
    ];

    for (const testUser of testUsers) {
      const { unmount } = render(
        <MockAuthProvider user={testUser} isAuthenticated={true}>
          <Home />
        </MockAuthProvider>
      );

      expect(screen.getByText(testUser.email)).toBeInTheDocument();

      if (testUser.name) {
        expect(screen.getByText(testUser.name)).toBeInTheDocument();
      } else {
        expect(screen.getByText('Not set')).toBeInTheDocument();
      }

      unmount();
    }
  });

  it('Property 11: Personalized Content - should not display personalized content for unauthenticated users', () => {
    const testUser = generateRandomUser();

    render(
      <MockAuthProvider user={null} isAuthenticated={false}>
        <Home />
      </MockAuthProvider>
    );

    // Should not display a personalized welcome message
    expect(
      screen.queryByText(new RegExp(`Welcome back, ${testUser.name}`, 'i'))
    ).not.toBeInTheDocument();

    // Should display the generic signed-out call to action instead
    expect(screen.getByText(/Get started/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign in/i)).toBeInTheDocument();
  });

  it('Property 11: Personalized Content - should handle special characters in names', () => {
    const specialUsers = [
      { ...generateRandomUser(), name: 'José María' },
      { ...generateRandomUser(), name: '李小明' },
      { ...generateRandomUser(), name: 'Müller-Schmidt' },
      { ...generateRandomUser(), name: "O'Connor" },
    ];

    for (const testUser of specialUsers) {
      const { unmount } = render(
        <MockAuthProvider user={testUser} isAuthenticated={true}>
          <Home />
        </MockAuthProvider>
      );

      const welcomeMessage = screen.getByRole('heading', {
        name: new RegExp(
          `Welcome back, ${testUser.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          'i'
        ),
      });
      expect(welcomeMessage).toBeInTheDocument();
      expect(welcomeMessage.textContent).toContain(testUser.name);

      unmount();
    }
  });

  it('Property 11: Personalized Content - should handle very long names gracefully', () => {
    const longNameUser = {
      ...generateRandomUser(),
      name: 'Bartholomew Maximilian Alexander Montgomery-Fitzpatrick III',
    };

    render(
      <MockAuthProvider user={longNameUser} isAuthenticated={true}>
        <Home />
      </MockAuthProvider>
    );

    const welcomeMessage = screen.getByRole('heading', {
      name: new RegExp(`Welcome back, ${longNameUser.name}`, 'i'),
    });
    expect(welcomeMessage).toBeInTheDocument();
    expect(welcomeMessage.textContent).toContain(longNameUser.name);
  });

  it('Property 11: Personalized Content - should maintain personalization consistency across components', () => {
    const testUser = generateRandomUser();

    render(
      <MockAuthProvider user={testUser} isAuthenticated={true}>
        <Home />
      </MockAuthProvider>
    );

    // Every rendering of the user's email must agree
    const emailElements = screen.getAllByText(testUser.email);
    expect(emailElements.length).toBeGreaterThan(0);
    emailElements.forEach((element) => {
      expect(element.textContent).toBe(testUser.email);
    });

    const nameElements = screen.getAllByText(testUser.name);
    expect(nameElements.length).toBeGreaterThan(0);
    nameElements.forEach((element) => {
      expect(element.textContent).toBe(testUser.name);
    });
  });
});
