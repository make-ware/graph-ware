'use client';

import { useContext } from 'react';
import { GraphEditorContext } from '@/contexts/graph-editor-context';

export function useGraphEditor() {
  const context = useContext(GraphEditorContext);
  if (context === undefined) {
    throw new Error('useGraphEditor must be used within a GraphEditorProvider');
  }
  return context;
}
