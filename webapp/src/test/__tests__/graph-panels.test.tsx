import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FALLBACK_PORT_KIND_COLOR,
  type GraphDiagnostic,
  buildGraphView,
} from '@project/shared';
import { DiagnosticsPanel } from '@/components/graph/diagnostics-panel';
import { GraphDetailPanel } from '@/components/graph/graph-detail-panel';
import { SAMPLE_PORT_KINDS, sampleTree } from './fixtures/graph-fixtures';

const COLORS: Record<string, string> = { power: '#f59e0b' };
const colorFor = (kind: string) => COLORS[kind] ?? FALLBACK_PORT_KIND_COLOR;

const view = () =>
  buildGraphView(sampleTree(), { portKinds: SAMPLE_PORT_KINDS });

describe('GraphDetailPanel', () => {
  it('prompts when nothing is selected', () => {
    render(
      <GraphDetailPanel view={view()} selection={null} colorFor={colorFor} />
    );

    expect(
      screen.getByText(/select a node or a connection/i)
    ).toBeInTheDocument();
  });

  it('shows a node’s label, machine name and breadcrumb', () => {
    const current = view();
    const node = current.nodes.find(
      (candidate) => candidate.name === 'house_fuse'
    )!;

    render(
      <GraphDetailPanel
        view={current}
        selection={{ type: 'node', instanceId: node.instanceId }}
        colorFor={colorFor}
      />
    );

    expect(screen.getByText(node.label)).toBeInTheDocument();
    expect(screen.getByText('house_fuse')).toBeInTheDocument();
    // The breadcrumb is what tells two instances of the same node apart.
    expect(screen.getByText(node.breadcrumb.join(' › '))).toBeInTheDocument();
    expect(screen.getByText(node.instanceId)).toBeInTheDocument();
  });

  it('lists inputs and outputs separately', () => {
    const current = view();
    const fuse = current.nodes.find((node) => node.name === 'house_fuse')!;

    render(
      <GraphDetailPanel
        view={current}
        selection={{ type: 'node', instanceId: fuse.instanceId }}
        colorFor={colorFor}
      />
    );

    expect(screen.getByText('Inputs')).toBeInTheDocument();
    expect(screen.getByText('Outputs')).toBeInTheDocument();
    // `supply` exists in both directions on this node.
    expect(screen.getAllByText('supply').length).toBeGreaterThanOrEqual(2);
  });

  it('shows an edge’s kind, provenance and both endpoints', () => {
    const current = view();
    const edge = current.edges[0];

    render(
      <GraphDetailPanel
        view={current}
        selection={{ type: 'edge', edgeId: edge.id }}
        colorFor={colorFor}
      />
    );

    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('derived')).toBeInTheDocument();
    expect(screen.getByText(edge.kind)).toBeInTheDocument();
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('To')).toBeInTheDocument();
    expect(screen.getByText(/no stored record/i)).toBeInTheDocument();
  });

  it('says so when the selection is not in the current view', () => {
    render(
      <GraphDetailPanel
        view={view()}
        selection={{ type: 'node', instanceId: 'gone/missing' }}
        colorFor={colorFor}
      />
    );

    expect(screen.getByText(/not in the current view/i)).toBeInTheDocument();
  });
});

describe('DiagnosticsPanel', () => {
  const diagnostics: GraphDiagnostic[] = [
    {
      level: 'error',
      code: 'required-input-unconnected',
      message: 'Required input "supply" on Cerbo GX has no connection.',
      instanceId: 'control/victron_cerbo',
      path: ['Test Element Data', 'Control System'],
    },
    {
      level: 'info',
      code: 'unknown-port-kind',
      message: 'Port kind "mystery" has no registry entry.',
      instanceId: 'control/victron_cerbo',
    },
    {
      level: 'warning',
      code: 'import-cycle',
      message: 'A graph reappeared on its own ancestor chain.',
    },
  ];

  it('reports a clean graph', () => {
    render(<DiagnosticsPanel diagnostics={[]} onSelect={vi.fn()} />);

    expect(screen.getByText(/no diagnostics/i)).toBeInTheDocument();
  });

  it('groups entries by level', () => {
    render(<DiagnosticsPanel diagnostics={diagnostics} onSelect={vi.fn()} />);

    for (const label of ['Errors', 'Warnings', 'Info']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('required-input-unconnected')).toBeInTheDocument();
  });

  it('selects the node behind an entry', async () => {
    const onSelect = vi.fn();
    render(<DiagnosticsPanel diagnostics={diagnostics} onSelect={onSelect} />);

    await userEvent.click(
      screen.getByText(/Required input "supply" on Cerbo GX/)
    );

    expect(onSelect).toHaveBeenCalledWith({
      type: 'node',
      instanceId: 'control/victron_cerbo',
    });
  });

  it('renders a tree-level entry as plain text, not a dead button', () => {
    render(<DiagnosticsPanel diagnostics={diagnostics} onSelect={vi.fn()} />);

    const cycle = screen.getByText(/reappeared on its own ancestor chain/);
    expect(cycle.closest('button')).toBeNull();
  });

  it('shows the breadcrumb when the diagnostic carries one', () => {
    render(<DiagnosticsPanel diagnostics={diagnostics} onSelect={vi.fn()} />);

    expect(
      screen.getByText('· Test Element Data › Control System')
    ).toBeInTheDocument();
  });
});
