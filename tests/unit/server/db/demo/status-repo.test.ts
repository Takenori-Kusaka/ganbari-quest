// tests/unit/server/db/demo/status-repo.test.ts
// ADR-0048 §決定 §2: demo Status Repo の Fake (read) + Stub (write) hybrid 検証。

import { describe, expect, it } from 'vitest';
import * as statusRepo from '../../../../../src/lib/server/db/demo/status-repo';
import { DEMO_STATUSES } from '../../../../../src/lib/server/demo/demo-data';

describe('demo/status-repo', () => {
	it('findStatuses は child の 5 軸 Status を返す (fixture: 902)', async () => {
		const statuses = await statusRepo.findStatuses(902, 'demo');
		expect(statuses.length).toBe(5);
		expect(statuses.every((s) => s.childId === 902)).toBe(true);
	});

	it('findStatus は categoryId 指定で 1 件返す', async () => {
		const status = await statusRepo.findStatus(902, 1, 'demo');
		expect(status).toBeDefined();
		expect(status?.childId).toBe(902);
		expect(status?.categoryId).toBe(1);
	});

	it('upsertStatus は input から Status を返すが fixture を mutate しない', async () => {
		const before = DEMO_STATUSES.length;
		const upserted = await statusRepo.upsertStatus(902, 1, 999, 99, 1000, 'demo');
		expect(upserted.totalXp).toBe(999);
		expect(upserted.level).toBe(99);
		// ADR-0048 §決定 §2: fixture は immutable
		expect(DEMO_STATUSES.length).toBe(before);
		// 元の値が変わっていないことを確認
		const original = await statusRepo.findStatus(902, 1, 'demo');
		expect(original?.level).not.toBe(99);
	});

	it('findBenchmark / findAllBenchmarks は空を返す', async () => {
		expect(await statusRepo.findBenchmark(8, 1, 'demo')).toBeUndefined();
		expect(await statusRepo.findAllBenchmarks('demo')).toEqual([]);
	});

	it('insertStatusHistory は input から StatusHistoryEntry を返す (no-op)', async () => {
		const entry = await statusRepo.insertStatusHistory(
			{ childId: 902, categoryId: 1, value: 100, changeAmount: 5, changeType: 'gain' },
			'demo',
		);
		expect(entry.childId).toBe(902);
		expect(entry.changeAmount).toBe(5);
	});
});
