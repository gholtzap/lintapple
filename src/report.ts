import type { RuleId, Finding, FindingDetails } from './types.js';
export function finding(rule: RuleId, selector: string, actual: string, expected: string, fix: string, details: FindingDetails = {}): Finding {
  return { rule, selector, message: `Expected ${expected}. Found ${actual}.`, actual, expected, fix, ...details };
}
