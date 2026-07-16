// tests/unit/services/import-restore-idempotency.test.ts
// #3394 (same-class #3385/#3391/#3387/#3401/#3414/#3420/#3465):
// backup restore の冪等 guard 統一契約を実 SQLite で検証する (failing-test-first)。
//
// 検証する統一契約 (src/lib/server/db/restore-idempotency.ts が SSOT):
//   1. natural-key 重複 (challenge auto:weekly / stampCard / stampEntry / certificate /
//      activityPref) は skip され imported に加算されない (count 偽装 #2263 class 防止)
//   2. content-dedup (parentMessage / siblingCheer) は merge mode で同一 content の重複を skip、
//      verbatim (cutover #3653) では bypass される
//   3. verbatim 値検証 (#3414/#3420): 未知 messageType / 未知 stampCode / 不正 sentAt は
//      mode 不問で skip + warning 可視化
//   4. count 恒等式: 各 entity で「入力件数 = imported + skipped」(silent loss 検出)
//   5. timestamps round-trip (#3465 item 3): activityPref の createdAt/updatedAt が保全される

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

import { type ActivityId, asCategoryId, asChildId } from '$lib/domain/ids';
import { findAllChildren } from '../../../src/lib/server/db/child-repo';
import { getRepos } from '../../../src/lib/server/db/factory';
import { getChildActivities } from '../../../src/lib/server/services/activity-service';
import { clearAllFamilyData } from '../../../src/lib/server/services/data-service';
import { exportFamilyData } from '../../../src/lib/server/services/export-service';
import { importFamilyData } from '../../../src/lib/server/services/import-service';

const T = 't-restore-idem';

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

/** seed → export → 重複/不正行を注入した「corrupted backup」を作る共通 arrange。 */
async function buildCorruptedBackup() {
	// --- seed: 2 children (cheer は from/to 2 child 必要) ---
	testDb.insert(schema.children).values({ nickname: 'ゆうき', age: 8, theme: 'blue' }).run(); // id=1
	testDb.insert(schema.children).values({ nickname: 'さくら', age: 6, theme: 'pink' }).run(); // id=2
	seedChildActivities(testDb, 1, [{ name: 'うんどうA', categoryId: asCategoryId(1), icon: '🏃' }]);
	const acts = await getChildActivities(asChildId(1), T);
	const actId = acts[0]?.id as ActivityId;

	// auto:weekly チャレンジ (#3387: (child, weekStart) natural key)
	await getRepos().childChallenge.insert(
		{
			childId: asChildId(1),
			title: 'こんしゅうのチャレンジ',
			periodType: 'weekly',
			startDate: '2026-03-01',
			endDate: '2026-03-07',
			targetConfig: '{"metric":"count","baseTarget":3}',
			rewardConfig: '{"points":50}',
			targetValue: 3,
			sourceTemplateId: 'auto:weekly',
		},
		T,
	);

	// スタンプカード + 押印 (#3391: (child, weekStart) / (card, slot) natural key)
	const card = await getRepos().stampCard.insertCardForRestore(
		{
			childId: asChildId(1),
			weekStart: '2026-02-23',
			weekEnd: '2026-03-01',
			status: 'collecting',
			redeemedPoints: null,
			redeemedAt: null,
			createdAt: '2026-02-23T00:00:00Z',
			updatedAt: '2026-02-23T00:00:00Z',
		},
		T,
	);
	if (!card) throw new Error('seed: stamp card insert failed');
	await getRepos().stampCard.insertEntryForRestore(
		{
			cardId: card.id,
			stampMasterId: null,
			omikujiRank: 'daikichi',
			slot: 0,
			loginDate: '2026-02-24',
			earnedAt: '2026-02-24T08:00:00Z',
		},
		T,
	);

	// 証明書 (#3401/#3394: (child, certificateType) natural key)
	await getRepos().certificate.insertForRestore(
		{
			childId: asChildId(1),
			certificateType: 'graduation',
			title: 'そつぎょうしょうめいしょ',
			description: null,
			issuedAt: '2026-02-01T00:00:00Z',
			metadata: null,
		},
		T,
	);

	// 活動設定 (#3465: (child, activity) natural key + timestamps round-trip)
	await getRepos().activityPref.insertForRestore(
		{
			childId: asChildId(1),
			activityId: actId,
			isPinned: 1,
			pinOrder: 1,
			createdAt: '2026-02-05T00:00:00Z',
			updatedAt: '2026-02-06T00:00:00Z',
		},
		T,
	);

	// 親→子メッセージ (#3414: content-dedup 対象)
	await getRepos().message.insertForRestore(
		{
			childId: asChildId(1),
			messageType: 'text',
			stampCode: null,
			body: 'よくがんばったね',
			icon: '💌',
			sentAt: '2026-02-10T09:00:00Z',
			shownAt: null,
			bonusPoints: null,
			rewardCategory: null,
		},
		T,
	);

	// きょうだいおうえん (#3420: content-dedup 対象、from=2 → to=1)
	await getRepos().siblingCheer.insertForRestore(
		{
			fromChildId: asChildId(2),
			toChildId: asChildId(1),
			stampCode: 'ganbare',
			sentAt: '2026-02-11T10:00:00Z',
			shownAt: null,
		},
		T,
	);

	// --- export → corrupted backup 化 (重複 + 不正行を注入) ---
	const data = await exportFamilyData({ tenantId: T });
	expect(data.data.childChallenges.length).toBe(1);
	expect(data.data.stampCards.length).toBe(1);
	expect(data.data.certificates.length).toBe(1);
	expect(data.data.activityPrefs.length).toBe(1);
	expect(data.data.parentMessages.length).toBe(1);
	expect(data.data.siblingCheers.length).toBe(1);

	// natural-key 重複 (手編集 backup 相当): 同 (child, week) auto:weekly / 同 (child, week) card /
	// 同 (card, slot) entry / 同 (child, type) certificate / 同 (child, activity) pref
	const challenge0 = data.data.childChallenges[0];
	const card0 = data.data.stampCards[0];
	const entry0 = card0?.entries[0];
	const cert0 = data.data.certificates[0];
	const pref0 = data.data.activityPrefs[0];
	const msg0 = data.data.parentMessages[0];
	const cheer0 = data.data.siblingCheers[0];
	if (!challenge0 || !card0 || !entry0 || !cert0 || !pref0 || !msg0 || !cheer0) {
		throw new Error('seed export rows missing');
	}
	card0.entries.push({ ...entry0 }); // 同 card 内 slot 重複
	data.data.childChallenges.push({ ...challenge0 });
	data.data.stampCards.push(structuredClone(card0)); // 重複 card (entries 2 件込み)
	data.data.certificates.push({ ...cert0 });
	data.data.activityPrefs.push({ ...pref0 });
	// content 重複 (同一 backup 再取込相当) + 不正行 (改竄 backup 相当、#3414/#3420 値検証)
	data.data.parentMessages.push({ ...msg0 });
	data.data.parentMessages.push({ ...msg0, messageType: 'evil_type' });
	data.data.siblingCheers.push({ ...cheer0 });
	data.data.siblingCheers.push({ ...cheer0, stampCode: 'hacked_code' });

	return data;
}

