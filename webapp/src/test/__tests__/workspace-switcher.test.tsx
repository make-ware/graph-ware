import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceSwitcher } from '@/components/layout/workspace-switcher';
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/contexts/workspace-context';

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

function membership(id: string, name: string, personal: boolean) {
  return {
    workspace: { id, name, slug: name.toLowerCase(), personal },
    role: 'owner',
  } as unknown as WorkspaceContextValue['memberships'][number];
}

function withContext(value: Partial<WorkspaceContextValue>) {
  const memberships = value.memberships ?? [];
  return (
    <WorkspaceContext.Provider
      value={
        {
          memberships,
          active: memberships[0]?.workspace ?? null,
          role: 'owner',
          canWrite: true,
          canAdminister: true,
          isLoading: false,
          error: null,
          setActive: vi.fn(),
          reload: vi.fn(),
          ...value,
        } as WorkspaceContextValue
      }
    >
      <WorkspaceSwitcher />
    </WorkspaceContext.Provider>
  );
}

describe('WorkspaceSwitcher', () => {
  it('renders nothing when no provider is mounted', () => {
    // The navigation bar now renders on `(viewer)`, which deliberately has no
    // WorkspaceProvider. Reading the context through `useWorkspaces` would
    // throw and take the whole graph route down with it.
    const { container } = render(<WorkspaceSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides itself for a lone personal workspace', () => {
    const { container } = render(
      withContext({ memberships: [membership('w1', 'Personal', true)] })
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the active workspace when there is a choice', () => {
    render(
      withContext({
        memberships: [
          membership('w1', 'Personal', true),
          membership('w2', 'Acme', false),
        ],
      })
    );

    expect(
      screen.getByRole('button', { name: /personal/i })
    ).toBeInTheDocument();
  });
});
