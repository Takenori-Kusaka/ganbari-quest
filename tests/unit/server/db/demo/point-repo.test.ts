// tests/unit/server/db/demo/point-repo.test.ts
// ADR-0048 §決定 §2: demo Point Repo の Fake (read) + Stub (write) hybrid 検証。

import { describe, expect, it } from 'vitest';
import * as pointRepo from '../../../../../src/lib/server/db/demo/point-repo';
import { DEMO_POINT_BALANCES } from '../../../../../src/lib/server/demo/demo-data';

describe('demo/point-repo', () => {
	it('getBalance は fixture の POINT_BALANCES を返す', async () => {
		const balance = await pointRepo.getBalance(902, 'demo');
		expect(balance).toBe(DEMO_POINT_BALANCES[902]);
	});

	it('getBalance は未定義 child に対し 0 を返す', async () => {
		const balance = await pointRepo.getBalance(99999, 'demo');
		expect(balance).toBe(0);
	});

	it('findChildById は demo Children から返す', async () => {
		const child = await pointRepo.findChildById(902, 'demo');
		expect(child).toBeDefined();
		expect(child?.id).toBe(902);
	});

	it('findPointHistory は空配列を返す (fixture なし)', async () => {
		const history = await pointRepo.findPointHistory(902, { limit: 10, offset: 0 }, 'demo');
		expect(history).toEqual([]);
	});

	it('insertPointEntry は input から PointLedgerEntry を返す (no-op)', async () => {
		const before = DEMO_POINT_BALANCES[902];
		const entry = await pointRepo.insertPointEntry(
			{ childId: 902, amount: 50, type: 'test', description: 'noop' },
			'demo',
		);
		expect(entry.amount).toBe(50);
		// ADR-0048 §決定 §2: fixture は immutable
		expect(DEMO_POINT_BALANCES[902]).toBe(before);
	});

	it('deletePointLedgerBeforeDate は 0 を返す (stateless)', async () => {
		expect(await pointRepo.deletePointLedgerBeforeDate(902, '2020-01-01', 'demo')).toBe(0);
	});
});
