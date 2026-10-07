export function finding(rule, selector, actual, expected, fix, details = {}) {
  return { rule, selector, message: `Expected ${expected}. Found ${actual}.`, actual, expected, fix, ...details };
}
