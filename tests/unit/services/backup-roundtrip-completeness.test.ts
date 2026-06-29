// tests/unit/services/backup-roundtrip-completeness.test.ts
// #3328: backup の export → clear → import (replace) で **全 source 実体**が件数一致で復元されるかを
// 実 SQLite で検証する round-trip 完全性テスト。
//
// 活動だけでなく activityLogs / pointLedger / statuses / statusHistory / loginBonuses / evaluations /
// specialRewards まで全種別を seed し、replace round-trip 後に各種別が復元されることを assert する。
// 未実装の取込 (現状 evaluations は import 関数が無い、#3327) を **赤で機械再現** し、failing-test-first で
// 潰す。新種別を export に足したら本テストへ assert を追加する規律で「silent な取りこぼし」を防ぐ。

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';
import {
	closeDb,
	createTestDb,
	resetDb,
	seedChildActivities,
	type TestDb,
	type TestSqlite,
} from '../helpers/test-db';

let sqlite: TestSqlite;
let testDb: TestDb;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
	findActivityLogs,
	insertActivityLog,
	insertPointLedger,
} from '../../../src/lib/server/db/activity-repo';
import {
	findEvaluationsByChild,
	insertEvaluation,
} from '../../../src/lib/server/db/evaluation-repo';
import { getRepos } from '../../../src/lib/server/db/factory';
import { findRecentBonuses, insertLoginBonus } from '../../../src/lib/server/db/login-bonus-repo';
import { findPointHistory } from '../../../src/lib/server/db/point-repo';
import {
	findRedemptionRequestsByTenant,
	insertRedemptionRequest,
	updateRedemptionRequestStatus,
} from '../../../src/lib/server/db/reward-redemption-repo';
import { getSetting, setSetting } from '../../../src/lib/server/db/settings-repo';
import {
	findSpecialRewards,
	insertSpecialReward,
} from '../../../src/lib/server/db/special-reward-repo';
import {
	findRecentStatusHistory,
	findStatuses,
	insertStatusHistory,
	upsertStatus,
} from '../../../src/lib/server/db/status-repo';
import { getChildActivities } from '../../../src/lib/server/services/activity-service';
import { clearAllFamilyData } from '../../../src/lib/server/services/data-service';
import { exportFamilyData } from '../../../src/lib/server/services/export-service';
import { importFamilyData } from '../../../src/lib/server/services/import-service';

const T = 't-complete';

beforeAll(() => {
	const t = createTestDb();
	sqlite = t.sqlite;
	testDb = t.db;
});
afterAll(() => {
	closeDb(sqlite);
});
beforeEach(() => {
	resetDb(sqlite);
});

