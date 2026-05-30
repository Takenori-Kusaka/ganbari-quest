// tests/unit/server/db/demo/child-repo.test.ts
// ADR-0048 §決定 §2: demo Repository は stateless Fake (read) + Stub (write) hybrid。
// 本 test では fixture から read される件 / write が no-op で fixture を mutate しないこと
// を検証する。AWS Lambda Best Practices 公式 anti-pattern (mutable module-level state)
// が物理的に発生不可能であることをユニットレベルで担保する。

import { describe, expect, it } from 'vitest';
import * as childRepo from '../../../../../src/lib/server/db/demo/child-repo';
import { DEMO_CHILDREN } from '../../../../../src/lib/server/demo/demo-data';

describe('demo/child-repo', () => {
	describe('read API (Fake — fixture 経由)', () => {
		it('findAllChildren は demo-data の Children fixture を返す', async () => {
			const all = await childRepo.findAllChildren('demo');
			expect(all.length).toBeGreaterThanOrEqual(5);
			const ids = all.map((c) => c.id);
			expect(ids).toContain(901);
			expect(ids).toContain(902);
			expect(ids).toContain(903);
			expect(ids).toContain(904);
			expect(ids).toContain(906);
		});

		it('findChildById で 902 (ひなちゃん) が見つかる', async () => {
			const child = await childRepo.findChildById(902, 'demo');
			expect(child).toBeDefined();
			expect(child?.nickname).toBe('ひなちゃん');
			expect(child?.age).toBe(5);
			expect(child?.theme).toBe('pink');
		});

		it('findChildById で存在しない ID は undefined', async () => {
			const child = await childRepo.findChildById(99999, 'demo');
			expect(child).toBeUndefined();
		});

		it('findArchivedChildren は archived=1 のみ返す (fixture では空)', async () => {
			const archived = await childRepo.findArchivedChildren('demo');
			expect(archived).toEqual([]);
		});

		it('findChildByUserId で userId=null の fixture は見つからない', async () => {
			const child = await childRepo.findChildByUserId('some-user', 'demo');
			expect(child).toBeUndefined();
		});
	});

	describe('write API (Stub — no-op、fixture mutation なし)', () => {
		it('insertChild は input から minimal Child を返すが fixture を変更しない', async () => {
			const before = DEMO_CHILDREN.length;
			const created = await childRepo.insertChild({ nickname: 'テスト太郎', age: 7 }, 'demo');
			expect(created.nickname).toBe('テスト太郎');
			expect(created.age).toBe(7);
			// ADR-0048 §決定 §2: fixture は immutable
			expect(DEMO_CHILDREN.length).toBe(before);
		});

		it('updateChild は no-op で fixture mutation なし', async () => {
			const originalNickname = DEMO_CHILDREN.find((c) => c.id === 902)?.nickname;
			await childRepo.updateChild(902, { nickname: 'mutated' }, 'demo');
			const after = DEMO_CHILDREN.find((c) => c.id === 902)?.nickname;
			expect(after).toBe(originalNickname);
		});

		it('deleteChild は no-op で fixture mutation なし', async () => {
			const before = DEMO_CHILDREN.length;
			await childRepo.deleteChild(902, 'demo');
			expect(DEMO_CHILDREN.length).toBe(before);
			expect(DEMO_CHILDREN.find((c) => c.id === 902)).toBeDefined();
		});

		it('archiveChildren / restoreArchivedChildren は no-op で例外を投げない', async () => {
			// Phase 7 PR-2a (#2688): ArchivedReason 型強制で 'test' → 'trial_expired' (ARCHIVED_REASONS SSOT)
			await expect(
				childRepo.archiveChildren([902], 'trial_expired', 'demo'),
			).resolves.toBeUndefined();
			await expect(
				childRepo.restoreArchivedChildren('trial_expired', 'demo'),
			).resolves.toBeUndefined();
		});
	});

	describe('module-level state 検証 (AWS Lambda Best Practices)', () => {
		it('連続 read 呼び出しで結果が等値である (idempotent / stateless)', async () => {
			const a = await childRepo.findAllChildren('demo');
			const b = await childRepo.findAllChildren('demo');
			expect(a.length).toBe(b.length);
			expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
		});

		it('write → read で fixture 値が変化しない (mutable singleton anti-pattern 回避)', async () => {
			const before = (await childRepo.findChildById(901, 'demo'))?.nickname;
			await childRepo.insertChild({ nickname: '新しい', age: 3 }, 'demo');
			await childRepo.updateChild(901, { nickname: 'mutated' }, 'demo');
			const after = (await childRepo.findChildById(901, 'demo'))?.nickname;
			expect(after).toBe(before);
		});
	});
});
