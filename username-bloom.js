import { createHash } from 'node:crypto';

const bitCount = 1 << 20;
const hashCount = 7;

export class UsernameBloomFilter {
  #bits = new Uint8Array(bitCount / 8);

  #indexes(username) {
    const hash = createHash('sha256').update(username).digest();
    const first = hash.readUInt32LE(0);
    const step = (hash.readUInt32LE(4) | 1) >>> 0;
    return Array.from({ length: hashCount }, (_, index) => (first + index * step) % bitCount);
  }

  add(username) {
    for (const index of this.#indexes(username)) {
      this.#bits[index >>> 3] |= 1 << (index & 7);
    }
  }

  mightContain(username) {
    return this.#indexes(username).every(index => (this.#bits[index >>> 3] & (1 << (index & 7))) !== 0);
  }
}
