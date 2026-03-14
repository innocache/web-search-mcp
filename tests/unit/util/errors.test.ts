/// <reference types="vitest/globals" />

import { ExtractionError, wrapError } from '../../../src/util/errors.js';

describe('ExtractionError', () => {
  it('stores code, message, and cause', () => {
    const cause = new Error('root cause');
    const err = new ExtractionError('NAVIGATION_FAILED', 'could not navigate', cause);
    const errWithCause = err as ExtractionError & { cause?: unknown };

    expect(err.code).toBe('NAVIGATION_FAILED');
    expect(err.message).toBe('could not navigate');
    expect(errWithCause.cause).toBe(cause);
  });

  it('uses the expected class name', () => {
    const err = new ExtractionError('INTERNAL_ERROR', 'boom');

    expect(err.name).toBe('ExtractionError');
  });

  it('formats client messages as [CODE] message', () => {
    const err = new ExtractionError('SERP_PARSE_FAILED', 'failed to parse');

    expect(err.toClientMessage()).toBe('[SERP_PARSE_FAILED] failed to parse');
  });
});

describe('wrapError', () => {
  it('returns the same instance for ExtractionError input', () => {
    const original = new ExtractionError('READABILITY_EMPTY', 'empty article');

    expect(wrapError(original)).toBe(original);
  });

  it('wraps standard Error as INTERNAL_ERROR with original message', () => {
    const wrapped = wrapError(new Error('network down'));

    expect(wrapped).toBeInstanceOf(ExtractionError);
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.message).toBe('network down');
  });

  it('wraps non-Error input with fallback message', () => {
    const wrapped = wrapError({ status: 500 });

    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.message).toBe('An unexpected error occurred');
  });

  it('preserves original cause when wrapping unknown values', () => {
    const cause = { kind: 'opaque' };
    const wrapped = wrapError(cause);
    const wrappedWithCause = wrapped as ExtractionError & { cause?: unknown };

    expect(wrappedWithCause.cause).toBe(cause);
  });
});