describe('#3328 backup round-trip 完全性 — 全 source 実体が export→clear→import で復元される', () => {
	it('活動/ログ/台帳/ステータス/履歴/ログボ/評価/ごほうび が件数一致で復元される', async () => {
		// --- seed: 1 child + 全 source 実体を 1 件ずつ ---
		testDb.insert(schema.children).values({ nickname: 'ゆうき', age: 8, theme: 'blue' }).run(); // id=1
		seedChildActivities(testDb, 1, [{ name: 'うんどうA', categoryId: 1, icon: '🏃' }]);
		const seededActs = await getChildActivities(1, T);
		const actId = seededActs[0]?.id as number;

		await insertActivityLog(
			{
				childId: 1,
				activityId: actId,
				points: 5,
				streakDays: 1,
				streakBonus: 0,
				recordedDate: '2026-03-01',
				recordedAt: '2026-03-01T08:00:00Z',
			},
			T,
		);
		await insertPointLedger({ childId: 1, amount: 5, type: 'activity', description: 'test' }, T);
		await upsertStatus(1, 1, 50, 3, 50, T);
		await insertStatusHistory(
			{ childId: 1, categoryId: 1, value: 50, changeAmount: 5, changeType: 'activity' },
			T,
		);
		await insertLoginBonus(
			{
				childId: 1,
				loginDate: '2026-03-01',
				rank: 'normal',
				basePoints: 5,
				multiplier: 1,
				totalPoints: 5,
				consecutiveDays: 1,
			},
			T,
		);
		await insertEvaluation(
			{
				childId: 1,
				weekStart: '2026-03-01',
				weekEnd: '2026-03-07',
				scoresJson: '{}',
				bonusPoints: 10,
			},
			T,
		);
		const reward = await insertSpecialReward(
			{
				childId: 1,
				title: 'ごほうびX',
				description: undefined,
				points: 100,
				icon: undefined,
				category: 'money',
				sourcePresetId: null,
			},
			T,
		);

		// #3329: ごほうび交換履歴を 1 件 seed し、承認済 (approved) まで進める。
		// round-trip 後に status=approved と snapshot がそのまま復元されることを検証する。
		const redemption = await insertRedemptionRequest(
			{ childId: 1, rewardId: reward.id, requestedAt: 1_700_000_000_000 },
			T,
		);
		await updateRedemptionRequestStatus(
			1,
			redemption.id,
			{ status: 'approved', resolvedAt: 1_700_000_100_000, resolvedByParentId: 'parent-1' },
			T,
		);

		// #3329: 設定 KVS。allowlist キー (point_unit_mode) + 秘匿キー (pin_hash) を seed し、
		// 秘匿キーが export に載らない (default-deny) こと + allowlist キーが round-trip することを検証。
		await setSetting('point_unit_mode', 'custom', T);
		await setSetting('pin_hash', '$2b$10$fake.hash.not.restored', T);

		// #3329: チャレンジを 1 件 seed し進捗を進める。round-trip 後に currentValue/status が保全されることを検証。
		const challenge = await getRepos().childChallenge.insert(
			{
				childId: 1,
				title: 'うんどうチャレンジ',
				periodType: 'weekly',
				startDate: '2026-03-01',
				endDate: '2026-03-07',
				targetConfig: '{"metric":"count","baseTarget":3}',
				rewardConfig: '{"points":50}',
				targetValue: 3,
			},
			T,
		);
		await getRepos().childChallenge.updateProgress(challenge.id, 2, T);

		// #3329: スタンプカード (交換済) + 押印 1 件を seed。round-trip 後に status/redeemed と
		// 押印 (omikujiRank/earnedAt) が保全されることを検証する。
		const stampCard = await getRepos().stampCard.insertCardForRestore(
			{
				childId: 1,
				weekStart: '2026-02-23',
				weekEnd: '2026-03-01',
				status: 'redeemed',
				redeemedPoints: 20,
				redeemedAt: '2026-03-01T10:00:00Z',
				createdAt: '2026-02-23T00:00:00Z',
				updatedAt: '2026-03-01T10:00:00Z',
			},
			T,
		);
		await getRepos().stampCard.insertEntryForRestore(
			{
				cardId: stampCard.id,
				stampMasterId: null,
				omikujiRank: 'test-rank',
				slot: 0,
				loginDate: '2026-02-24',
				earnedAt: '2026-02-24T08:00:00Z',
			},
			T,
		);

		// #3329: 証明書を 1 件 seed (issuedAt 明示)。round-trip 後に issuedAt が保全されること、
		// および certificate.child_id (no-cascade) が clear を阻害せず「子復元=1」になることを検証する。
		await getRepos().certificate.insertForRestore(
			{
				childId: 1,
				certificateType: 'graduation',
				title: 'そつぎょうしょうめいしょ',
				description: null,
				issuedAt: '2026-02-01T00:00:00Z',
				metadata: null,
			},
			T,
		);

		// #3329: 親→子メッセージを 1 件 seed (既読 shownAt 明示)。round-trip 後に sentAt/shownAt が保全されること。
		await getRepos().message.insertForRestore(
			{
				childId: 1,
				messageType: 'text',
				stampCode: null,
				body: 'よくがんばったね',
				icon: '💌',
				sentAt: '2026-02-10T09:00:00Z',
				shownAt: '2026-02-10T18:00:00Z',
				bonusPoints: null,
				rewardCategory: null,
			},
			T,
		);

		// #3329: 活動設定 (ピン留め) を seed (seedChildActivities の 'うんどうA' をピン)。round-trip 後に
		// isPinned/pinOrder が保全され、activityName で正しい childActivity に再結合されることを検証する。
		await getRepos().activityPref.insertForRestore(
			{
				childId: 1,
				activityId: actId,
				isPinned: 1,
				pinOrder: 1,
				createdAt: '2026-02-05T00:00:00Z',
				updatedAt: '2026-02-05T00:00:00Z',
			},
			T,
		);

		// #3329: おやすみ日を 1 件 seed (createdAt 明示)。round-trip 後に reason/createdAt が保全されること。
		await getRepos().evaluation.insertRestDayForRestore(
			{ childId: 1, date: '2026-03-03', reason: 'sick', createdAt: '2026-03-03T00:00:00Z' },
			T,
		);

		// #3329: 子のカスタム音声 DB 行を 1 件 seed (filePath/publicUrl に childId 含む)。round-trip 後に
		// createdAt/scene/label が保全され、filePath/publicUrl が新 childId へ remap されることを検証する。
		await getRepos().voice.insertForRestore(
			{
				childId: 1,
				scene: 'complete',
				label: 'できたよ',
				filePath: `tenants/${T}/voices/1/sample.mp3`,
				publicUrl: `/tenants/${T}/voices/1/sample.mp3`,
				durationMs: 1200,
				isActive: 1,
				tenantId: T,
				createdAt: '2026-02-20T00:00:00Z',
			},
			T,
		);

		// --- export ---
		const data = await exportFamilyData({ tenantId: T });
		// export が全種別を捕捉していること (sanity)
		expect(data.data.childActivities.length, 'export:活動').toBe(1);
		expect(data.data.activityLogs.length, 'export:活動ログ').toBe(1);
		expect(data.data.pointLedger.length, 'export:台帳').toBe(1);
		expect(data.data.evaluations.length, 'export:評価').toBe(1);
		expect(data.data.specialRewards.length, 'export:ごほうび').toBe(1);
		expect(data.data.rewardRedemptions.length, 'export:交換履歴').toBe(1);
		expect(data.data.rewardRedemptions[0]?.status, 'export:交換履歴 status').toBe('approved');
		// #3329: 設定 export — allowlist キーは含み、秘匿キーは構造的に除外 (CWE-522/916)。
		const settingKeys = data.data.settings.map((s) => s.key);
		expect(settingKeys, 'export:設定 allowlist 含む').toContain('point_unit_mode');
		expect(settingKeys, 'export:設定 pin_hash 除外').not.toContain('pin_hash');
		expect(data.data.childChallenges.length, 'export:チャレンジ').toBe(1);
		expect(data.data.childChallenges[0]?.currentValue, 'export:チャレンジ進捗').toBe(2);
		expect(data.data.stampCards.length, 'export:スタンプカード').toBe(1);
		expect(data.data.stampCards[0]?.status, 'export:カード status').toBe('redeemed');
		expect(data.data.stampCards[0]?.entries.length, 'export:押印').toBe(1);
		expect(data.data.certificates.length, 'export:証明書').toBe(1);
		expect(data.data.certificates[0]?.issuedAt, 'export:証明書 issuedAt').toBe(
			'2026-02-01T00:00:00Z',
		);
		expect(data.data.activityPrefs.length, 'export:活動設定').toBe(1);
		expect(data.data.activityPrefs[0]?.activityName, 'export:活動設定 activityName').toBe(
			'うんどうA',
		);
		expect(data.data.restDays.length, 'export:おやすみ日').toBe(1);
		expect(data.data.restDays[0]?.reason, 'export:おやすみ日 reason').toBe('sick');
		expect(data.data.childVoices.length, 'export:音声').toBe(1);
		expect(data.data.childVoices[0]?.voiceRelPath, 'export:音声 voiceRelPath').toBe(
			'voices/1/sample.mp3',
		);
		expect(data.data.parentMessages.length, 'export:メッセージ').toBe(1);
		expect(data.data.parentMessages[0]?.shownAt, 'export:メッセージ shownAt').toBe(
			'2026-02-10T18:00:00Z',
		);

		// --- replace = clear → import ---
		await clearAllFamilyData(T);
		await importFamilyData(data, T);

		// --- 復元後の child ---
		const children = testDb.select().from(schema.children).all();
		expect(children.length, '子復元').toBe(1);
		const cid = children[0]?.id as number;

		// --- 全種別の round-trip 件数一致 ---
		expect((await getChildActivities(cid, T)).length, '活動').toBe(1);
		expect((await findActivityLogs(cid, T)).length, '活動ログ').toBe(1);
		expect((await findPointHistory(cid, { limit: 999, offset: 0 }, T)).length, 'ポイント台帳').toBe(
			1,
		);
		expect((await findStatuses(cid, T)).length, 'ステータス').toBeGreaterThanOrEqual(1);
		expect((await findRecentStatusHistory(cid, 1, T, 999)).length, 'ステータス履歴').toBe(1);
		expect((await findRecentBonuses(cid, T, 999)).length, 'ログインボーナス').toBe(1);
		expect((await findEvaluationsByChild(cid, 999, T)).length, '評価').toBe(1);
		expect((await findSpecialRewards(cid, T)).length, 'ごほうび').toBe(1);

		// #3329: 交換履歴が status / snapshot を保って復元される。
		const restoredRedemptions = await findRedemptionRequestsByTenant(T, {
			childId: cid,
			limit: 999,
		});
		expect(restoredRedemptions.length, '交換履歴').toBe(1);
		expect(restoredRedemptions[0]?.status, '交換履歴 status 保全').toBe('approved');
		expect(restoredRedemptions[0]?.rewardTitle, '交換履歴 snapshot 保全').toBe('ごほうびX');

		// #3329: 設定の round-trip — allowlist キーは復元、秘匿キーは clear 後も復元されない。
		expect(await getSetting('point_unit_mode', T), '設定 round-trip').toBe('custom');
		expect(await getSetting('pin_hash', T), '秘匿キー非復元').toBeUndefined();

		// #3329: チャレンジが進捗 (currentValue) を保って復元される。
		const restoredChallenges = await getRepos().childChallenge.findByChildId(cid, T);
		expect(restoredChallenges.length, 'チャレンジ').toBe(1);
		expect(restoredChallenges[0]?.currentValue, 'チャレンジ進捗保全').toBe(2);
		expect(restoredChallenges[0]?.title, 'チャレンジ title 保全').toBe('うんどうチャレンジ');

		// #3329: スタンプカードが status/redeemed を保ち、押印 (omikujiRank) が復元される。
		const restoredCards = await getRepos().stampCard.findCardsByChild(cid, T);
		expect(restoredCards.length, 'スタンプカード').toBe(1);
		expect(restoredCards[0]?.status, 'カード status 保全').toBe('redeemed');
		expect(restoredCards[0]?.redeemedPoints, 'カード redeemedPoints 保全').toBe(20);
		const restoredEntries = await getRepos().stampCard.findEntriesByCardId(
			restoredCards[0]?.id as number,
			T,
		);
		expect(restoredEntries.length, '押印').toBe(1);
		expect(restoredEntries[0]?.omikujiRank, '押印 omikujiRank 保全').toBe('test-rank');
		// #3329: 証明書が issuedAt を保って復元される (clear の FK 阻害も「子復元=1」で担保済)。
		const restoredCerts = await getRepos().certificate.findCertificates(cid, T);
		expect(restoredCerts.length, '証明書').toBe(1);
		expect(restoredCerts[0]?.issuedAt, '証明書 issuedAt 保全').toBe('2026-02-01T00:00:00Z');
		expect(restoredCerts[0]?.certificateType, '証明書 type 保全').toBe('graduation');

		// #3329: 親→子メッセージが sentAt/shownAt を保って復元される。
		const restoredMsgs = await getRepos().message.findMessages(cid, 999, T);
		expect(restoredMsgs.length, 'メッセージ').toBe(1);
		expect(restoredMsgs[0]?.sentAt, 'メッセージ sentAt 保全').toBe('2026-02-10T09:00:00Z');
		expect(restoredMsgs[0]?.shownAt, 'メッセージ shownAt 保全').toBe('2026-02-10T18:00:00Z');

		// #3329: 活動設定が isPinned/pinOrder 保全 + 正しい childActivity に再結合されて復元される。
		const restoredPrefs = await getRepos().activityPref.findAllByChild(cid, T);
		expect(restoredPrefs.length, '活動設定').toBe(1);
		expect(restoredPrefs[0]?.isPinned, '活動設定 isPinned 保全').toBe(1);
		expect(restoredPrefs[0]?.pinOrder, '活動設定 pinOrder 保全').toBe(1);
		const restoredActs2 = await getChildActivities(cid, T);
		expect(restoredPrefs[0]?.activityId, '活動設定 activityId 再結合').toBe(restoredActs2[0]?.id);

		// #3329: おやすみ日が reason/createdAt 保全で復元される。
		const restoredRestDays = await getRepos().evaluation.findRestDaysByChild(cid, T);
		expect(restoredRestDays.length, 'おやすみ日').toBe(1);
		expect(restoredRestDays[0]?.reason, 'おやすみ日 reason 保全').toBe('sick');
		expect(restoredRestDays[0]?.createdAt, 'おやすみ日 createdAt 保全').toBe(
			'2026-03-03T00:00:00Z',
		);

		// #3329: カスタム音声 DB 行が createdAt/scene 保全 + filePath/publicUrl を新 childId へ remap して復元される。
		const restoredVoices = await getRepos().voice.findAllByChild(cid, T);
		expect(restoredVoices.length, '音声').toBe(1);
		expect(restoredVoices[0]?.scene, '音声 scene 保全').toBe('complete');
		expect(restoredVoices[0]?.label, '音声 label 保全').toBe('できたよ');
		expect(restoredVoices[0]?.createdAt, '音声 createdAt 保全').toBe('2026-02-20T00:00:00Z');
		expect(restoredVoices[0]?.filePath, '音声 filePath remap').toBe(
			`tenants/${T}/voices/${cid}/sample.mp3`,
		);
		expect(restoredVoices[0]?.publicUrl, '音声 publicUrl remap').toBe(
			`/tenants/${T}/voices/${cid}/sample.mp3`,
		);
	});

	// #3329 QM-fix (2)(a): auto:weekly チャレンジの dedup round-trip。
	// 復元行が getOrCreateWeeklyAuto の dedup 経路 (SQLite=部分 unique index / DynamoDB=AUTO# SK) に
	// 収まり、後続の getOrCreateWeeklyAuto(同一週) が **同一の単一行** を返す (= 週次チャレンジが
	// 復元後に二重生成されない) ことを実 SQLite で固定する。
	it('auto:weekly チャレンジが round-trip 後も単一行で、後続 get-or-create が重複生成しない', async () => {
		testDb.insert(schema.children).values({ nickname: 'あおい', age: 9, theme: 'green' }).run(); // id=1

		// auto:weekly を get-or-create で seed (sourceTemplateId は既定 'auto:weekly')。
		const auto = await getRepos().childChallenge.getOrCreateWeeklyAuto(
			{
				childId: 1,
				title: '今週のチャレンジ',
				periodType: 'weekly',
				startDate: '2026-03-02',
				endDate: '2026-03-08',
				targetConfig: '{"metric":"count","baseTarget":5}',
				rewardConfig: '{"points":80}',
				targetValue: 5,
			},
			T,
		);
		expect(auto.sourceTemplateId, 'seed:auto sourceTemplateId').toBe('auto:weekly');
		// 進捗を前進させる (round-trip で保全されること)。
		await getRepos().childChallenge.updateProgress(auto.id, 4, T);

		// export
		const data = await exportFamilyData({ tenantId: T });
		expect(data.data.childChallenges.length, 'export:auto challenge').toBe(1);
		expect(data.data.childChallenges[0]?.sourceTemplateId, 'export:auto sourceTemplateId').toBe(
			'auto:weekly',
		);
		expect(data.data.childChallenges[0]?.currentValue, 'export:auto 進捗').toBe(4);

		// replace = clear → import
		await clearAllFamilyData(T);
		await importFamilyData(data, T);

		const children = testDb.select().from(schema.children).all();
		const cid = children[0]?.id as number;

		// 復元行: auto:weekly が単一行 + 進捗保全。
		const restored = await getRepos().childChallenge.findByChildId(cid, T);
		expect(restored.length, '復元後 auto challenge 1 件').toBe(1);
		expect(restored[0]?.sourceTemplateId, '復元 sourceTemplateId').toBe('auto:weekly');
		expect(restored[0]?.currentValue, '復元 進捗保全').toBe(4);
		const restoredId = restored[0]?.id as number;

		// 後続 get-or-create(同一週) が **復元行と同一の単一行** を返す (= 復元行が dedup 経路に収まり
		// 2 個目を生成しない)。重複していれば findByChildId が 2 件になり fail する。
		const reGot = await getRepos().childChallenge.getOrCreateWeeklyAuto(
			{
				childId: cid,
				title: '今週のチャレンジ',
				periodType: 'weekly',
				startDate: '2026-03-02',
				endDate: '2026-03-08',
				targetConfig: '{"metric":"count","baseTarget":5}',
				rewardConfig: '{"points":80}',
				targetValue: 5,
			},
			T,
		);
		expect(reGot.id, 'get-or-create が復元行に収束 (重複生成なし)').toBe(restoredId);
		expect(reGot.currentValue, 'get-or-create が進捗を破壊しない').toBe(4);
		const afterReGet = await getRepos().childChallenge.findByChildId(cid, T);
		expect(afterReGet.length, '後続 get-or-create 後も 1 件 (二重生成なし)').toBe(1);
	});

	// #3329 QM-fix (2)(b): 完了 + 受取済 (completed/rewardClaimed/各日時/status) の全フィールド保全。
	it('completed=1 + rewardClaimed=1 のチャレンジが全フィールド保全で round-trip する', async () => {
		testDb.insert(schema.children).values({ nickname: 'はると', age: 10, theme: 'blue' }).run(); // id=1

		const ch = await getRepos().childChallenge.insert(
			{
				childId: 1,
				title: '完了チャレンジ',
				periodType: 'weekly',
				startDate: '2026-03-09',
				endDate: '2026-03-15',
				targetConfig: '{"metric":"count","baseTarget":3}',
				rewardConfig: '{"points":120}',
				targetValue: 3,
			},
			T,
		);
		// 進捗 → 完了 → ごほうび受取 まで進め、completed/completedAt/status/rewardClaimed/rewardClaimedAt を立てる。
		await getRepos().childChallenge.updateProgress(ch.id, 3, T);
		await getRepos().childChallenge.markCompleted(ch.id, T);
		const claimed = await getRepos().childChallenge.claimReward(ch.id, T);
		expect(claimed, 'seed: claimReward 成功').toBe(1);

		// seed 後の確定状態を取得 (id 以外を round-trip 後と厳格比較する基準)。
		const seeded = await getRepos().childChallenge.findById(ch.id, T);
		expect(seeded?.completed, 'seed: completed').toBe(1);
		expect(seeded?.rewardClaimed, 'seed: rewardClaimed').toBe(1);
		expect(seeded?.status, 'seed: status').toBe('completed');
		expect(seeded?.completedAt, 'seed: completedAt 非 null').toBeTruthy();
		expect(seeded?.rewardClaimedAt, 'seed: rewardClaimedAt 非 null').toBeTruthy();

		const data = await exportFamilyData({ tenantId: T });
		expect(data.data.childChallenges.length, 'export:完了 challenge').toBe(1);

		await clearAllFamilyData(T);
		await importFamilyData(data, T);

		const children = testDb.select().from(schema.children).all();
		const cid = children[0]?.id as number;
		const restored = (await getRepos().childChallenge.findByChildId(cid, T))[0];
		expect(restored, '復元 challenge 存在').toBeTruthy();

		// 全フィールドが verbatim 保全される (id / childId は再採番されるため除外して厳格比較)。
		expect(
			{
				title: restored?.title,
				challengeType: restored?.challengeType,
				periodType: restored?.periodType,
				startDate: restored?.startDate,
				endDate: restored?.endDate,
				targetConfig: restored?.targetConfig,
				rewardConfig: restored?.rewardConfig,
				status: restored?.status,
				isActive: restored?.isActive,
				sourceTemplateId: restored?.sourceTemplateId,
				currentValue: restored?.currentValue,
				targetValue: restored?.targetValue,
				completed: restored?.completed,
				completedAt: restored?.completedAt,
				rewardClaimed: restored?.rewardClaimed,
				rewardClaimedAt: restored?.rewardClaimedAt,
				createdAt: restored?.createdAt,
				updatedAt: restored?.updatedAt,
			},
			'完了/受取/日時/status 全フィールド保全',
		).toEqual({
			title: seeded?.title,
			challengeType: seeded?.challengeType,
			periodType: seeded?.periodType,
			startDate: seeded?.startDate,
			endDate: seeded?.endDate,
			targetConfig: seeded?.targetConfig,
			rewardConfig: seeded?.rewardConfig,
			status: seeded?.status,
			isActive: seeded?.isActive,
			sourceTemplateId: seeded?.sourceTemplateId,
			currentValue: seeded?.currentValue,
			targetValue: seeded?.targetValue,
			completed: seeded?.completed,
			completedAt: seeded?.completedAt,
			rewardClaimed: seeded?.rewardClaimed,
			rewardClaimedAt: seeded?.rewardClaimedAt,
			createdAt: seeded?.createdAt,
			updatedAt: seeded?.updatedAt,
		});
	});

	// #3329: きょうだい間おうえんスタンプ (from/to 2 child) の round-trip。tenant-scoped かつ 2 child を
	// 参照するため専用ケースで検証する (sentAt/shownAt 保全 + from/to の childRef 再結合)。
	it('きょうだい間おうえんスタンプが from/to 再結合 + sentAt/shownAt 保全で round-trip する', async () => {
		testDb.insert(schema.children).values({ nickname: 'あに', age: 10, theme: 'blue' }).run(); // id=1
		testDb.insert(schema.children).values({ nickname: 'いもうと', age: 7, theme: 'pink' }).run(); // id=2

		await getRepos().siblingCheer.insertForRestore(
			{
				fromChildId: 1,
				toChildId: 2,
				stampCode: 'good-job',
				sentAt: '2026-02-15T10:00:00Z',
				shownAt: '2026-02-15T12:00:00Z',
			},
			T,
		);

		// export
		const data = await exportFamilyData({ tenantId: T });
		expect(data.data.siblingCheers.length, 'export:おうえん').toBe(1);
		expect(data.data.siblingCheers[0]?.fromChildRef, 'export:from ref').toBe('child-1');
		expect(data.data.siblingCheers[0]?.toChildRef, 'export:to ref').toBe('child-2');

		// replace = clear → import
		await clearAllFamilyData(T);
		await importFamilyData(data, T);

		const children = testDb.select().from(schema.children).all();
		expect(children.length, '子復元').toBe(2);
		// 復元後 child id を nickname で引き当て (autoincrement で id がずれ得るため)
		const brother = children.find((c) => c.nickname === 'あに')?.id as number;
		const sister = children.find((c) => c.nickname === 'いもうと')?.id as number;

		const restored = await getRepos().siblingCheer.findAllByTenant(T);
		expect(restored.length, 'おうえん').toBe(1);
		expect(restored[0]?.fromChildId, 'from 再結合').toBe(brother);
		expect(restored[0]?.toChildId, 'to 再結合').toBe(sister);
		expect(restored[0]?.sentAt, 'sentAt 保全').toBe('2026-02-15T10:00:00Z');
		expect(restored[0]?.shownAt, 'shownAt 保全').toBe('2026-02-15T12:00:00Z');
	});

	// #3422: per-child 活動の dailyLimit / nameKana / nameKanji が backup round-trip で保全される。
	// create/update では persist 是正済だが export/import 境界で同 3 列が silent drop され、復元後に
	// dailyLimit が null (= 1 日 1 回固定) へ戻る取りこぼしを赤で機械再現し潰す。
	// dailyLimit semantics は null=1回 / 0=無制限 / N=N回 (activity-log-service.ts §daily limit)。
	// **特に dailyLimit=0 (無制限) が `?? null` のエッジで 1 回固定へ落ちないことを直接固定**する。
	it('活動の dailyLimit (0=無制限含む) / nameKana / nameKanji が export→clear→import で保全される', async () => {
		testDb.insert(schema.children).values({ nickname: 'みお', age: 8, theme: 'pink' }).run(); // id=1
		// 非デフォルト値の活動 2 件: dailyLimit=3 (3 回) と dailyLimit=0 (無制限)。
		seedChildActivities(testDb, 1, [
			{
				name: 'おてつだい',
				categoryId: 1,
				icon: '🧹',
				basePoints: 5,
				dailyLimit: 3,
				nameKana: 'おてつだい',
				nameKanji: 'お手伝い',
				sortOrder: 1,
			},
			{
				name: 'みずをのむ',
				categoryId: 3,
				icon: '💧',
				basePoints: 1,
				dailyLimit: 0, // 無制限
				nameKana: 'みずをのむ',
				nameKanji: '水を飲む',
				sortOrder: 2,
			},
		]);

		// --- export: 3 列が ExportChildActivity に載っていること (silent drop なら undefined で fail) ---
		const data = await exportFamilyData({ tenantId: T });
		expect(data.data.childActivities.length, 'export:活動 2 件').toBe(2);
		const exHelp = data.data.childActivities.find((a) => a.name === 'おてつだい');
		const exWater = data.data.childActivities.find((a) => a.name === 'みずをのむ');
		expect(exHelp?.dailyLimit, 'export:dailyLimit=3').toBe(3);
		expect(exHelp?.nameKana, 'export:nameKana').toBe('おてつだい');
		expect(exHelp?.nameKanji, 'export:nameKanji').toBe('お手伝い');
		// 0 が export で欠落 (undefined) / null 化されず、数値 0 のまま載ること。
		expect(exWater?.dailyLimit, 'export:dailyLimit=0 (無制限) 保持').toBe(0);

		// --- replace = clear → import ---
		await clearAllFamilyData(T);
		await importFamilyData(data, T);

		const children = testDb.select().from(schema.children).all();
		const cid = children[0]?.id as number;
		const acts = await getChildActivities(cid, T);
		const help = acts.find((a) => a.name === 'おてつだい');
		const water = acts.find((a) => a.name === 'みずをのむ');

		// dailyLimit=3 / 読み仮名 / 漢字が round-trip で保全される。
		expect(help?.dailyLimit, 'restore:dailyLimit=3 保全').toBe(3);
		expect(help?.nameKana, 'restore:nameKana 保全').toBe('おてつだい');
		expect(help?.nameKanji, 'restore:nameKanji 保全').toBe('お手伝い');
		// **dailyLimit=0 (無制限) が null=1 回固定へ落ちず 0 のまま復元される** (本 PR の核心エッジ)。
		expect(water?.dailyLimit, 'restore:dailyLimit=0 (無制限) が null へ落ちない').toBe(0);
	});

	// #3329: チェックリスト配信先 (assignment) + 日次 override の round-trip。
	// assignment は per-child template の import 時 auto-assign で配信エッジが再構成され、
	// override は createdAt 保全で復元されることを検証する。
	it('チェックリスト配信先が再構成され、日次 override が createdAt 保全で round-trip する', async () => {
		testDb.insert(schema.children).values({ nickname: 'ひかり', age: 9, theme: 'green' }).run(); // id=1
		const repo = getRepos().checklist;

		// family master template を作成 → child へ配信 (assignment エッジ作成)。
		const tpl = await repo.insertTemplate({ name: 'もちものリスト', icon: '📋' }, T);
		await repo.assignTemplateToChildren(tpl.id, [1], T);
		// 日次 override (特定日に項目追加) を createdAt 明示で seed。
		await repo.insertOverrideForRestore(
			{
				childId: 1,
				targetDate: '2026-03-05',
				action: 'add',
				itemName: 'すいとう',
				icon: '📦',
				createdAt: '2026-03-05T07:00:00Z',
			},
			T,
		);

		// export
		const data = await exportFamilyData({ tenantId: T });
		expect(data.data.checklistTemplates.length, 'export:template').toBe(1);
		expect(data.data.checklistOverrides.length, 'export:override').toBe(1);
		expect(data.data.checklistOverrides[0]?.itemName, 'export:override itemName').toBe('すいとう');

		// replace = clear → import
		await clearAllFamilyData(T);
		await importFamilyData(data, T);

		const children = testDb.select().from(schema.children).all();
		expect(children.length, '子復元').toBe(1);
		const cid = children[0]?.id as number;

		// 配信エッジ再構成: child に template が配信されている (findAssignmentsByChild が 1 件)。
		const assignments = await repo.findAssignmentsByChild(cid, T);
		expect(assignments.length, '配信エッジ再構成').toBe(1);

		// 日次 override: createdAt 保全で復元。
		const overrides = await repo.findOverridesByChild(cid, T);
		expect(overrides.length, 'override').toBe(1);
		expect(overrides[0]?.itemName, 'override itemName 保全').toBe('すいとう');
		expect(overrides[0]?.createdAt, 'override createdAt 保全').toBe('2026-03-05T07:00:00Z');
	});
});
