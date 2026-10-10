import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UsernameBloomFilter } from './username-bloom.js';

test('username Bloom filter reports inserted names without false negatives', () => {
  const filter = new UsernameBloomFilter();
  const usernames = ['atif.test', 'existing-user', 'another_user'];
  for (const username of usernames) filter.add(username);
  for (const username of usernames) assert.equal(filter.mightContain(username), true);
  assert.equal(filter.mightContain('never-registered-name'), false);
});
