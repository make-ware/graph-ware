'use client';

import { createContext, useContext } from 'react';
import { FALLBACK_PORT_KIND_COLOR } from '@project/shared';

const PortKindColorContext = createContext<(kind: string) => string>(
  () => FALLBACK_PORT_KIND_COLOR
);

export function PortKindColorProvider({
  colorFor,
  children,
}: {
  colorFor: (kind: string) => string;
  children: React.ReactNode;
}) {
  return (
    <PortKindColorContext.Provider value={colorFor}>
      {children}
    </PortKindColorContext.Provider>
  );
}

export function usePortKindColor(): (kind: string) => string {
  return useContext(PortKindColorContext);
}
