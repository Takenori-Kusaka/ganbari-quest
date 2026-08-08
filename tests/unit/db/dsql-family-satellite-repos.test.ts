// tests/unit/db/dsql-family-satellite-repos.test.ts
// EPIC #3424 / M4-E PR8c / 設計 SSOT: dsql-data-model.md §11.2 / §P9
//
// DSQL 衛星系 family スコープ 7 repo 実装のテスト (実 schema pushSchema、dsql-test-db helper)。
// 設計判断の要点:
//   - **settings は family KVS 昇格**: sqlite 現行の key 単独 PK グローバル KVS から
//     自然複合 PK (family_id, key) へ (schema §11.2 #3557 前提差分)。同 key でも family 別に
//     独立した値を持つことを [ST1] で検証する。
//   - **cross-tenant scan の例外 3 種**: findActiveTrials (cron) / aggregateRecent + searchFreeText
//     (PO KPI 分析) / findPendingBuilds + findStaleBuildingExports + deleteExpired (cron drain /
//     retention) は §11.2 で明示された tenant 無し走査。containment assert で他テストの行と共存する。
//   - **無 tenant 単点 lookup の global UNIQUE (credential 自体が authz)**: viewer_tokens.token /
//     cloud_exports.pin_code (§11.2 機能要件、findByToken/findByPin は tenant 無し)。
//   - **push_subscriptions.endpoint は #3574 ② で family scope 再適用**: findByEndpoint /
//     deleteByEndpoint は endpoint 値単独 lookup 後 family_id で再スコープし cross-family read /
//     IDOR-delete を遮断する (endpoint は attacker 可制御値、認証済 tenantId を持つ経路のため)。
//
// ── Canon TDD test list ──
// ── ISettingsRepo ──
//   [ST1] set/get round-trip + upsert 上書き + getSettings 一括 (空 keys = {}) + §P9 family 独立
//   [ST2] deleteByTenantId は §P9 tenant 限定
//   [ST3] countValuesByPrefix (cross-tenant ops 集計、#4269 ①) が loyalty-service の JS 判定と一致
//   [ST4] #4338 deleteByTenantIdExcept は「残すキー以外を全削除」+ §P9 tenant 限定 (keepKeys 空 = 全削除)
// ── ITrialHistoryRepo ──
//   [TH1] insert (defaults) + findLatestByTenant (created_at 降順の最新) + §P9
//   [TH2] findActiveTrials (end_date >= 今日、cross-tenant) + updateConversion (tenant scope no-op)
//   [TH3] deleteByTenantId は §P9 tenant 限定
// ── IViewerTokenRepo ──
//   [VT1] insert shape + findByTenant (created_at 降順) + §P9
//   [VT2] findByToken (無 tenant 単点 lookup) / revoke (tenant no-op → soft revoke) / deleteById
// ── IPushSubscriptionRepo ──
//   [PS1] insert + findByTenant §P9 + findByEndpoint / deleteByEndpoint (§P9 family scope、#3574 ②)
//   [PS2] insertLog (success boolean→0/1) + countTodayLogs (UTC 日境界) + findRecentLogs 降順 limit
// ── ICancellationReasonRepo ──
//   [CR1] create shape + listByTenant 降順 + §P9
//   [CR2] aggregateRecent (全カテゴリ 0 初期化 + percentage) + searchFreeText (ILIKE / 空 query)
//   [CR3] deleteByTenantId は §P9 tenant 限定
// ── ICloudExportRepo ──
//   [CE1] insert (defaults: pending / maxDownloads 10 / downloadCount 0) + findByTenant 降順 +
//         findById §P9
//   [CE2] findByPin (無 tenant) + incrementDownloadCount (tenant 不一致 no-op)
//   [CE3] updateStatus state machine (#3504/#3509: building=buildStartedAt now / ready=メタ確定 +
//         残渣クリア / failed=failureReason) + findPendingBuilds + findStaleBuildingExports
//   [CE4] deleteExpired (行数) + deleteById + countByTenant
// ── IImageRepo ──
//   [IM1] insertCharacterImage + findCachedImage (type+hash 一致のみ) + §P9
//   [IM2] updateChildAvatarUrl (tenant no-op) + findChildForImage (§P9)
//   [IM3] deleteByTenantId は §P9 tenant 限定
//   [IM5] #4466 updateChildAvatarUrlIfMatches (compare-and-set: null 一致 / 不一致は 0 行 / §P9)
//   [IM4] #3566 ③ (§9.4): file_path が tenant プレフィックス外 / cross-tenant / traversal なら insert 拒否 (孤児バイト防止)

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChildId } from '../../../src/lib/domain/ids';
import { createDsqlCancellationReasonRepo } from '../../../src/lib/server/db/dsql/cancellation-reason-repo';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlCloudExportRepo } from '../../../src/lib/server/db/dsql/cloud-export-repo';
import { createDsqlImageRepo } from '../../../src/lib/server/db/dsql/image-repo';
import { createDsqlPushSubscriptionRepo } from '../../../src/lib/server/db/dsql/push-subscription-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import { createDsqlSettingsRepo } from '../../../src/lib/server/db/dsql/settings-repo';
import { createDsqlTrialHistoryRepo } from '../../../src/lib/server/db/dsql/trial-history-repo';
import { createDsqlViewerTokenRepo } from '../../../src/lib/server/db/dsql/viewer-token-repo';
import type { ICancellationReasonRepo } from '../../../src/lib/server/db/interfaces/cancellation-reason-repo.interface';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import type { ICloudExportRepo } from '../../../src/lib/server/db/interfaces/cloud-export-repo.interface';
import type { IImageRepo } from '../../../src/lib/server/db/interfaces/image-repo.interface';
import type { IPushSubscriptionRepo } from '../../../src/lib/server/db/interfaces/push-subscription-repo.interface';
import type { ISettingsRepo } from '../../../src/lib/server/db/interfaces/settings-repo.interface';
import type { ITrialHistoryRepo } from '../../../src/lib/server/db/interfaces/trial-history-repo.interface';
import type { IViewerTokenRepo } from '../../../src/lib/server/db/interfaces/viewer-token-repo.interface';
import type { InsertCloudExportInput } from '../../../src/lib/server/db/types';
import {
	isLegacyMonthKeyValue,
	JST_MONTH_KEY_PREFIX,
	LOYALTY_LAST_INCREMENT_MONTH_KEY,
} from '../../../src/lib/server/services/loyalty-service';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000e1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000e2';
const UUID_RE = /^[0-9a-f-]{36}$/;
const FUTURE_ISO = '2099-01-01T00:00:00.000Z';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DSQL 衛星系 family repos (M4-E PR8c、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let settingsRepo: ISettingsRepo;
	let trialRepo: ITrialHistoryRepo;
	let tokenRepo: IViewerTokenRepo;
	let pushRepo: IPushSubscriptionRepo;
	let reasonRepo: ICancellationReasonRepo;
	let exportRepo: ICloudExportRepo;
	let imageRepo: IImageRepo;

	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	const seedExport = (pinCode: string, over: Partial<InsertCloudExportInput> = {}) =>
		exportRepo.insert({
			tenantId: FAMILY,
			exportType: 'full',
			pinCode,
			s3Key: `exports/${pinCode}.zip`,
			fileSizeBytes: 0,
			expiresAt: FUTURE_ISO,
			...over,
		});

	beforeAll(async () => {
		t = await createDsqlTestDb();
		const runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		settingsRepo = createDsqlSettingsRepo(t.db);
		trialRepo = createDsqlTrialHistoryRepo(t.db);
		tokenRepo = createDsqlViewerTokenRepo(t.db);
		pushRepo = createDsqlPushSubscriptionRepo(t.db);
		reasonRepo = createDsqlCancellationReasonRepo(t.db);
		exportRepo = createDsqlCloudExportRepo(t.db);
		imageRepo = createDsqlImageRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ─────────────────── ISettingsRepo ───────────────────

	it('[ST1] set/get round-trip + upsert 上書き + getSettings 一括 + §P9 family 独立', async () => {
		expect(await settingsRepo.getSetting('theme', FAMILY)).toBe(undefined);
		await settingsRepo.setSetting('theme', 'pink', FAMILY);
		expect(await settingsRepo.getSetting('theme', FAMILY)).toBe('pink');

		// upsert 上書き (自然複合 PK ON CONFLICT DO UPDATE)
		await settingsRepo.setSetting('theme', 'blue', FAMILY);
		expect(await settingsRepo.getSetting('theme', FAMILY)).toBe('blue');

		// §P9: 同 key でも family 別に独立 (sqlite グローバル KVS からの昇格点)
		await settingsRepo.setSetting('theme', 'green', OTHER_FAMILY);
		expect(await settingsRepo.getSetting('theme', FAMILY)).toBe('blue');
		expect(await settingsRepo.getSetting('theme', OTHER_FAMILY)).toBe('green');

		// getSettings 一括 (存在しない key は欠落、空 keys は SQL 発行なしで {})
		await settingsRepo.setSetting('sound', 'on', FAMILY);
		expect(await settingsRepo.getSettings(['theme', 'sound', 'missing'], FAMILY)).toEqual({
			theme: 'blue',
			sound: 'on',
		});
		expect(await settingsRepo.getSettings([], FAMILY)).toEqual({});
	});

	it('[ST4] #4338 deleteByTenantIdExcept: 残すキー以外を全削除 + §P9 tenant 限定', async () => {
		// 判定 3 キー + 機微キー + 「実装が知らない新しいキー」を混ぜて置く
		await settingsRepo.setSetting('soft_deleted_at', '2026-08-01T00:00:00.000Z', FAMILY);
		await settingsRepo.setSetting('deletion_grace_plan_tier', 'standard', FAMILY);
		await settingsRepo.setSetting('physical_deletion_date', '2026-08-08T00:00:00.000Z', FAMILY);
		await settingsRepo.setSetting('pin_hash', '$2b$10$dummy', FAMILY);
		await settingsRepo.setSetting('session_token', 'session-dummy', FAMILY);
		await settingsRepo.setSetting('questionnaire_challenges', 'つづかない', FAMILY);
		await settingsRepo.setSetting('some_future_key_2099', 'x', FAMILY);
		// prefix 付き動的キー (habit-certificate-notice-service が child ごとに作る形)
		await settingsRepo.setSetting('child:903:habit_certificate_notice', '2026-08-01', FAMILY);
		await settingsRepo.setSetting('pin_hash', '$2b$10$other', OTHER_FAMILY);

		await settingsRepo.deleteByTenantIdExcept(FAMILY, [
			'soft_deleted_at',
			'deletion_grace_plan_tier',
			'physical_deletion_date',
		]);

		// 残すと指定した 3 キーだけが残る (theme / sound / 機微キー / 未知キーは消える)
		const rows = await t.db.execute(
			sql`SELECT key FROM settings WHERE family_id = ${FAMILY} ORDER BY key`,
		);
		expect((rows.rows as unknown as Array<{ key: string }>).map((r) => r.key)).toEqual([
			'deletion_grace_plan_tier',
			'physical_deletion_date',
			'soft_deleted_at',
		]);

		// §P9: 他 family は無傷
		expect(await settingsRepo.getSetting('pin_hash', OTHER_FAMILY)).toBe('$2b$10$other');
		expect(await settingsRepo.getSetting('theme', OTHER_FAMILY)).toBe('green');

		// keepKeys 空は全削除 (NOT IN () の構文エラーに落ちない)
		await settingsRepo.deleteByTenantIdExcept(FAMILY, []);
		expect(await settingsRepo.getSetting('soft_deleted_at', FAMILY)).toBe(undefined);
		expect(await settingsRepo.getSetting('pin_hash', OTHER_FAMILY)).toBe('$2b$10$other');
	});

	it('[ST2] deleteByTenantId: §P9 tenant 限定 (他 tenant 無傷)', async () => {
		await settingsRepo.setSetting('theme', 'blue', FAMILY);
		await settingsRepo.deleteByTenantId(FAMILY);
		expect(await settingsRepo.getSetting('theme', FAMILY)).toBe(undefined);
		expect(await settingsRepo.getSetting('theme', OTHER_FAMILY)).toBe('green');
	});

	// [ST3] #4269 ①: /ops 在庫監査の cross-tenant 集計。SQL の前方一致判定が
	// loyalty-service の JS 判定 (isLegacyMonthKeyValue) と **同じ答えを出す**ことを実 DB で固定する。
	// ここが食い違うと「skip されているのに在庫に出ない」滞留を作る。
	it('[ST3] countValuesByPrefix: cross-tenant 前方一致集計が JS 判定と一致する', async () => {
		const key = LOYALTY_LAST_INCREMENT_MONTH_KEY;
		const values: Record<string, string> = {
			[FAMILY]: '2026-07', // prefix 無し = 基準不明 (滞留)
			[OTHER_FAMILY]: `${JST_MONTH_KEY_PREFIX}2026-08`, // prefix 付き = 基準明示
		};
		for (const [family, value] of Object.entries(values)) {
			await settingsRepo.setSetting(key, value, family);
		}

		const counts = await settingsRepo.countValuesByPrefix(key, JST_MONTH_KEY_PREFIX);
		const expectedLegacy = Object.values(values).filter(isLegacyMonthKeyValue).length;

		expect(counts.total, '同 key の全 family 行を数えていません').toBe(2);
		expect(
			counts.total - counts.withPrefix,
			'SQL の前方一致判定が loyalty-service の JS 判定と食い違っています',
		).toBe(expectedLegacy);
		expect(expectedLegacy).toBe(1);

		// 他 key を巻き込まない (key 述語が効いている)
		await settingsRepo.setSetting('theme', '2026-07', FAMILY);
		expect((await settingsRepo.countValuesByPrefix(key, JST_MONTH_KEY_PREFIX)).total).toBe(2);
	});

	// ─────────────────── ITrialHistoryRepo ───────────────────

	it('[TH1] insert (defaults) + findLatestByTenant (最新) + §P9', async () => {
		await trialRepo.insert({
			tenantId: FAMILY,
			startDate: '2026-06-01',
			endDate: '2026-06-08',
			tier: 'standard',
			source: 'signup',
		});
		await sleep(5);
		await trialRepo.insert({
			tenantId: FAMILY,
			startDate: '2026-07-01',
			endDate: '2099-12-31',
			tier: 'premium',
			source: 'campaign',
			campaignId: 'camp-1',
			trialStartSource: 'email_cta',
		});

		const latest = await trialRepo.findLatestByTenant(FAMILY);
		expect(latest?.id).toMatch(UUID_RE);
		expect(latest?.tenantId).toBe(FAMILY);
		expect(latest?.startDate).toBe('2026-07-01'); // created_at 降順の最新
		expect(latest?.tier).toBe('premium');
		expect(latest?.campaignId).toBe('camp-1');
		expect(latest?.trialStartSource).toBe('email_cta');
		expect(latest?.stripeSubscriptionId).toBe(null); // default
		expect(latest?.upgradeReason).toBe(null);
		// 1 本目は defaults (campaignId / trialStartSource null)
		expect(await trialRepo.findLatestByTenant(OTHER_FAMILY)).toBe(undefined); // §P9
	});

	it('[TH2] findActiveTrials (end_date >= 今日、cross-tenant) + updateConversion (tenant no-op)', async () => {
		await trialRepo.insert({
			tenantId: OTHER_FAMILY,
			startDate: '2026-01-01',
			endDate: '2099-06-30',
			tier: 'standard',
			source: 'signup',
		});
		const active = await trialRepo.findActiveTrials();
		const endDates = active.map((r) => r.endDate);
		expect(endDates).toContain('2099-12-31'); // FAMILY の未来 trial
		expect(endDates).toContain('2099-06-30'); // OTHER_FAMILY の未来 trial (cross-tenant)
		expect(endDates).not.toContain('2026-06-08'); // 過去 trial は含まない

		const target = await trialRepo.findLatestByTenant(FAMILY);
		if (!target) throw new Error('trial not found');
		// 他 tenant を名乗った更新は no-op (#2941 項目 1)
		await trialRepo.updateConversion({
			id: target.id,
			tenantId: OTHER_FAMILY,
			stripeSubscriptionId: 'sub_evil',
			upgradeReason: 'manual',
		});
		expect((await trialRepo.findLatestByTenant(FAMILY))?.stripeSubscriptionId).toBe(null);

		await trialRepo.updateConversion({
			id: target.id,
			tenantId: FAMILY,
			stripeSubscriptionId: 'sub_123',
			upgradeReason: 'auto',
		});
		const updated = await trialRepo.findLatestByTenant(FAMILY);
		expect(updated?.stripeSubscriptionId).toBe('sub_123');
		expect(updated?.upgradeReason).toBe('auto');
	});

	it('[TH3] deleteByTenantId: §P9 tenant 限定 (他 tenant 無傷)', async () => {
		await trialRepo.deleteByTenantId(FAMILY);
		expect(await trialRepo.findLatestByTenant(FAMILY)).toBe(undefined);
		expect((await trialRepo.findLatestByTenant(OTHER_FAMILY))?.endDate).toBe('2099-06-30');
	});

	// ─────────────────── IViewerTokenRepo ───────────────────

	it('[VT1] insert shape + findByTenant (created_at 降順) + §P9', async () => {
		const a = await tokenRepo.insert({ token: 'tok-a' }, FAMILY);
		expect(a.id).toMatch(UUID_RE);
		expect(a.tenantId).toBe(FAMILY);
		expect(a.token).toBe('tok-a');
		expect(a.label).toBe(null); // default
		expect(a.expiresAt).toBe(null);
		expect(a.revokedAt).toBe(null);
		expect(a.createdAt).toBeTruthy();

		await sleep(5);
		const b = await tokenRepo.insert(
			{ token: 'tok-b', label: 'おばあちゃん用', expiresAt: FUTURE_ISO },
			FAMILY,
		);
		expect(b.label).toBe('おばあちゃん用');
		expect(Date.parse(b.expiresAt ?? '')).toBe(Date.parse(FUTURE_ISO));

		const list = await tokenRepo.findByTenant(FAMILY);
		expect(list.map((r) => r.token)).toEqual(['tok-b', 'tok-a']); // created_at 降順
		expect(await tokenRepo.findByTenant(OTHER_FAMILY)).toEqual([]); // §P9
	});

	it('[VT2] findByToken (無 tenant lookup) / revoke (tenant no-op → soft revoke) / deleteById', async () => {
		const found = await tokenRepo.findByToken('tok-a');
		expect(found?.tenantId).toBe(FAMILY); // token global UNIQUE の単点 lookup
		expect(await tokenRepo.findByToken('tok-nope')).toBe(undefined);

		// 他 tenant を名乗った revoke は no-op
		await tokenRepo.revoke(found?.id ?? '', OTHER_FAMILY);
		expect((await tokenRepo.findByToken('tok-a'))?.revokedAt).toBe(null);

		await tokenRepo.revoke(found?.id ?? '', FAMILY);
		expect((await tokenRepo.findByToken('tok-a'))?.revokedAt).not.toBe(null); // soft revoke

		// deleteById も tenant 束縛
		await tokenRepo.deleteById(found?.id ?? '', OTHER_FAMILY);
		expect(await tokenRepo.findByToken('tok-a')).not.toBe(undefined);
		await tokenRepo.deleteById(found?.id ?? '', FAMILY);
		expect(await tokenRepo.findByToken('tok-a')).toBe(undefined);
	});

	// ─────────────────── IPushSubscriptionRepo ───────────────────

	it('[PS1] insert + findByTenant §P9 + findByEndpoint / deleteByEndpoint (§P9 family scope、#3574 ②)', async () => {
		const rec = await pushRepo.insert({
			tenantId: FAMILY,
			endpoint: 'https://push.example/ep-1',
			keysP256dh: 'p256-1',
			keysAuth: 'auth-1',
			userAgent: 'test-ua',
			subscriberRole: 'parent',
		});
		expect(rec.id).toMatch(UUID_RE);
		expect(rec.tenantId).toBe(FAMILY);
		expect(rec.subscriberRole).toBe('parent');
		expect(rec.userAgent).toBe('test-ua');

		await pushRepo.insert({
			tenantId: FAMILY,
			endpoint: 'https://push.example/ep-2',
			keysP256dh: 'p256-2',
			keysAuth: 'auth-2',
			subscriberRole: 'owner',
		});
		expect((await pushRepo.findByTenant(FAMILY)).length).toBe(2);
		expect(await pushRepo.findByTenant(OTHER_FAMILY)).toEqual([]); // §P9

		// #3574 ②: endpoint (global UNIQUE) の値単独 lookup 後、返却前に family scope を再適用する (§P9)。
		// 所有 family は取得できるが、他 family を名乗った lookup は cross-family read 遮断で undefined。
		const byEp = await pushRepo.findByEndpoint('https://push.example/ep-2', FAMILY);
		expect(byEp?.subscriberRole).toBe('owner');
		expect(byEp?.userAgent).toBe(null); // default
		expect(await pushRepo.findByEndpoint('https://push.example/ep-2', OTHER_FAMILY)).toBe(
			undefined,
		);

		// 他 family を名乗った削除 (unsubscribe が body.endpoint をそのまま渡す IDOR 経路) は no-op。
		await pushRepo.deleteByEndpoint('https://push.example/ep-2', OTHER_FAMILY);
		expect(
			(await pushRepo.findByEndpoint('https://push.example/ep-2', FAMILY))?.subscriberRole,
		).toBe('owner');
		// 所有 family からの削除は成功する。
		await pushRepo.deleteByEndpoint('https://push.example/ep-2', FAMILY);
		expect(await pushRepo.findByEndpoint('https://push.example/ep-2', FAMILY)).toBe(undefined);
		expect((await pushRepo.findByTenant(FAMILY)).length).toBe(1);
	});

	it('[PS2] insertLog (success 0/1) + countTodayLogs (UTC 日境界) + findRecentLogs 降順 limit', async () => {
		const ok = await pushRepo.insertLog({
			tenantId: FAMILY,
			notificationType: 'reminder',
			title: 'きろくの時間',
			body: 'きょうの活動をきろくしよう',
			success: true,
		});
		expect(ok.id).toMatch(UUID_RE);
		expect(ok.success).toBe(1); // boolean→0/1
		expect(ok.errorMessage).toBe(null);
		expect(ok.sentAt).toBeTruthy();

		await sleep(5);
		const ng = await pushRepo.insertLog({
			tenantId: FAMILY,
			notificationType: 'reminder',
			title: '失敗分',
			body: 'x',
			success: false,
			errorMessage: 'endpoint gone',
		});
		expect(ng.success).toBe(0);
		expect(ng.errorMessage).toBe('endpoint gone');

		// #4051 AC3: 「今日」を test プロセスの実時計から作らない。挿入行の sent_at (= DB が
		// 打刻した実際の値) と同じソースから UTC 日付を導く。プロセス時計由来だと UTC 深夜を
		// 跨いだ瞬間に「挿入行の日付」と「assertion の日付」が別日になり得る。
		const today = new Date(ok.sentAt as string | number | Date).toISOString().slice(0, 10);
		// 2 行が同じ UTC 日に入ったことを明示 (跨いだ場合は count 2 の前提が崩れるため先に落とす)
		expect(new Date(ng.sentAt as string | number | Date).toISOString().slice(0, 10)).toBe(today);
		expect(await pushRepo.countTodayLogs(FAMILY, today)).toBe(2);
		expect(await pushRepo.countTodayLogs(OTHER_FAMILY, today)).toBe(0); // §P9
		expect(await pushRepo.countTodayLogs(FAMILY, '2000-01-01')).toBe(0); // 日境界

		// 過去日の log は当日カウントに入らない (直 INSERT で過去 sent_at を差し込む)
		await t.db.execute(sql`
			INSERT INTO notification_logs (family_id, notification_type, title, body, sent_at)
			VALUES (${FAMILY}, 'reminder', '過去分', 'y', '2020-01-01T00:00:00Z'::timestamptz)
		`);
		expect(await pushRepo.countTodayLogs(FAMILY, today)).toBe(2);

		const recent = await pushRepo.findRecentLogs(FAMILY, 2);
		expect(recent.map((l) => l.title)).toEqual(['失敗分', 'きろくの時間']); // sent_at 降順 + limit
	});

	// ─────────────────── ICancellationReasonRepo ───────────────────

	it('[CR1] create shape + listByTenant 降順 + §P9', async () => {
		const a = await reasonRepo.create({
			tenantId: FAMILY,
			category: 'graduation',
			freeText: 'もう自分でできるようになった',
			planAtCancellation: 'standard',
			stripeSubscriptionId: 'sub_c1',
		});
		expect(a.id).toMatch(UUID_RE);
		expect(a.tenantId).toBe(FAMILY);
		expect(a.category).toBe('graduation');
		expect(a.freeText).toBe('もう自分でできるようになった');
		expect(a.planAtCancellation).toBe('standard');
		expect(a.stripeSubscriptionId).toBe('sub_c1');

		await sleep(5);
		const b = await reasonRepo.create({ tenantId: FAMILY, category: 'churn' });
		expect(b.freeText).toBe(null); // defaults
		expect(b.planAtCancellation).toBe(null);

		await reasonRepo.create({
			tenantId: OTHER_FAMILY,
			category: 'pause',
			freeText: '一時停止です',
		});

		const list = await reasonRepo.listByTenant(FAMILY);
		expect(list.map((r) => r.category)).toEqual(['churn', 'graduation']); // 最新順
		expect((await reasonRepo.listByTenant(OTHER_FAMILY)).length).toBe(1); // §P9
	});

	it('[CR2] aggregateRecent (全カテゴリ 0 初期化 + percentage) + searchFreeText (ILIKE / 空 query)', async () => {
		// [CR1] で 3 件 (graduation / churn / pause) 投入済。cross-tenant 集計 (sqlite と同 shape)。
		const agg = await reasonRepo.aggregateRecent();
		expect(agg.total).toBe(3);
		expect(agg.breakdown.map((b) => b.category)).toEqual(['graduation', 'churn', 'pause']);
		for (const b of agg.breakdown) {
			expect(b.count).toBe(1);
			expect(b.percentage).toBe(33.3); // Math.round(1/3*1000)/10
		}
		// days=0 相当の未来 since は 0 件 → 全カテゴリ 0 件 + percentage 0
		const empty = await reasonRepo.aggregateRecent(-1);
		expect(empty.total).toBe(0);
		expect(empty.breakdown.every((b) => b.count === 0 && b.percentage === 0)).toBe(true);

		// searchFreeText: 部分一致 (cross-tenant、free_text 非空のみ)
		const hit = await reasonRepo.searchFreeText('自分でできる');
		expect(hit.length).toBe(1);
		expect(hit[0]?.category).toBe('graduation');
		// 空 query は非空 free_text 全件 (churn は free_text null なので除外)
		const all = await reasonRepo.searchFreeText('  ');
		expect(all.map((r) => r.category).sort()).toEqual(['graduation', 'pause']);
		expect(await reasonRepo.searchFreeText('存在しない語')).toEqual([]);
	});

	it('[CR3] deleteByTenantId: §P9 tenant 限定 (他 tenant 無傷)', async () => {
		await reasonRepo.deleteByTenantId(OTHER_FAMILY);
		expect(await reasonRepo.listByTenant(OTHER_FAMILY)).toEqual([]);
		expect((await reasonRepo.listByTenant(FAMILY)).length).toBe(2);
	});

	// ─────────────────── ICloudExportRepo ───────────────────

	it('[CE1] insert (defaults) + findByTenant 降順 + findById §P9', async () => {
		const a = await seedExport('111111', { label: '初回バックアップ' });
		expect(a.id).toMatch(UUID_RE);
		expect(a.tenantId).toBe(FAMILY);
		expect(a.status).toBe('pending'); // default (async build 起票)
		expect(a.maxDownloads).toBe(10); // default
		expect(a.downloadCount).toBe(0);
		expect(a.failureReason).toBe(null);
		expect(a.buildStartedAt).toBe(null);
		expect(a.label).toBe('初回バックアップ');
		expect(Date.parse(a.expiresAt)).toBe(Date.parse(FUTURE_ISO));

		await sleep(5);
		const b = await seedExport('222222', { status: 'ready', fileSizeBytes: 1024 });
		expect(b.status).toBe('ready'); // 既存同期経路互換 (input.status 優先)
		expect(b.fileSizeBytes).toBe(1024);

		const list = await exportRepo.findByTenant(FAMILY);
		expect(list.map((r) => r.pinCode)).toEqual(['222222', '111111']); // created_at 降順
		expect(await exportRepo.findByTenant(OTHER_FAMILY)).toEqual([]); // §P9
		expect((await exportRepo.findById(a.id, FAMILY))?.pinCode).toBe('111111');
		expect(await exportRepo.findById(a.id, OTHER_FAMILY)).toBe(undefined); // §P9
	});

	it('[CE2] findByPin (無 tenant lookup) + incrementDownloadCount (tenant 不一致 no-op)', async () => {
		const rec = await exportRepo.findByPin('111111');
		expect(rec?.tenantId).toBe(FAMILY); // pin_code global UNIQUE の単点 lookup
		expect(await exportRepo.findByPin('000000')).toBe(undefined);

		// #2845 B1: tenant 不一致は affected 0 の no-op
		await exportRepo.incrementDownloadCount(rec?.id ?? '', OTHER_FAMILY);
		expect((await exportRepo.findByPin('111111'))?.downloadCount).toBe(0);
		await exportRepo.incrementDownloadCount(rec?.id ?? '', FAMILY);
		await exportRepo.incrementDownloadCount(rec?.id ?? '', FAMILY);
		expect((await exportRepo.findByPin('111111'))?.downloadCount).toBe(2);
	});

	it('[CE3] updateStatus state machine + findPendingBuilds + findStaleBuildingExports', async () => {
		const rec = await seedExport('333333');
		// pending → building: build_started_at が now() で記録される (#3509)
		await exportRepo.updateStatus(rec.id, FAMILY, 'building');
		const building = await exportRepo.findById(rec.id, FAMILY);
		expect(building?.status).toBe('building');
		expect(building?.buildStartedAt).not.toBe(null);

		// building → failed: failureReason 記録 + build_started_at は NULL に戻る
		await exportRepo.updateStatus(rec.id, FAMILY, 'failed', { failureReason: 'S3 error' });
		const failed = await exportRepo.findById(rec.id, FAMILY);
		expect(failed?.status).toBe('failed');
		expect(failed?.failureReason).toBe('S3 error');
		expect(failed?.buildStartedAt).toBe(null);

		// failed → ready: 成果物メタ確定 + failureReason 残渣クリア (常に上書き)
		await exportRepo.updateStatus(rec.id, FAMILY, 'ready', {
			fileSizeBytes: 2048,
			description: '全データ 2KB',
		});
		const ready = await exportRepo.findById(rec.id, FAMILY);
		expect(ready?.status).toBe('ready');
		expect(ready?.fileSizeBytes).toBe(2048);
		expect(ready?.description).toBe('全データ 2KB');
		expect(ready?.failureReason).toBe(null);

		// tenant 不一致 updateStatus は no-op
		await exportRepo.updateStatus(rec.id, OTHER_FAMILY, 'failed', { failureReason: 'evil' });
		expect((await exportRepo.findById(rec.id, FAMILY))?.status).toBe('ready');

		// findPendingBuilds: pending のみ createdAt asc (cross-tenant cron drain)
		const p1 = await seedExport('444444');
		await sleep(5);
		const p2 = await seedExport('555555', { tenantId: OTHER_FAMILY });
		const pending = await exportRepo.findPendingBuilds(100);
		const myPending = pending.filter((r) => [p1.id, p2.id, rec.id].includes(r.id));
		expect(myPending.map((r) => r.id)).toEqual([p1.id, p2.id]); // asc + ready は含まない + cross-tenant

		// findStaleBuildingExports: 閾値より古い building のみ (直 UPDATE で老化させる)
		await exportRepo.updateStatus(p1.id, FAMILY, 'building');
		expect((await exportRepo.findStaleBuildingExports(60_000)).map((r) => r.id)).toEqual([]);
		await t.db.execute(sql`
			UPDATE cloud_exports SET build_started_at = '2020-01-01T00:00:00Z'::timestamptz
			WHERE export_id = ${p1.id}
		`);
		const stale = await exportRepo.findStaleBuildingExports(60_000);
		expect(stale.map((r) => r.id)).toEqual([p1.id]);
	});

	it('[CE4] deleteExpired (行数) + deleteById + countByTenant', async () => {
		const expired = await seedExport('666666', { expiresAt: '2020-06-01T00:00:00.000Z' });
		const before = await exportRepo.countByTenant(FAMILY);
		// 本ファイルで expiresAt 過去の行はこの 1 件のみ (他は 2099 年)
		expect(await exportRepo.deleteExpired(new Date().toISOString())).toBe(1);
		expect(await exportRepo.findById(expired.id, FAMILY)).toBe(undefined);
		expect(await exportRepo.countByTenant(FAMILY)).toBe(before - 1);

		// deleteById は tenant 束縛
		const victim = await exportRepo.findByPin('111111');
		await exportRepo.deleteById(victim?.id ?? '', OTHER_FAMILY);
		expect(await exportRepo.findByPin('111111')).not.toBe(undefined);
		await exportRepo.deleteById(victim?.id ?? '', FAMILY);
		expect(await exportRepo.findByPin('111111')).toBe(undefined);
	});

	// ─────────────────── IImageRepo ───────────────────

	it('[IM1] insertCharacterImage + findCachedImage (type+hash 一致のみ) + §P9', async () => {
		const childId = await newChild('画像一郎');
		// #3566 ③: file_path は tenant プレフィックス配下必須 (§9.4 孤児バイト防止)。
		const filePath = `tenants/${FAMILY}/generated/${childId}/hash-1.png`;
		await imageRepo.insertCharacterImage(
			{ childId, type: 'avatar', filePath, promptHash: 'hash-1' },
			FAMILY,
		);
		const cached = await imageRepo.findCachedImage(childId, 'avatar', 'hash-1', FAMILY);
		expect(cached?.id).toMatch(UUID_RE);
		expect(cached?.childId).toBe(childId);
		expect(cached?.filePath).toBe(filePath);
		expect(cached?.promptHash).toBe('hash-1');
		expect(cached?.generatedAt).toBeTruthy();

		// type / hash 不一致はキャッシュ miss
		expect(await imageRepo.findCachedImage(childId, 'battle', 'hash-1', FAMILY)).toBe(undefined);
		expect(await imageRepo.findCachedImage(childId, 'avatar', 'hash-2', FAMILY)).toBe(undefined);
		// §P9
		expect(await imageRepo.findCachedImage(childId, 'avatar', 'hash-1', OTHER_FAMILY)).toBe(
			undefined,
		);
	});

	it('[IM2] updateChildAvatarUrl (tenant no-op) + findChildForImage (§P9)', async () => {
		const childId = await newChild('画像二郎');
		// 他 tenant を名乗った更新は no-op
		await imageRepo.updateChildAvatarUrl(childId, '/evil.png', OTHER_FAMILY);
		expect((await imageRepo.findChildForImage(childId, FAMILY))?.avatarUrl).toBe(null);

		await imageRepo.updateChildAvatarUrl(childId, '/avatars/two.png', FAMILY);
		const child = await imageRepo.findChildForImage(childId, FAMILY);
		expect(child?.nickname).toBe('画像二郎');
		expect(child?.avatarUrl).toBe('/avatars/two.png');
		// null 戻しも可能
		await imageRepo.updateChildAvatarUrl(childId, null, FAMILY);
		expect((await imageRepo.findChildForImage(childId, FAMILY))?.avatarUrl).toBe(null);
		// §P9
		expect(await imageRepo.findChildForImage(childId, OTHER_FAMILY)).toBe(undefined);
	});

	// #4466: 仮アバターの作り直しは「いま仮アバターのままか」を読んでから書くまでに await が
	// 挟まる。無条件 UPDATE だと、その窓で完了した写真アップロードの URL を踏み潰す (lost update)。
	// 期待値を WHERE に載せ、負けた側が 0 行更新になることを実 Postgres (PGlite) で固定する。
	it('[IM5] #4466 updateChildAvatarUrlIfMatches は期待値一致時のみ書く (lost update 防止)', async () => {
		const childId = await newChild('画像三郎');
		const placeholder = '/tenants/x/avatars/placeholder.svg?v=1';
		const photo = '/tenants/x/avatars/9f1c2d3e.webp';

		// avatar_url 未設定 (null) を期待 → 書ける。`= NULL` は常に UNKNOWN なので
		// null 一致が効かないと未設定の子供が永久に更新できなくなる。
		expect(await imageRepo.updateChildAvatarUrlIfMatches(childId, null, placeholder, FAMILY)).toBe(
			true,
		);
		expect((await imageRepo.findChildForImage(childId, FAMILY))?.avatarUrl).toBe(placeholder);

		// 割り込み: 保護者が写真をアップロードした (無条件 UPDATE 経路)
		await imageRepo.updateChildAvatarUrl(childId, photo, FAMILY);

		// 読んだ時点の値 (placeholder) を期待した書き込みは負ける = 写真が残る
		expect(
			await imageRepo.updateChildAvatarUrlIfMatches(childId, placeholder, '/new.svg', FAMILY),
		).toBe(false);
		expect((await imageRepo.findChildForImage(childId, FAMILY))?.avatarUrl).toBe(photo);

		// §P9: 他 tenant を名乗った条件付き更新も no-op (false)
		expect(
			await imageRepo.updateChildAvatarUrlIfMatches(childId, photo, '/evil.png', OTHER_FAMILY),
		).toBe(false);
		expect((await imageRepo.findChildForImage(childId, FAMILY))?.avatarUrl).toBe(photo);

		// null 戻しも条件付きで可能
		expect(await imageRepo.updateChildAvatarUrlIfMatches(childId, photo, null, FAMILY)).toBe(true);
		expect((await imageRepo.findChildForImage(childId, FAMILY))?.avatarUrl).toBe(null);
	});

	it('[IM4] #3566 ③ (§9.4): filePath が tenant プレフィックス配下でなければ insert 拒否 (孤児バイト防止)', async () => {
		const childId = await newChild('画像四郎');
		const countImages = async (): Promise<number> => {
			const r = await t.db.execute(
				sql`SELECT count(*) AS c FROM character_images WHERE family_id = ${FAMILY}`,
			);
			return Number((r.rows[0] as { c: unknown }).c);
		};
		const before = await countImages();
		// (a) tenant 配下の key は許容 (正規の generatedImageKey 相当)
		await imageRepo.insertCharacterImage(
			{ childId, type: 'avatar', filePath: `tenants/${FAMILY}/generated/ok.png`, promptHash: 'h4' },
			FAMILY,
		);
		// (b) prefix 外 key は拒否 (account 削除 deleteByPrefix で消えない孤児バイトになるため)
		await expect(
			imageRepo.insertCharacterImage(
				{ childId, type: 'avatar', filePath: 'images/loose.png', promptHash: 'h4b' },
				FAMILY,
			),
		).rejects.toThrow();
		// (c) cross-tenant key は拒否 (他 family のバイトを A の DB 行が参照する越境 = IDOR/LFI)
		await expect(
			imageRepo.insertCharacterImage(
				{
					childId,
					type: 'avatar',
					filePath: `tenants/${OTHER_FAMILY}/generated/steal.png`,
					promptHash: 'h4c',
				},
				FAMILY,
			),
		).rejects.toThrow();
		// (d) path traversal を含む key は prefix 一致でも拒否
		await expect(
			imageRepo.insertCharacterImage(
				{ childId, type: 'avatar', filePath: `tenants/${FAMILY}/../x.png`, promptHash: 'h4d' },
				FAMILY,
			),
		).rejects.toThrow();
		// 拒否ケースでは 1 行のみ (a のみ) 追加され、b/c/d は書かれていない
		expect(await countImages()).toBe(before + 1);
	});

	it('[IM3] deleteByTenantId: §P9 tenant 限定 (他 tenant 無傷)', async () => {
		const mine = await newChild('画像三郎');
		const other = await newChild('他家三郎', OTHER_FAMILY);
		await imageRepo.insertCharacterImage(
			{
				childId: mine,
				type: 'avatar',
				filePath: `tenants/${FAMILY}/generated/m.png`,
				promptHash: 'hm',
			},
			FAMILY,
		);
		await imageRepo.insertCharacterImage(
			{
				childId: other,
				type: 'avatar',
				filePath: `tenants/${OTHER_FAMILY}/generated/o.png`,
				promptHash: 'ho',
			},
			OTHER_FAMILY,
		);
		await imageRepo.deleteByTenantId(FAMILY);
		expect(await imageRepo.findCachedImage(mine, 'avatar', 'hm', FAMILY)).toBe(undefined);
		expect(await imageRepo.findCachedImage(other, 'avatar', 'ho', OTHER_FAMILY)).not.toBe(
			undefined,
		);
	});
});
