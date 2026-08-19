// Narrows `T | undefined | null` down to `T` inside a test without a non-null assertion (banned
// repo-wide by @typescript-eslint/no-non-null-assertion), failing with a readable message instead
// of a bare "cannot read property of undefined" further down the test.
export function present<T>(value: T | undefined | null, what = "value"): T {
  if (value == null) {
    throw new Error(`Expected ${what} to be present, got ${String(value)}`);
  }
  return value;
}
