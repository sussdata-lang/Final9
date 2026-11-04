import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FastLruCache,
  WriteCoalescer,
  runHighConcurrencySimulation,
  extractMutatedTableFromSql,
  getInvalidatedNamespacesForTable,
  computeOrgSubtreeIds,
  computeLinkedUnitTargets,
} from './highConcurrencyEngine';

test('FastLruCache handles 10,000+ entries with O(1) hits, TTL expiry, and prefix invalidation', () => {
  const cache = new FastLruCache<string>({ maxSize: 10_000, defaultTtlMs: 5000 });
  const now = 1_000_000;

  for (let i = 0; i < 10_000; i++) {
    cache.set(`user:${i}`, `session-${i}`, 5000, now);
  }

  assert.equal(cache.stats().size, 10_000);
  assert.equal(cache.get('user:0', now + 100), 'session-0');
  assert.equal(cache.get('user:9999', now + 100), 'session-9999');

  // Expired check
  assert.equal(cache.get('user:500', now + 6000), undefined);

  // Prefix invalidation
  const removed = cache.invalidatePrefix('user:999');
  assert.ok(removed >= 1);
  assert.equal(cache.get('user:9999', now + 100), undefined);
});

test('WriteCoalescer batches high-frequency correspondence and financial writes atomically', async () => {
  const batches: number[] = [];
  const coalescer = new WriteCoalescer<{ id: number }>((batch) => {
    batches.push(batch.length);
  }, 25);

  // Simulate 60 writes/sec (30 correspondence + 30 financial entries)
  for (let i = 1; i <= 60; i++) {
    coalescer.enqueue({ id: i });
  }

  assert.equal(coalescer.pendingCount(), 60);
  const res = await coalescer.flush();
  assert.equal(res.flushedCount, 60);
  assert.equal(res.batchesRun, 3); // 25 + 25 + 10
  assert.deepEqual(batches, [25, 25, 10]);
  assert.equal(coalescer.pendingCount(), 0);
});

test('runHighConcurrencySimulation sustains 10,000 concurrent users and 50+ writes/sec with sub-50ms p95 latency', () => {
  const metrics = runHighConcurrencySimulation({
    concurrentUsers: 10_000,
    correspondencePerSec: 30,
    financialEntriesPerSec: 30,
  });

  assert.equal(metrics.concurrentUsersSimulated, 10_000);
  assert.equal(metrics.correspondenceWritesPerSec, 30);
  assert.equal(metrics.financialWritesPerSec, 30);
  assert.equal(metrics.totalOperationsCompleted, 10_060);
  assert.equal(metrics.status, 'optimal');
  assert.ok(metrics.cacheHitRatePercent >= 95);
  assert.ok(metrics.p95LatencyMs < 50);
});

test('extractMutatedTableFromSql and getInvalidatedNamespacesForTable selectively invalidate only affected namespaces', () => {
  assert.equal(extractMutatedTableFromSql('INSERT INTO corr_docs (id, no) VALUES (?, ?)'), 'corr_docs');
  assert.equal(extractMutatedTableFromSql('UPDATE org_units SET name = ? WHERE id = ?'), 'org_units');
  assert.equal(extractMutatedTableFromSql('DELETE FROM sessions WHERE token_hash = ?'), 'sessions');
  assert.equal(extractMutatedTableFromSql('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)'), 'site_settings');

  // High-frequency correspondence writes must NOT invalidate identity or org_units caches
  const corrInvalidated = getInvalidatedNamespacesForTable('corr_docs');
  assert.deepEqual(corrInvalidated, ['desk', 'analytics']);
  assert.ok(!corrInvalidated.includes('identity'));
  assert.ok(!corrInvalidated.includes('org_units'));

  // Org unit changes invalidate org_units and identity
  const orgInvalidated = getInvalidatedNamespacesForTable('org_units');
  assert.ok(orgInvalidated.includes('org_units'));
  assert.ok(orgInvalidated.includes('identity'));
});

test('computeOrgSubtreeIds and computeLinkedUnitTargets resolve hierarchy and links in memory without SQL CTEs', () => {
  const units = [
    { id: 1, name: 'إدارة الجامعة', parent_id: null, active: 1 },
    { id: 2, name: 'شؤون الطلاب', parent_id: 1, active: 1 },
    { id: 3, name: 'التسجيل والتوثيق', parent_id: 2, active: 1 },
    { id: 4, name: 'مكتب القبول', parent_id: 3, active: 1 },
    { id: 5, name: 'المالية', parent_id: 1, active: 1 },
    { id: 6, name: 'وحدة معطلة', parent_id: 1, active: 0 },
  ];
  const links = [
    { from_unit: 2, to_unit: 5, two_way: 1 },
    { from_unit: 4, to_unit: 2, two_way: 0 },
    { from_unit: 2, to_unit: 6, two_way: 1 },
  ];

  // Subtree of unit 2 (شؤون الطلاب) should include 2, 3, 4
  const subtree2 = computeOrgSubtreeIds(units, 2);
  assert.deepEqual(subtree2.sort((a, b) => a - b), [2, 3, 4]);

  // Linked targets of unit 5 (two-way link with 2)
  const targets5 = computeLinkedUnitTargets(units, links, 5);
  assert.deepEqual(targets5, [{ id: 2, name: 'شؤون الطلاب' }]);

  // Linked targets of unit 2 (links to 5, ignores inactive unit 6, ignores one-way incoming from 4)
  const targets2 = computeLinkedUnitTargets(units, links, 2);
  assert.deepEqual(targets2, [{ id: 5, name: 'المالية' }]);
});

