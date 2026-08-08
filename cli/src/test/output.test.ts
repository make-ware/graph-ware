import { describe, expect, it } from 'vitest';
import { Printer, shouldUseColor, truncate } from '../output.ts';

interface Row {
  uid: string;
  label: string;
}

const columns = [
  { header: 'UID', get: (r: Row) => r.uid },
  { header: 'LABEL', get: (r: Row) => r.label },
];

function capture(json: boolean, width = 100) {
  const out: string[] = [];
  const err: string[] = [];
  const printer = new Printer({
    json,
    color: false,
    width,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { printer, out, err };
}

describe('human output', () => {
  it('aligns columns and pads the header', () => {
    const { printer, out } = capture(false);
    printer.list(
      [
        { uid: 'LightSwitch', label: 'Light Switch' },
        { uid: 'Car', label: 'Car Electrical' },
      ],
      columns
    );

    const [header, first, second] = out[0].split('\n');
    expect(header).toBe('UID          LABEL');
    expect(first).toBe('LightSwitch  Light Switch');
    expect(second).toBe('Car          Car Electrical');
  });

  it('says so instead of printing a bare header when there is nothing', () => {
    const { printer, out } = capture(false);
    printer.list([], columns, 'No graphs.');
    expect(out).toEqual(['No graphs.']);
  });

  it('shrinks the rightmost column to fit the terminal', () => {
    const { printer, out } = capture(false, 20);
    printer.list([{ uid: 'LightSwitch', label: 'A very long label' }], columns);
    for (const line of out[0].split('\n')) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
    expect(out[0]).toContain('…');
  });

  it('keeps notes on stdout and warnings on stderr', () => {
    const { printer, out, err } = capture(false);
    printer.note('done');
    printer.warn('careful');
    expect(out).toEqual(['done']);
    expect(err).toEqual(['warning: careful']);
  });
});

describe('--json output', () => {
  it('emits the raw records, not the column projection', () => {
    const { printer, out } = capture(true);
    const rows = [{ uid: 'LightSwitch', label: 'Light Switch', extra: 1 }];
    printer.list(rows, columns);

    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ ok: true, data: rows });
  });

  it('suppresses notes so stdout stays a single object', () => {
    const { printer, out } = capture(true);
    printer.note('done');
    printer.line('tree');
    printer.warn('careful');
    expect(out).toEqual([]);
  });

  it('puts failures on stderr under an ok:false envelope', () => {
    const { printer, out, err } = capture(true);
    printer.fail({
      type: 'validation',
      message: 'Bad input',
      fieldErrors: { uid: 'required' },
    });

    expect(out).toEqual([]);
    expect(JSON.parse(err[0])).toEqual({
      ok: false,
      error: {
        type: 'validation',
        message: 'Bad input',
        fieldErrors: { uid: 'required' },
      },
    });
  });

  it('reports usage failures in the same envelope', () => {
    const { printer, err } = capture(true);
    printer.usage('unknown command "grph"', 'graphware graph ls');
    expect(JSON.parse(err[0]).ok).toBe(false);
    expect(JSON.parse(err[0]).error.type).toBe('usage');
  });
});

describe('color', () => {
  it('is off when stdout is not a terminal', () => {
    expect(shouldUseColor(undefined, {}, false)).toBe(false);
  });

  it('is off when NO_COLOR is set, even on a terminal', () => {
    expect(shouldUseColor(undefined, { NO_COLOR: '1' }, true)).toBe(false);
  });

  it('is off when --no-color is passed', () => {
    expect(shouldUseColor(false, {}, true)).toBe(false);
  });

  it('is on for an interactive terminal', () => {
    expect(shouldUseColor(undefined, {}, true)).toBe(true);
  });
});

describe('truncate', () => {
  it('leaves short values alone', () => {
    expect(truncate('abc', 5)).toBe('abc');
  });

  it('marks what it cut', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
  });

  it('handles a zero budget', () => {
    expect(truncate('abc', 0)).toBe('');
  });
});
