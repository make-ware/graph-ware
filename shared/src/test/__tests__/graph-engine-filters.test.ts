import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  evaluateFilterGroup,
  portFiltersPass,
  toFiniteNumber,
  type Attribute,
  type ComparisonOperator,
  type FilterGroup,
  type Port,
} from '../../index';
import { SAMPLES } from '../fixtures/graph-fixtures';

function attributes(...pairs: [string, string][]): Attribute[] {
  return pairs.map(([name, value]) => ({ name, value, kind: 'power' }));
}

function condition(
  attribute: string,
  operator: ComparisonOperator,
  value: string
) {
  return { attribute, operator, value };
}

/** The Cerbo GX's `supply` input, straight out of the sample data. */
const CERBO_SUPPLY = SAMPLES.EngineSystem.elements[0]
  .ports as unknown as Port[];
const CERBO_VOLTAGE_FILTER = CERBO_SUPPLY[0].attributes![0].filter!;

describe('toFiniteNumber', () => {
  it('parses a plain numeric string', () => {
    expect(toFiniteNumber('12')).toBe(12);
    expect(toFiniteNumber(' 12.5 ')).toBe(12.5);
    expect(toFiniteNumber('-3')).toBe(-3);
  });

  it('refuses anything that is not wholly a finite number', () => {
    // `parseFloat('12volts')` would answer 12 and quietly numerify a unit.
    expect(toFiniteNumber('12volts')).toBeNull();
    expect(toFiniteNumber('twelve')).toBeNull();
    expect(toFiniteNumber('Infinity')).toBeNull();
    expect(toFiniteNumber('NaN')).toBeNull();
  });

  it('refuses the empty string, which Number() reads as zero', () => {
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('   ')).toBeNull();
  });
});

describe('evaluateCondition', () => {
  const source = attributes(['voltage', '12'], ['model', 'cerbo']);

  it('compares numerically when both sides are numbers', () => {
    expect(evaluateCondition(condition('voltage', 'gte', '10'), source)).toBe(
      true
    );
    expect(evaluateCondition(condition('voltage', 'lte', '15'), source)).toBe(
      true
    );
    expect(evaluateCondition(condition('voltage', 'gt', '12'), source)).toBe(
      false
    );
    expect(evaluateCondition(condition('voltage', 'eq', '12.0'), source)).toBe(
      true
    );
  });

  it('fails an ordering operator rather than comparing strings', () => {
    const nonNumeric = attributes(['voltage', 'twelve']);

    // String ordering would make "twelve" >= "10" true, which is nonsense.
    for (const operator of ['gt', 'gte', 'lt', 'lte'] as const) {
      expect(
        evaluateCondition(condition('voltage', operator, '10'), nonNumeric)
      ).toBe(false);
    }
  });

  it('fails an ordering operator when the *filter* value is not numeric', () => {
    expect(evaluateCondition(condition('voltage', 'gte', 'ten'), source)).toBe(
      false
    );
  });

  it('still compares non-numeric values with eq and neq', () => {
    expect(evaluateCondition(condition('model', 'eq', 'cerbo'), source)).toBe(
      true
    );
    expect(evaluateCondition(condition('model', 'neq', 'cerbo'), source)).toBe(
      false
    );
    expect(evaluateCondition(condition('model', 'neq', 'venus'), source)).toBe(
      true
    );
  });

  it('fails when the attribute is missing, for every operator', () => {
    // Including `neq` — absent is not "different", it is unknown.
    for (const operator of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const) {
      expect(
        evaluateCondition(condition('amperage', operator, '1'), source)
      ).toBe(false);
    }
  });
});

describe('evaluateFilterGroup', () => {
  const group = (
    logicalOperator: 'AND' | 'OR',
    ...conditions: FilterGroup['conditions']
  ): FilterGroup => ({ logicalOperator, conditions });

  it('requires every condition under AND', () => {
    const filter = group(
      'AND',
      condition('voltage', 'gte', '10'),
      condition('voltage', 'lte', '15')
    );

    expect(evaluateFilterGroup(filter, attributes(['voltage', '12']))).toBe(
      true
    );
    expect(evaluateFilterGroup(filter, attributes(['voltage', '24']))).toBe(
      false
    );
  });

  it('requires one condition under OR', () => {
    const filter = group(
      'OR',
      condition('voltage', 'eq', '12'),
      condition('voltage', 'eq', '24')
    );

    expect(evaluateFilterGroup(filter, attributes(['voltage', '24']))).toBe(
      true
    );
    expect(evaluateFilterGroup(filter, attributes(['voltage', '48']))).toBe(
      false
    );
  });
});

describe('the Cerbo GX supply filter', () => {
  it('admits 12 volts and rejects 24', () => {
    expect(
      evaluateFilterGroup(CERBO_VOLTAGE_FILTER, attributes(['voltage', '12']))
    ).toBe(true);
    expect(
      evaluateFilterGroup(CERBO_VOLTAGE_FILTER, attributes(['voltage', '24']))
    ).toBe(false);
  });

  it('rejects a source with no voltage attribute at all', () => {
    expect(evaluateFilterGroup(CERBO_VOLTAGE_FILTER, [])).toBe(false);
  });
});

describe('portFiltersPass', () => {
  it('evaluates the filter against the source node, not the port’s own value', () => {
    // The port attribute is itself named `voltage` with value "12". That value
    // is decoration; the conditions resolve against the candidate source.
    const supply = CERBO_SUPPLY[0];

    expect(portFiltersPass(supply, attributes(['voltage', '12']))).toBe(true);
    expect(portFiltersPass(supply, attributes(['voltage', '24']))).toBe(false);
  });

  it('passes a port with no filters at all', () => {
    const port: Port = { name: 'hdmi', direction: 'input', kind: 'video/hdmi' };
    expect(portFiltersPass(port, [])).toBe(true);
  });

  it('requires every filtered attribute to pass', () => {
    const port: Port = {
      name: 'supply',
      direction: 'input',
      kind: 'power',
      attributes: [
        {
          name: 'voltage',
          value: '12',
          kind: 'power',
          filter: {
            logicalOperator: 'AND',
            conditions: [condition('voltage', 'eq', '12')],
          },
        },
        {
          name: 'current',
          value: '3',
          kind: 'power',
          filter: {
            logicalOperator: 'AND',
            conditions: [condition('current', 'gte', '100')],
          },
        },
      ],
    };

    expect(
      portFiltersPass(port, attributes(['voltage', '12'], ['current', '150']))
    ).toBe(true);
    expect(
      portFiltersPass(port, attributes(['voltage', '12'], ['current', '5']))
    ).toBe(false);
  });
});
