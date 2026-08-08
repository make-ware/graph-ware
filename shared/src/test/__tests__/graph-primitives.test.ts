import { describe, it, expect } from 'vitest';
import {
  AttributeSchema,
  FilterGroupSchema,
  PortSchema,
  PortAttributeSchema,
  NodePositionSchema,
  toMachineName,
  GRAPH_UID_PATTERN,
  IMPORT_ALIAS_PATTERN,
  NAMESPACE_PATTERN,
} from '../../index';
import batterySystem from '../../../../example/data/BatterySystem.json';
import engineSystem from '../../../../example/data/EngineSystem.json';

describe('AttributeSchema', () => {
  it('accepts an attribute from the sample data', () => {
    expect(
      AttributeSchema.parse({
        name: 'voltage',
        value: '12',
        unit: 'volts',
        kind: 'power',
      })
    ).toEqual({ name: 'voltage', value: '12', unit: 'volts', kind: 'power' });
  });

  it('treats unit as optional but kind as required', () => {
    expect(
      AttributeSchema.parse({ name: 'count', value: '2', kind: 'power' }).unit
    ).toBeUndefined();
    expect(() =>
      AttributeSchema.parse({ name: 'count', value: '2' })
    ).toThrow();
  });

  it('rejects a numeric value — values are always strings', () => {
    expect(() =>
      AttributeSchema.parse({ name: 'voltage', value: 12, kind: 'power' })
    ).toThrow();
  });
});

describe('PortSchema', () => {
  it('defaults nothing — relationship stays absent when not given', () => {
    const port = PortSchema.parse({
      name: 'supply',
      direction: 'output',
      kind: 'power',
    });
    expect(port.relationship).toBeUndefined();
  });

  it('rejects an unknown direction', () => {
    expect(() =>
      PortSchema.parse({ name: 'x', direction: 'bidirectional', kind: 'power' })
    ).toThrow();
  });

  it('rejects an unknown relationship', () => {
    expect(() =>
      PortSchema.parse({
        name: 'x',
        direction: 'input',
        kind: 'power',
        relationship: 'several',
      })
    ).toThrow();
  });

  it('accepts one name in both directions on the same node', () => {
    const ports = batterySystem.elements.find(
      (element) => element.name === 'house_fuse'
    )!.ports;

    const parsed = ports.map((port) => PortSchema.parse(port));
    expect(parsed).toHaveLength(2);
    expect(parsed.map((port) => port.direction).sort()).toEqual([
      'input',
      'output',
    ]);
    expect(new Set(parsed.map((port) => port.name))).toEqual(
      new Set(['supply'])
    );
  });
});

describe('FilterGroupSchema', () => {
  const cerboSupply = engineSystem.elements[0].ports.find(
    (port) => port.name === 'supply'
  )!;

  it('parses the Cerbo GX voltage window from the sample data', () => {
    const attribute = PortAttributeSchema.parse(cerboSupply.attributes![0]);

    expect(attribute.filter).toEqual({
      logicalOperator: 'AND',
      conditions: [
        { attribute: 'voltage', value: '10', operator: 'gte' },
        { attribute: 'voltage', value: '15', operator: 'lte' },
      ],
    });
  });

  it('leaves filter undefined on a port attribute without one', () => {
    const attribute = PortAttributeSchema.parse(cerboSupply.attributes![1]);
    expect(attribute.filter).toBeUndefined();
  });

  it('rejects an unknown comparison operator', () => {
    expect(() =>
      FilterGroupSchema.parse({
        logicalOperator: 'AND',
        conditions: [
          { attribute: 'voltage', value: '10', operator: 'approximately' },
        ],
      })
    ).toThrow();
  });

  it('rejects an unknown logical operator', () => {
    expect(() =>
      FilterGroupSchema.parse({
        logicalOperator: 'XOR',
        conditions: [{ attribute: 'voltage', value: '10', operator: 'gte' }],
      })
    ).toThrow();
  });

  it('requires at least one condition', () => {
    expect(() =>
      FilterGroupSchema.parse({ logicalOperator: 'AND', conditions: [] })
    ).toThrow();
  });
});

describe('the sample dataset', () => {
  it('parses every port and attribute of every element', () => {
    for (const graph of [batterySystem, engineSystem]) {
      for (const element of graph.elements) {
        for (const attribute of element.attributes ?? []) {
          expect(() => AttributeSchema.parse(attribute)).not.toThrow();
        }
        for (const port of element.ports ?? []) {
          expect(() => PortSchema.parse(port)).not.toThrow();
        }
      }
    }
  });
});

describe('NodePositionSchema', () => {
  it('accepts a coordinate pair and rejects a partial one', () => {
    expect(NodePositionSchema.parse({ x: 10, y: -4 })).toEqual({
      x: 10,
      y: -4,
    });
    expect(() => NodePositionSchema.parse({ x: 10 })).toThrow();
  });
});

describe('naming patterns', () => {
  it('accepts the sample uids and rejects ones with separators', () => {
    expect(GRAPH_UID_PATTERN.test('BatterySystem')).toBe(true);
    expect(GRAPH_UID_PATTERN.test('battery-system_2')).toBe(true);
    expect(GRAPH_UID_PATTERN.test('battery system')).toBe(false);
    expect(GRAPH_UID_PATTERN.test('battery/system')).toBe(false);
  });

  it('restricts namespaces to lowercase alphanumerics', () => {
    expect(NAMESPACE_PATTERN.test('test')).toBe(true);
    expect(NAMESPACE_PATTERN.test('Test')).toBe(false);
    expect(NAMESPACE_PATTERN.test('my_ns')).toBe(false);
  });

  it('restricts import aliases to snake case', () => {
    expect(IMPORT_ALIAS_PATTERN.test('port_bank')).toBe(true);
    expect(IMPORT_ALIAS_PATTERN.test('Port Bank')).toBe(false);
    expect(IMPORT_ALIAS_PATTERN.test('')).toBe(false);
  });
});

describe('toMachineName', () => {
  it('normalizes a label into a machine name', () => {
    expect(toMachineName('Port Battery Bank')).toBe('port_battery_bank');
    expect(toMachineName('  Cerbo GX  ')).toBe('cerbo_gx');
    expect(toMachineName('data/canbus')).toBe('data_canbus');
    expect(toMachineName('---')).toBe('');
  });
});
