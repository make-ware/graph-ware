'use client';

import { useContext } from 'react';
import { GraphViewerContext } from '@/contexts/graph-viewer-context';

export function useGraphViewer() {
  const context = useContext(GraphViewerContext);
  if (context === undefined) {
    throw new Error('useGraphViewer must be used within a GraphViewerProvider');
  }
  return context;
}
