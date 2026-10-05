import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { linesReturnUrl, rememberLinesUrl } from './linesReturn';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('Back to Lines URL', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the plain list', () => {
    expect(linesReturnUrl()).toBe('/lines');
  });

  it('returns the remembered list view with its query', () => {
    rememberLinesUrl('/lines?view=all&sort=status&dir=desc');
    expect(linesReturnUrl()).toBe('/lines?view=all&sort=status&dir=desc');
  });

  it('ignores anything that is not a Lines list URL', () => {
    for (const url of ['https://example.com/lines', '//evil/lines', '/lines/abc', '/settings']) {
      rememberLinesUrl(url);
      expect(linesReturnUrl()).toBe('/lines');
    }
  });

  it('falls back to the plain list when storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(linesReturnUrl()).toBe('/lines');
  });
});
