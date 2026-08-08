import { describe, expect, it } from 'vitest';
import {
  formatInstancePathParam,
  parseInstancePathParam,
  parseViewerParams,
  writeViewerParams,
} from '@/lib/graph/flow-adapter';

const params = (query: string) => new URLSearchParams(query);

describe('parseInstancePathParam', () => {
  it('splits an instance path and drops empty segments', () => {
    expect(parseInstancePathParam('port_bank')).toEqual(['port_bank']);
    expect(parseInstancePathParam('port_bank/cells')).toEqual([
      'port_bank',
      'cells',
    ]);
    expect(parseInstancePathParam('/port_bank//cells/')).toEqual([
      'port_bank',
      'cells',
    ]);
  });

  it('treats missing and blank as the whole tree', () => {
    expect(parseInstancePathParam(null)).toEqual([]);
    expect(parseInstancePathParam('')).toEqual([]);
    expect(parseInstancePathParam('   ')).toEqual([]);
  });
});

describe('parseViewerParams', () => {
  it('reads focus on its own', () => {
    expect(parseViewerParams(params('focus=port_bank'))).toEqual({
      focus: ['port_bank'],
      selection: null,
    });
  });

  it('reads a node selection alongside focus', () => {
    expect(
      parseViewerParams(params('focus=port_bank&node=port_bank/abc'))
    ).toEqual({
      focus: ['port_bank'],
      selection: { type: 'node', instanceId: 'port_bank/abc' },
    });
  });

  it('reads an edge selection', () => {
    expect(parseViewerParams(params('edge=edge-a-b'))).toEqual({
      focus: [],
      selection: { type: 'edge', edgeId: 'edge-a-b' },
    });
  });

  it('prefers the node when a hand-edited URL carries both', () => {
    const result = parseViewerParams(params('node=abc&edge=edge-a-b'));
    expect(result.selection).toEqual({ type: 'node', instanceId: 'abc' });
  });

  it('ignores blank selection params', () => {
    expect(parseViewerParams(params('node=&edge=')).selection).toBeNull();
  });

  it('returns the default view for an empty query string', () => {
    expect(parseViewerParams(params(''))).toEqual({
      focus: [],
      selection: null,
    });
  });
});

describe('writeViewerParams', () => {
  it('round-trips through parseViewerParams', () => {
    const next = {
      focus: ['starboard_bank'],
      selection: { type: 'node' as const, instanceId: 'starboard_bank/xyz' },
    };

    expect(parseViewerParams(writeViewerParams(params(''), next))).toEqual(
      next
    );
  });

  it('drops focus and selection when they are empty', () => {
    const written = writeViewerParams(params('focus=port_bank&node=abc'), {
      focus: [],
      selection: null,
    });

    expect(written.has('focus')).toBe(false);
    expect(written.has('node')).toBe(false);
    expect(written.has('edge')).toBe(false);
  });

  it('replaces a node selection with an edge selection rather than keeping both', () => {
    const written = writeViewerParams(params('node=abc'), {
      focus: [],
      selection: { type: 'edge', edgeId: 'edge-a-b' },
    });

    expect(written.has('node')).toBe(false);
    expect(written.get('edge')).toBe('edge-a-b');
  });

  it('preserves unrelated query params', () => {
    const written = writeViewerParams(params('theme=dark'), {
      focus: ['port_bank'],
      selection: null,
    });

    expect(written.get('theme')).toBe('dark');
    expect(written.get('focus')).toBe('port_bank');
  });
});

describe('formatInstancePathParam', () => {
  it('joins a path and returns null for the root', () => {
    expect(formatInstancePathParam(['a', 'b'])).toBe('a/b');
    expect(formatInstancePathParam([])).toBeNull();
  });
});
