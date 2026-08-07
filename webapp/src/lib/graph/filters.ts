// Filter evaluation for auto-connect.
//
// A `FilterGroup` hangs off an *input* port's attribute and constrains which
// source nodes may reach that port. It is evaluated against the candidate
// **source node's** attributes — not the source port's, and not the input's own
// attribute values. Filters on output ports are ignored.
//
// Extracted from the engine because it is the fiddliest rule in the contract
// and deserves its own tests. Reference: docs/GRAPH_ENGINE.md § Auto-connect.

import {
  ORDERING_OPERATORS,
  type Attribute,
  type FilterCondition,
  type FilterGroup,
  type Port,
} from './primitives';

/**
 * Parse a stored attribute value as a number, or `null` if it is not one.
 *
 * Attribute values are always strings, so the engine decides per comparison
 * whether it is looking at numbers. The empty-string guard is load-bearing:
 * `Number('')` is `0`, which would quietly make a blank attribute compare as
 * zero.
 */
export function toFiniteNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareNumbers(
  left: number,
  right: number,
  operator: FilterCondition['operator']
): boolean {
  switch (operator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
}

/**
 * Does one condition hold for a candidate source node?
 *
 * Three rules from the contract, all of them "fail" rather than "guess":
 * - a missing attribute fails;
 * - both sides numeric → compare numerically;
 * - otherwise `gt`/`gte`/`lt`/`lte` fail outright rather than falling back to
 *   string ordering, which would make `"9" > "15"` true.
 */
export function evaluateCondition(
  condition: FilterCondition,
  attributes: readonly Attribute[]
): boolean {
  const attribute = attributes.find(
    (candidate) => candidate.name === condition.attribute
  );
  if (!attribute) return false;

  const left = toFiniteNumber(attribute.value);
  const right = toFiniteNumber(condition.value);

  if (left !== null && right !== null) {
    return compareNumbers(left, right, condition.operator);
  }

  if (ORDERING_OPERATORS.includes(condition.operator)) return false;

  return condition.operator === 'eq'
    ? attribute.value === condition.value
    : attribute.value !== condition.value;
}

/** `AND` — every condition passes; `OR` — at least one does. */
export function evaluateFilterGroup(
  group: FilterGroup,
  attributes: readonly Attribute[]
): boolean {
  // The schema requires at least one condition; an empty `OR` group reaching
  // here would otherwise block every connection rather than constrain nothing.
  if (!group.conditions.length) return true;

  const test = (condition: FilterCondition) =>
    evaluateCondition(condition, attributes);

  return group.logicalOperator === 'AND'
    ? group.conditions.every(test)
    : group.conditions.some(test);
}

/**
 * Every filter declared on an input port's attributes, against one source node.
 *
 * Filters live on port *attributes*, not on the port itself, and a port may
 * carry several. All of them have to pass.
 */
export function portFiltersPass(
  port: Port,
  sourceAttributes: readonly Attribute[]
): boolean {
  return (port.attributes ?? []).every(
    (attribute) =>
      !attribute.filter ||
      evaluateFilterGroup(attribute.filter, sourceAttributes)
  );
}