describe('#3394 restore 冪等 guard 統一 (corrupted backup → skip + count 整合)', () => {
	it('merge: natural-key/content 重複は skip され、count 恒等式 (入力 = imported + skipped) が全 entity で成立する', async () => {
		const data = await buildCorruptedBackup();
		await clearAllFamilyData(T);

		const result = await importFamilyData(data, T);

		// --- natural-key 重複 → skip + 実 DB は 1 行 ---
		expect(result.childChallengesImported, 'challenge imported').toBe(1);
		expect(result.childChallengesSkipped, 'challenge skipped').toBe(1);
		expect(result.stampCardsImported, 'card imported').toBe(1);
		expect(result.stampCardsSkipped, 'card skipped').toBe(1);
		// entries 入力 4 (正 1 + 同 card slot 重複 1 + 重複 card 配下 2) → 実 insert は 1 のみ
		expect(result.stampEntriesImported, 'entry imported').toBe(1);
		expect(result.stampEntriesSkipped, 'entry skipped').toBe(3);
		expect(result.certificatesImported, 'cert imported').toBe(1);
		expect(result.certificatesSkipped, 'cert skipped').toBe(1);
		expect(result.activityPrefsImported, 'pref imported').toBe(1);
		expect(result.activityPrefsSkipped, 'pref skipped').toBe(1);

		// --- content-dedup + 値検証 (入力 3 = 正 1 + content 重複 1 + 不正 1) ---
		expect(result.parentMessagesImported, 'message imported').toBe(1);
		expect(result.parentMessagesSkipped, 'message skipped').toBe(2);
		expect(result.siblingCheersImported, 'cheer imported').toBe(1);
		expect(result.siblingCheersSkipped, 'cheer skipped').toBe(2);
		// 不正行は warning で可視化 (silent skip 禁止、#3414/#3420)
		expect(result.warnings.some((w) => w.includes('evil_type'))).toBe(true);
		expect(result.warnings.some((w) => w.includes('hacked_code'))).toBe(true);

		// --- count 恒等式 (入力件数 = imported + skipped、silent loss 検出) ---
		const identity: Array<[string, number, number, number]> = [
			[
				'childChallenges',
				data.data.childChallenges.length,
				result.childChallengesImported,
				result.childChallengesSkipped,
			],
			[
				'stampCards',
				data.data.stampCards.length,
				result.stampCardsImported,
				result.stampCardsSkipped,
			],
			[
				'stampEntries',
				data.data.stampCards.reduce((n, c) => n + c.entries.length, 0),
				result.stampEntriesImported,
				result.stampEntriesSkipped,
			],
			[
				'certificates',
				data.data.certificates.length,
				result.certificatesImported,
				result.certificatesSkipped,
			],
			[
				'activityPrefs',
				data.data.activityPrefs.length,
				result.activityPrefsImported,
				result.activityPrefsSkipped,
			],
			[
				'parentMessages',
				data.data.parentMessages.length,
				result.parentMessagesImported,
				result.parentMessagesSkipped,
			],
			[
				'siblingCheers',
				data.data.siblingCheers.length,
				result.siblingCheersImported,
				result.siblingCheersSkipped,
			],
		];
		for (const [name, input, imported, skipped] of identity) {
			expect(imported + skipped, `count 恒等式: ${name}`).toBe(input);
		}

		// --- 実 DB 最終状態: 重複が物理的に 1 行へ収束している ---
		const children = await findAllChildren(T);
		const restoredChild = children.find((c) => c.nickname === 'ゆうき');
		if (!restoredChild) throw new Error('restored child not found');
		const challenges = await getRepos().childChallenge.findByChildId(restoredChild.id, T);
		expect(challenges.length, 'DB: auto:weekly 1 行').toBe(1);
		const cards = await getRepos().stampCard.findCardsByChild(restoredChild.id, T);
		expect(cards.length, 'DB: card 1 枚').toBe(1);
		const cardId = cards[0]?.id as string;
		const entries = await getRepos().stampCard.findEntriesByCardId(cardId, T);
		expect(entries.length, 'DB: 押印 1 件').toBe(1);
		const certs = await getRepos().certificate.findCertificates(restoredChild.id, T);
		expect(certs.length, 'DB: 証明書 1 通').toBe(1);
		const prefs = await getRepos().activityPref.findAllByChild(restoredChild.id, T);
		expect(prefs.length, 'DB: 活動設定 1 件').toBe(1);
		const messages = await getRepos().message.findMessages(restoredChild.id, 100, T);
		expect(messages.length, 'DB: メッセージ 1 件').toBe(1);

		// --- #3465 item 3: activityPref createdAt/updatedAt round-trip (ADR-0006) ---
		expect(prefs[0]?.createdAt, 'pref createdAt 保全').toBe('2026-02-05T00:00:00Z');
		expect(prefs[0]?.updatedAt, 'pref updatedAt 保全').toBe('2026-02-06T00:00:00Z');
		expect(prefs[0]?.isPinned).toBe(1);
		expect(prefs[0]?.pinOrder).toBe(1);
	});

	it('merge: 同一 backup の再取込 (2 回連続 import) でも重複行が増殖しない (冪等)', async () => {
		const data = await buildCorruptedBackup();
		await clearAllFamilyData(T);

		await importFamilyData(data, T);
		// 2 回目: 子は新規作成されるが、各 entity は「その子の中で」重複しないことを検証する
		// (natural-key / content dedup は per-child scope。同一 backup 内の重複注入分が
		//  2 回目でも同様に skip され、カウントが偽装されないこと)。
		const second = await importFamilyData(data, T);
		expect(second.childChallengesImported).toBe(1);
		expect(second.childChallengesSkipped).toBe(1);
		expect(second.stampCardsImported).toBe(1);
		expect(second.stampEntriesImported).toBe(1);
		expect(second.certificatesImported).toBe(1);
		expect(second.activityPrefsImported).toBe(1);
		expect(second.parentMessagesImported).toBe(1);
		expect(second.siblingCheersImported).toBe(1);
	});

	it('verbatim (cutover #3653): content-dedup は bypass されるが natural-key guard と値検証は維持される', async () => {
		const data = await buildCorruptedBackup();
		await clearAllFamilyData(T);

		const result = await importFamilyData(data, T, undefined, { mode: 'verbatim' });

		// content 重複は正当な複数行として全復元 (dedup bypass)。不正行 (値検証) のみ skip。
		expect(result.parentMessagesImported, 'verbatim: message 重複を保全').toBe(2);
		expect(result.parentMessagesSkipped, 'verbatim: 不正行のみ skip').toBe(1);
		expect(result.siblingCheersImported, 'verbatim: cheer 重複を保全').toBe(2);
		expect(result.siblingCheersSkipped, 'verbatim: 不正行のみ skip').toBe(1);

		// natural-key guard は DB 一意制約の物理事実のため verbatim でも維持 (二重化不能)。
		expect(result.childChallengesImported).toBe(1);
		expect(result.childChallengesSkipped).toBe(1);
		expect(result.stampCardsImported).toBe(1);
		expect(result.stampEntriesImported).toBe(1);
		expect(result.certificatesImported).toBe(1);
		expect(result.activityPrefsImported).toBe(1);
	});
});
