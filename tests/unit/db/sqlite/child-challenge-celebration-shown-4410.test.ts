// tests/unit/db/sqlite/child-challenge-celebration-shown-4410.test.ts
//
// #4410: 達成祝福 (SiblingCelebration) の「見せた」記録を実 SQLite で固定する。
//
// 症状: 祝福ダイアログの「閉じる」が UI 状態 (`$state`) だけを触っていたため、ホームに入る
//       たび全画面モーダルが再表示されていた (ADR-0012 anti-engagement 違反)。
// 本 test が固定する不変条件:
//   - 記録前は `celebrationShownAt === null` (= 出る)
//   - 記録後は非 null で永続する (= 再取得しても出ない)
//   - 二度目の記録は最初の時刻を上書きしない (冪等)
//   - ADD COLUMN 前からある legacy 行 (NULL) も破綻せず「未表示」として扱われる
//     (tests/CLAUDE.md schema 変更互換テスト)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestSqlite } from '../../helpers/test-db';

const dbHolder: { sqlite: TestSqlite | null; db: ReturnType<typeof createTestDb>['db'] | null } = {
	sqlite: null,
	db: null,
};

vi.mock('$lib/server/db/client', () => ({
	get db() {
		if (!dbHolder.db) throw new Error('test db not initialized');
		return dbHolder.db;
	},
}));

import { asChildId } from '$lib/domain/ids';
import { children } from '$lib/server/db/schema';
import {
	findActiveOrUnclaimedByChildId,
	findById,
	insert,
	markCelebrationShown,
} from '$lib/server/db/sqlite/child-challenge-repo';

const TENANT = 't-4410';
const TODAY = '2026-06-24';

function challengeInput(childId: number) {
	return {
		childId: asChildId(childId),
		title: '今週は「せいかつ」を2回',
		description: null,
		challengeType: 'cooperative',
		periodType: 'weekly',
		startDate: '2026-06-22',
		endDate: '2026-06-28',
		targetConfig: '{"metric":"count","categoryId":1,"baseTarget":2}',
		rewardConfig: '{"points":30}',
		sourceTemplateId: 'tmpl-4410',
		targetValue: 2,
	};
}

describe('#4410 child_challenges.celebration_shown_at (祝福を 1 回だけ見せる)', () => {
	let childId: number;

	beforeEach(() => {
		const { sqlite, db } = createTestDb();
		dbHolder.sqlite = sqlite;
		dbHolder.db = db;
		childId = db
			.insert(children)
			.values({ nickname: 'けんた', age: 8, theme: 'default', uiMode: 'elementary' })
			.returning()
			.get().id;
	});

	it('新規 instance は celebrationShownAt = null (= 祝福がまだ出ていない)', async () => {
		const created = await insert(challengeInput(childId), TENANT);
		expect(created.celebrationShownAt).toBeNull();
	});

	it('markCelebrationShown 後は非 null で永続する (再取得しても消えない = 2 回目は出ない)', async () => {
		const created = await insert(challengeInput(childId), TENANT);

		await markCelebrationShown(created.id, TENANT);

		const reloaded = await findById(created.id, TENANT);
		expect(reloaded?.celebrationShownAt).not.toBeNull();
		expect(typeof reloaded?.celebrationShownAt).toBe('string');
	});

	it('二度目の markCelebrationShown は最初に見せた時刻を上書きしない (冪等)', async () => {
		const created = await insert(challengeInput(childId), TENANT);
		await markCelebrationShown(created.id, TENANT);
		const first = (await findById(created.id, TENANT))?.celebrationShownAt;
		expect(first).not.toBeNull();

		await markCelebrationShown(created.id, TENANT);

		const second = (await findById(created.id, TENANT))?.celebrationShownAt;
		expect(second).toBe(first);
	});

	it('子供画面が読む findActiveOrUnclaimedByChildId 経路にも記録が載る', async () => {
		const created = await insert(challengeInput(childId), TENANT);

		const before = await findActiveOrUnclaimedByChildId(asChildId(childId), TODAY, TENANT);
		expect(before.find((c) => c.id === created.id)?.celebrationShownAt).toBeNull();

		await markCelebrationShown(created.id, TENANT);

		const after = await findActiveOrUnclaimedByChildId(asChildId(childId), TODAY, TENANT);
		expect(after.find((c) => c.id === created.id)?.celebrationShownAt).not.toBeNull();
	});

	it('legacy 行 (ADD COLUMN 前から存在し celebration_shown_at が NULL) も未表示として読める', async () => {
		// ALTER TABLE ADD COLUMN で列が付いた既存行を、明示 NULL の raw INSERT で模す。
		dbHolder.sqlite?.exec(`
			INSERT INTO child_challenges (
				child_id, title, description, challenge_type, period_type,
				start_date, end_date, target_config, reward_config,
				status, is_active, source_template_id,
				current_value, target_value, completed, completed_at,
				reward_claimed, reward_claimed_at, celebration_shown_at
			) VALUES (
				${childId}, 'legacy', NULL, 'cooperative', 'weekly',
				'2026-06-22', '2026-06-28', '{}', '{}',
				'completed', 1, 'legacy-tmpl',
				2, 2, 1, '2026-06-23T00:00:00Z',
				0, NULL, NULL
			);
		`);

		const rows = await findActiveOrUnclaimedByChildId(asChildId(childId), TODAY, TENANT);
		const legacy = rows.find((c) => c.title === 'legacy');
		expect(legacy).toBeDefined();
		expect(legacy?.celebrationShownAt).toBeNull();
	});
});
