const encoder = new TextEncoder();
function base64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}
function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte === undefined || rightByte === undefined) return false;
    difference |= leftByte ^ rightByte;
  }
  return difference === 0;
}
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) return false;
  const [algorithm, iterationText, saltText, expectedText] = stored.split('$');
  if (
    algorithm !== 'pbkdf2-sha256' ||
    iterationText === undefined ||
    saltText === undefined ||
    expectedText === undefined
  )
    return false;
  const iterations = Number(iterationText);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(saltText), iterations },
      material,
      fromBase64(expectedText).length * 8,
    ),
  );
  return equal(derived, fromBase64(expectedText));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      material,
      256,
    ),
  );
  return `pbkdf2-sha256$${String(iterations)}$${base64(salt)}$${base64(derived)}`;
}
