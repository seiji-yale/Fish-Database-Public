import { describe, expect, it } from 'vitest';
import { findViolations, isTextFile } from './english';

// Non-Latin fixtures are written as code points so this file itself passes the check.
const hiragana = String.fromCodePoint(0x3042);
const katakana = String.fromCodePoint(0x30a2);
const han = String.fromCodePoint(0x9b5a);
const hangul = String.fromCodePoint(0xd55c);
const cyrillic = String.fromCodePoint(0x0416);

describe('findViolations', () => {
  it.each([
    ['Hiragana', hiragana],
    ['Katakana', katakana],
    ['Han', han],
    ['Hangul', hangul],
    ['Cyrillic', cyrillic],
  ])('flags %s', (_name, character) => {
    const result = findViolations('a.ts', `// comment ${character}`);
    expect(result).toEqual([{ file: 'a.ts', line: 1, character }]);
  });

  it('reports the correct line number', () => {
    const result = findViolations('a.ts', `ok\nok\n${han}`);
    expect(result[0]?.line).toBe(3);
  });

  it.each([
    ['middle dot', '·'],
    ['em dash', '—'],
    ['arrow', '→'],
    ['degree sign', '°'],
    ['accented Latin', 'café'],
  ])('passes %s', (_name, text) => {
    expect(findViolations('a.md', `text ${text} text`)).toEqual([]);
  });
});

describe('isTextFile', () => {
  it('treats images as binary by extension', () => {
    expect(isTextFile('logo.png', new Uint8Array([65]))).toBe(false);
  });
  it('treats content with a NUL byte as binary', () => {
    expect(isTextFile('data.bin', new Uint8Array([65, 0, 66]))).toBe(false);
  });
  it('treats plain source as text', () => {
    expect(isTextFile('a.ts', new Uint8Array([65, 66]))).toBe(true);
  });
});
