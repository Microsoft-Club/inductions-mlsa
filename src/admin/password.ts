// Letters and digits that can't be confused when read aloud or copied by hand (no l/1, o/0, i).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A 12-character password for a new or reset account, from the browser's secure random source. */
export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
