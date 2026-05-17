// tests/unit/server/db/demo/sibling-cheer-repo.test.ts
// #2097 Phase B-5b: sibling-cheer fixture が読み出せること、未表示 cheer が
// 子供画面の SiblingCheerOverlay 等で表示されることを検証。

import { describe, expect, it } from 'vitest';
import * as siblingCheerRepo from '../../../../../src/lib/server/db/demo/sibling-cheer-repo';
import { DEMO_SIBLING_CHEERS } from '../../../../../src/lib/server/demo/demo-data';

describe('demo/sibling-cheer-repo (Phase B-5b)', () => {
	it('DEMO_SIBLING_CHEERS fixture は 5 件以上含む', () => {
		expect(DEMO_SIBLING_CHEERS.length).toBeGreaterThanOrEqual(5);
	});

	it('findUnshownCheers は 902 (toChild) で未表示 cheer を返す', async () => {
		const cheers = await siblingCheerRepo.findUnshownCheers(902, 'demo');
		expect(cheers.length).toBeGreaterThan(0);
		expect(cheers.every((c) => c.toChildId === 902)).toBe(true);
		expect(cheers.every((c) => c.shownAt === null)).toBe(true);
	});

	it('findUnshownCheers は 903 (toChild) で未表示 cheer を返す', async () => {
		const cheers = await siblingCheerRepo.findUnshownCheers(903, 'demo');
		expect(cheers.length).toBeGreaterThan(0);
		expect(cheers.every((c) => c.toChildId === 903 && c.shownAt === null)).toBe(true);
	});

	it('findUnshownCheers は未登録 child で空配列', async () => {
		const cheers = await siblingCheerRepo.findUnshownCheers(99999, 'demo');
		expect(cheers).toEqual([]);
	});

	it('findCheersByChild は 902 全件 (既読/未読不問) を返す', async () => {
		const cheers = await siblingCheerRepo.findCheersByChild(902, 'demo');
		expect(cheers.length).toBeGreaterThanOrEqual(2);
		expect(cheers.every((c) => c.toChildId === 902)).toBe(true);
	});

	it('countTodayCheersFrom は 0 (送信制限 stub)', async () => {
		expect(await siblingCheerRepo.countTodayCheersFrom(903, 'demo')).toBe(0);
	});

	it('insertCheer は input を SiblingCheer として返す (no-op、fixture は immutable)', async () => {
		const before = DEMO_SIBLING_CHEERS.length;
		const cheer = await siblingCheerRepo.insertCheer(
			{ fromChildId: 903, toChildId: 902, stampCode: 'ganbare' },
			'demo',
		);
		expect(cheer.fromChildId).toBe(903);
		expect(cheer.toChildId).toBe(902);
		expect(cheer.stampCode).toBe('ganbare');
		// ADR-0048 §決定 §2: fixture immutable
		expect(DEMO_SIBLING_CHEERS.length).toBe(before);
	});

	it('markShown / deleteByTenantId は no-op で例外を投げない', async () => {
		await expect(siblingCheerRepo.markShown([1, 2], 'demo')).resolves.toBeUndefined();
		await expect(siblingCheerRepo.deleteByTenantId('demo')).resolves.toBeUndefined();
	});
});
