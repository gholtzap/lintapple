import assert from 'node:assert/strict';
export function assertProcessError(error: unknown): asserts error is Error & { code: number | string; stdout: string; stderr: string } {
  assert.ok(error instanceof Error && 'code' in error && 'stdout' in error && 'stderr' in error);
  assert.ok(typeof error.code === 'number' || typeof error.code === 'string');
  assert.equal(typeof error.stdout, 'string');
  assert.equal(typeof error.stderr, 'string');
}
