/**
 * English-only check (NFR-10, AGENTS.md section 3).
 * Uses the Script property, not Script_Extensions: the middle dot U+00B7 has Hani in its
 * Script_Extensions and must not be flagged.
 */
export const NON_LATIN_SCRIPTS =
  /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Hangul}\p{Script=Cyrillic}]/u;

export interface Violation {
  file: string;
  line: number;
  character: string;
}

export function findViolations(file: string, text: string): Violation[] {
  const violations: Violation[] = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    const match = NON_LATIN_SCRIPTS.exec(lineText);
    if (match) violations.push({ file, line: index + 1, character: match[0] });
  });
  return violations;
}

const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|pdf|xlsx|woff2?|ttf|zip|gz|sqlite3?|db)$/i;

export function isTextFile(file: string, content: Uint8Array): boolean {
  return !BINARY_EXTENSIONS.test(file) && !content.includes(0);
}
