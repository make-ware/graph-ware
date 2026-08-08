'use client';

import { useContext } from 'react';
import { WorkspaceContext } from '@/contexts/workspace-context';

export function useWorkspaces() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspaces must be used within a WorkspaceProvider');
  }
  return context;
}
