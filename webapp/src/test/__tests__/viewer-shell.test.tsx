import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewerShell, useViewerSurface } from '@/components/graph/viewer-shell';

const isMobile = vi.hoisted(() => ({ current: false }));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => isMobile.current,
}));

const SIZES = { sidebar: '18%', canvas: '57%', panel: '25%' };

function renderShell(extra?: { panelTitle?: string }) {
  return render(
    <div style={{ height: 600 }}>
      <ViewerShell
        sizes={SIZES}
        sidebar={<div>subgraph list</div>}
        canvas={<div data-testid="canvas">canvas</div>}
        panel={<div>detail panel</div>}
        {...extra}
      />
    </div>
  );
}

describe('ViewerShell', () => {
  beforeEach(() => {
    isMobile.current = false;
  });

  it('lays the three regions out side by side on a wide viewport', () => {
    const { container } = renderShell();

    expect(
      container.querySelectorAll('[data-slot="resizable-panel"]')
    ).toHaveLength(3);
    expect(screen.getByText('subgraph list')).toBeInTheDocument();
    expect(screen.getByText('detail panel')).toBeInTheDocument();
    expect(screen.getAllByTestId('canvas')).toHaveLength(1);
  });

  it('gives the canvas the whole area on a phone, with the rest behind triggers', () => {
    isMobile.current = true;
    const { container } = renderShell();

    // The canvas must be mounted exactly once — two <ReactFlow> instances is
    // the reason this branch is JS rather than `hidden md:block`.
    expect(screen.getAllByTestId('canvas')).toHaveLength(1);
    expect(container.querySelector('[data-slot="resizable-panel"]')).toBeNull();

    // Closed sheets leave their children unmounted, so the copies cost nothing.
    expect(screen.queryByText('subgraph list')).toBeNull();
    expect(screen.queryByText('detail panel')).toBeNull();

    expect(
      screen.getByRole('button', { name: /subgraphs/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /details/i })
    ).toBeInTheDocument();
  });

  it('opens the sidebar sheet on demand', async () => {
    isMobile.current = true;
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: /subgraphs/i }));
    expect(await screen.findByText('subgraph list')).toBeInTheDocument();
  });

  it('names the panel trigger after the route', () => {
    isMobile.current = true;
    renderShell({ panelTitle: 'Editor' });

    expect(screen.getByRole('button', { name: /editor/i })).toBeInTheDocument();
  });

  it('lets a component inside a sheet dismiss it', async () => {
    isMobile.current = true;
    const user = userEvent.setup();

    function FocusButton() {
      const { dismiss } = useViewerSurface();
      return (
        <button type="button" onClick={dismiss}>
          focus a subgraph
        </button>
      );
    }

    render(
      <ViewerShell
        sizes={SIZES}
        sidebar={<FocusButton />}
        canvas={<div data-testid="canvas">canvas</div>}
        panel={<div>detail panel</div>}
      />
    );

    await user.click(screen.getByRole('button', { name: /subgraphs/i }));
    await user.click(
      await screen.findByRole('button', { name: /focus a subgraph/i })
    );

    // Leaving the sheet up would hide the very thing the tap asked for.
    expect(
      screen.queryByRole('button', { name: /focus a subgraph/i })
    ).toBeNull();
  });

  it('is a no-op outside the shell', () => {
    function Probe() {
      const { dismiss } = useViewerSurface();
      return <button onClick={dismiss}>dismiss</button>;
    }

    expect(() => render(<Probe />)).not.toThrow();
  });
});
