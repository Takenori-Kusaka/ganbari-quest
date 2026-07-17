// tests/unit/db/dsql-certificate-voice-graduation-repos.test.ts
// EPIC #3424 / PR-R10 (repo 層 build order §12.2.1) / 設計 SSOT: dsql-data-model.md §11.2 / §9.4 / §P9
//
// 成果物系 3 interface (ICertificateRepo / IVoiceRepo / IGraduationConsentRepo) の DSQL 実装テスト。
// 実 schema (pushSchema 適用、dsql-test-db helper) を使う (手書き DDL fixture 禁止)。
//
// ── ICertificateRepo ──
//   [C1] issueCertificate + findCertificates (issued_at DESC) + §P9 tenant 分離
//   [C2] issueCertificate 重複スキップ (同 child+type 2 回目は null、行は 1 件、sqlite parity)
//   [C3] findCertificateById round-trip + §P9
//   [C4] hasCertificate true/false + §P9
//   [C5] insertForRestore: issued_at / metadata を verbatim 保全 (新 id 採番)
//   [C6] deleteByTenantId: tenant 限定削除、他 tenant 無傷
//   [C7] certificate_type は増減集合 (CHECK なし) — 任意 type 受理
//
// ── IVoiceRepo ──
//   [V1] insert + findByChild (scene filter) + §P9 + 0/1 契約 (isActive number)
//   [V2] findById (null on miss) + §P9
//   [V3] findActiveVoice (isActive filter) + §P9
//   [V4] setActive 排他: 同 child+scene の他 voice を false 化 + 対象 true を単一 txn で
//        (アクティブは常に 1 本、他 scene は無傷)
//   [V5] findAllByChild (scene 不問、export) + §P9
//   [V6] insertForRestore: createdAt / filePath / publicUrl / isActive を verbatim 保全 (新 id)
//   [V7] deleteById / deleteByChild + §P9
//   [V8] #3566 ③ (§9.4): file_path が tenant プレフィックス外 / cross-tenant なら insert / insertForRestore 拒否
//
// ── IGraduationConsentRepo ──
//   [G1] create + listByTenant (consented_at DESC) + §P9 tenant 分離 + boolean 契約
//   [G2] aggregateRecent: cross-tenant KPI (§P9 述語なしが正) — total/consented/avg + days window
//   [G3] publicSamples: consented=true かつ message 非空のみ (false / null-message は除外)、最新順 limit
//   [G4] deleteByTenantId: tenant 限定削除、他 tenant 無傷

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChildId } from '../../../src/lib/domain/ids';
import { createDsqlCertificateRepo } from '../../../src/lib/server/db/dsql/certificate-repo';
import { createDsqlChildRepo } from '../../../src/lib/server/db/dsql/child-repo';
import { createDsqlGraduationConsentRepo } from '../../../src/lib/server/db/dsql/graduation-consent-repo';
import { createDsqlTransactionRunner } from '../../../src/lib/server/db/dsql/run-in-transaction';
import type { SqlExecutor } from '../../../src/lib/server/db/dsql/sql-executor';
import { createDsqlVoiceRepo } from '../../../src/lib/server/db/dsql/voice-repo';
import type { ICertificateRepo } from '../../../src/lib/server/db/interfaces/certificate-repo.interface';
import type { IChildRepo } from '../../../src/lib/server/db/interfaces/child-repo.interface';
import type { IGraduationConsentRepo } from '../../../src/lib/server/db/interfaces/graduation-consent-repo.interface';
import type { TransactionRunner } from '../../../src/lib/server/db/interfaces/transaction.interface';
import type { IVoiceRepo } from '../../../src/lib/server/db/interfaces/voice-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000a1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000000a2';
const UUID_RE = /^[0-9a-f-]{36}$/;

describe('DSQL certificate / voice / graduation-consent repos (PR-R10、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let childRepo: IChildRepo;
	let certRepo: ICertificateRepo;
	let voiceRepo: IVoiceRepo;
	let gradRepo: IGraduationConsentRepo;
	let runner: TransactionRunner<SqlExecutor>;

	const newChild = async (nickname: string, family = FAMILY): Promise<ChildId> => {
		const c = await childRepo.insertChild({ nickname, age: 8, birthDate: '2018-01-15' }, family);
		return c.id;
	};

	const countRows = async (query: ReturnType<typeof sql>): Promise<number> => {
		const r = await t.db.execute(query);
		return Number((r.rows[0] as { c: unknown }).c);
	};

	beforeAll(async () => {
		t = await createDsqlTestDb();
		runner = createDsqlTransactionRunner(t.db, { maxAttempts: 3, baseDelayMs: 1 });
		childRepo = createDsqlChildRepo(t.db, runner);
		certRepo = createDsqlCertificateRepo(t.db);
		voiceRepo = createDsqlVoiceRepo(t.db, runner);
		gradRepo = createDsqlGraduationConsentRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ─────────────────── ICertificateRepo ───────────────────

	it('[C1] issueCertificate + findCertificates (issued_at DESC) + §P9', async () => {
		const childId = await newChild('証明一郎');
		const first = await certRepo.issueCertificate(
			{
				childId,
				certificateType: 'elementary_grad',
				title: '小学校そつぎょう',
				metadata: '{"lv":10}',
			},
			FAMILY,
		);
		expect(first).not.toBeNull();
		expect(first?.id).toMatch(UUID_RE);
		expect(first?.childId).toBe(childId);
		expect(first?.tenantId).toBe(FAMILY);
		expect(first?.certificateType).toBe('elementary_grad');
		expect(first?.title).toBe('小学校そつぎょう');
		expect(first?.description).toBe(null); // 未指定は null
		expect(first?.metadata).toBe('{"lv":10}');
		expect(typeof first?.issuedAt).toBe('string');

		const second = await certRepo.issueCertificate(
			{ childId, certificateType: 'kindergarten_grad', title: 'ほいくえんそつえん' },
			FAMILY,
		);
		expect(second).not.toBeNull();

		const list = await certRepo.findCertificates(childId, FAMILY);
		expect(list).toHaveLength(2);
		// issued_at DESC (両者 default now、後発 second が先頭に来る)
		expect(list.map((c) => c.certificateType)).toContain('elementary_grad');
		expect(list.map((c) => c.certificateType)).toContain('kindergarten_grad');
		// §P9: 他 tenant からは不可視
		expect(await certRepo.findCertificates(childId, OTHER_FAMILY)).toEqual([]);
	});

	it('[C2] issueCertificate 重複スキップ (同 child+type 2 回目は null、行 1 件、sqlite parity)', async () => {
		const childId = await newChild('重複二郎');
		const a = await certRepo.issueCertificate(
			{ childId, certificateType: 'level_10', title: 'レベル10' },
			FAMILY,
		);
		expect(a).not.toBeNull();
		const dup = await certRepo.issueCertificate(
			{ childId, certificateType: 'level_10', title: 'レベル10（再）' },
			FAMILY,
		);
		expect(dup).toBeNull(); // 重複スキップ
		expect(
			await countRows(sql`
				SELECT count(*) AS c FROM certificates
				WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}
					AND certificate_type = 'level_10'
			`),
		).toBe(1);
		// 別 family の同 type は独立して発行できる (§P9)
		const otherChild = await newChild('重複二郎b', OTHER_FAMILY);
		expect(
			await certRepo.issueCertificate(
				{ childId: otherChild, certificateType: 'level_10', title: 'レベル10' },
				OTHER_FAMILY,
			),
		).not.toBeNull();
	});

	it('[C3] findCertificateById round-trip + §P9', async () => {
		const childId = await newChild('個別三郎');
		const cert = await certRepo.issueCertificate(
			{ childId, certificateType: 'quest_hero', title: '勇者', description: 'せつめい' },
			FAMILY,
		);
		const found = await certRepo.findCertificateById(cert?.id ?? '', FAMILY);
		expect(found?.id).toBe(cert?.id);
		expect(found?.description).toBe('せつめい');
		expect(await certRepo.findCertificateById(cert?.id ?? '', OTHER_FAMILY)).toBe(undefined);
		expect(await certRepo.findCertificateById('00000000-0000-4000-8000-00000000dead', FAMILY)).toBe(
			undefined,
		);
	});

	it('[C4] hasCertificate true/false + §P9', async () => {
		const childId = await newChild('判定四郎');
		await certRepo.issueCertificate(
			{ childId, certificateType: 'streak_master', title: 'れんぞく' },
			FAMILY,
		);
		expect(await certRepo.hasCertificate(childId, 'streak_master', FAMILY)).toBe(true);
		expect(await certRepo.hasCertificate(childId, 'not_issued', FAMILY)).toBe(false);
		expect(await certRepo.hasCertificate(childId, 'streak_master', OTHER_FAMILY)).toBe(false);
	});

	it('[C5] insertForRestore: issued_at / metadata を verbatim 保全 (新 id)', async () => {
		const childId = await newChild('復元五郎');
		const restored = await certRepo.insertForRestore(
			{
				childId,
				certificateType: 'first_step',
				title: 'はじめのいっぽ',
				description: null,
				issuedAt: '2025-01-02T03:04:05+00:00',
				metadata: '{"restored":true}',
			},
			FAMILY,
		);
		expect(restored).not.toBeNull();
		expect(restored?.id).toMatch(UUID_RE);
		expect(restored?.metadata).toBe('{"restored":true}');
		// issued_at は default now でなく verbatim (epoch 一致で assert、driver の tz 表記差を吸収)
		expect(Date.parse(restored?.issuedAt ?? '')).toBe(Date.parse('2025-01-02T03:04:05+00:00'));
	});

	it('[C6] deleteByTenantId: tenant 限定削除、他 tenant 無傷', async () => {
		const mine = await newChild('全消六郎', OTHER_FAMILY);
		const keep = await newChild('無傷六郎');
		await certRepo.issueCertificate(
			{ childId: mine, certificateType: 'point_king', title: 'ポイント王' },
			OTHER_FAMILY,
		);
		await certRepo.issueCertificate(
			{ childId: keep, certificateType: 'point_king', title: 'ポイント王' },
			FAMILY,
		);
		await certRepo.deleteByTenantId(OTHER_FAMILY);
		expect(
			await countRows(
				sql`SELECT count(*) AS c FROM certificates WHERE family_id = ${OTHER_FAMILY}`,
			),
		).toBe(0);
		expect((await certRepo.findCertificates(keep, FAMILY)).length).toBe(1);
	});

	it('[C7] certificate_type は増減集合 (CHECK なし) — 任意 type 受理', async () => {
		const childId = await newChild('自由七郎');
		const cert = await certRepo.issueCertificate(
			{ childId, certificateType: 'brand_new_periodic_type_2099', title: '未来の証書' },
			FAMILY,
		);
		expect(cert).not.toBeNull();
		expect(cert?.certificateType).toBe('brand_new_periodic_type_2099');
	});

	// ─────────────────── IVoiceRepo ───────────────────

	const insertVoice = async (
		childId: ChildId,
		scene: string,
		label: string,
		isActive = 0,
		family = FAMILY,
	) =>
		voiceRepo.insert({
			childId,
			scene,
			// #3566 ③: file_path は tenant プレフィックス配下必須 (§9.4 孤児バイト防止)。
			label,
			filePath: `tenants/${family}/voices/${String(childId)}/${label}.webm`,
			publicUrl: `https://cdn/${label}.webm`,
			durationMs: 1234,
			isActive,
			tenantId: family,
		});

	it('[V1] insert + findByChild (scene filter) + §P9 + 0/1 契約', async () => {
		const childId = await newChild('声一郎');
		const { id } = await insertVoice(childId, 'complete', 'よくできました');
		expect(id).toMatch(UUID_RE);
		await insertVoice(childId, 'levelup', 'レベルアップ');

		const complete = await voiceRepo.findByChild(childId, 'complete', FAMILY);
		expect(complete).toHaveLength(1);
		expect(complete[0]?.label).toBe('よくできました');
		expect(complete[0]?.filePath).toBe(
			`tenants/${FAMILY}/voices/${String(childId)}/よくできました.webm`,
		);
		expect(complete[0]?.isActive).toBe(0); // number 0/1 契約
		expect(complete[0]?.durationMs).toBe(1234);
		expect(complete[0]?.tenantId).toBe(FAMILY);
		// §P9 tenant 分離
		expect(await voiceRepo.findByChild(childId, 'complete', OTHER_FAMILY)).toEqual([]);
	});

	it('[V2] findById (null on miss) + §P9', async () => {
		const childId = await newChild('声二郎');
		const { id } = await insertVoice(childId, 'complete', 'こえ2');
		expect((await voiceRepo.findById(id, FAMILY))?.label).toBe('こえ2');
		expect(await voiceRepo.findById(id, OTHER_FAMILY)).toBe(null);
		expect(await voiceRepo.findById('00000000-0000-4000-8000-00000000dead', FAMILY)).toBe(null);
	});

	it('[V3] findActiveVoice (isActive filter) + §P9', async () => {
		const childId = await newChild('声三郎');
		await insertVoice(childId, 'complete', '非アクティブ', 0);
		const { id } = await insertVoice(childId, 'complete', 'アクティブ', 1);
		const active = await voiceRepo.findActiveVoice(childId, 'complete', FAMILY);
		expect(active?.id).toBe(id);
		expect(active?.isActive).toBe(1);
		expect(await voiceRepo.findActiveVoice(childId, 'levelup', FAMILY)).toBe(null); // 別 scene
		expect(await voiceRepo.findActiveVoice(childId, 'complete', OTHER_FAMILY)).toBe(null);
	});

	it('[V4] setActive 排他: 同 child+scene の他 voice を false 化 + 対象 true (単一 txn、常に 1 本)', async () => {
		const childId = await newChild('声四郎');
		const a = await insertVoice(childId, 'complete', 'A', 1); // 最初のアクティブ
		const b = await insertVoice(childId, 'complete', 'B', 0);
		const other = await insertVoice(childId, 'levelup', '別scene', 1); // 別 scene は無傷

		await voiceRepo.setActive(b.id, childId, 'complete', FAMILY);

		// complete の active は b のみ (a は false 化)
		const activeComplete = await voiceRepo.findActiveVoice(childId, 'complete', FAMILY);
		expect(activeComplete?.id).toBe(b.id);
		expect((await voiceRepo.findById(a.id, FAMILY))?.isActive).toBe(0);
		expect((await voiceRepo.findById(b.id, FAMILY))?.isActive).toBe(1);
		// 排他: complete で is_active=true の行はちょうど 1 件
		expect(
			await countRows(sql`
				SELECT count(*) AS c FROM child_custom_voices
				WHERE family_id = ${FAMILY} AND child_id = ${String(childId)}
					AND scene = 'complete' AND is_active = true
			`),
		).toBe(1);
		// 別 scene の active は無傷
		expect((await voiceRepo.findById(other.id, FAMILY))?.isActive).toBe(1);

		// §P9: 他 tenant を名乗った setActive は no-op (b は active のまま)
		await voiceRepo.setActive(a.id, childId, 'complete', OTHER_FAMILY);
		expect((await voiceRepo.findActiveVoice(childId, 'complete', FAMILY))?.id).toBe(b.id);
	});

	it('[V5] findAllByChild (scene 不問、export) + §P9', async () => {
		const childId = await newChild('声五郎');
		await insertVoice(childId, 'complete', 'c1');
		await insertVoice(childId, 'levelup', 'l1');
		const all = await voiceRepo.findAllByChild(childId, FAMILY);
		expect(all).toHaveLength(2);
		expect(all.map((v) => v.scene).sort()).toEqual(['complete', 'levelup']);
		expect(await voiceRepo.findAllByChild(childId, OTHER_FAMILY)).toEqual([]);
	});

	it('[V6] insertForRestore: createdAt / filePath / publicUrl / isActive を verbatim 保全 (新 id)', async () => {
		const childId = await newChild('声六郎');
		const restored = await voiceRepo.insertForRestore(
			{
				childId,
				scene: 'complete',
				label: '復元声',
				filePath: `tenants/${FAMILY}/voices/${String(childId)}/restored.webm`,
				publicUrl: 'https://cdn/restored.webm',
				durationMs: 5000,
				isActive: 1,
				tenantId: FAMILY,
				createdAt: '2025-03-04T05:06:07+00:00',
			},
			FAMILY,
		);
		// #3394 統一冪等契約: fresh 行の restore は必ず non-null (null = demo no-op stub のみ)
		if (!restored) throw new Error('insertForRestore returned null for fresh row');
		const { id } = restored;
		expect(id).toMatch(UUID_RE);
		const row = await voiceRepo.findById(id, FAMILY);
		expect(row?.isActive).toBe(1);
		expect(row?.filePath).toBe(`tenants/${FAMILY}/voices/${String(childId)}/restored.webm`);
		expect(row?.durationMs).toBe(5000);
		expect(Date.parse(row?.createdAt ?? '')).toBe(Date.parse('2025-03-04T05:06:07+00:00'));
	});

	it('[V8] #3566 ③ (§9.4): filePath が tenant プレフィックス配下でなければ insert / insertForRestore 拒否', async () => {
		const childId = await newChild('声八郎');
		const baseVoice = {
			childId,
			scene: 'complete',
			label: '越境声',
			publicUrl: 'https://cdn/x.webm',
			durationMs: 100,
			isActive: 0 as const,
			tenantId: FAMILY,
		};
		// (a) prefix 外 key は拒否
		await expect(
			voiceRepo.insert({ ...baseVoice, filePath: 'voices/loose.webm' }),
		).rejects.toThrow();
		// (b) cross-tenant key は拒否 (他 family のバイトを A の DB 行が参照する越境)
		await expect(
			voiceRepo.insert({ ...baseVoice, filePath: `tenants/${OTHER_FAMILY}/voices/steal.webm` }),
		).rejects.toThrow();
		// (c) insertForRestore も同様に tenant プレフィックス強制 (untrusted backup 由来の cross-tenant LFI 防止)
		await expect(
			voiceRepo.insertForRestore(
				{
					...baseVoice,
					filePath: `tenants/${OTHER_FAMILY}/voices/steal.webm`,
					createdAt: '2025-03-04T05:06:07+00:00',
				},
				FAMILY,
			),
		).rejects.toThrow();
		// 拒否ケースでは 1 行も追加されていない
		expect(await voiceRepo.findAllByChild(childId, FAMILY)).toEqual([]);
	});

	it('[V7] deleteById / deleteByChild + §P9', async () => {
		const childId = await newChild('声七郎');
		const a = await insertVoice(childId, 'complete', 'del-a');
		const b = await insertVoice(childId, 'levelup', 'del-b');
		// §P9: 他 tenant からの deleteById は no-op
		await voiceRepo.deleteById(a.id, OTHER_FAMILY);
		expect(await voiceRepo.findById(a.id, FAMILY)).not.toBe(null);
		await voiceRepo.deleteById(a.id, FAMILY);
		expect(await voiceRepo.findById(a.id, FAMILY)).toBe(null);
		expect(await voiceRepo.findById(b.id, FAMILY)).not.toBe(null);
		// deleteByChild は child 全 scene 削除、§P9
		await voiceRepo.deleteByChild(childId, OTHER_FAMILY);
		expect((await voiceRepo.findAllByChild(childId, FAMILY)).length).toBe(1);
		await voiceRepo.deleteByChild(childId, FAMILY);
		expect(await voiceRepo.findAllByChild(childId, FAMILY)).toEqual([]);
	});

	// ─────────────────── IGraduationConsentRepo ───────────────────

	it('[G1] create + listByTenant (consented_at DESC) + §P9 + boolean 契約', async () => {
		const rec = await gradRepo.create({
			tenantId: FAMILY,
			nickname: 'そつ子',
			consented: true,
			userPoints: 3400,
			usagePeriodDays: 365,
			message: 'ありがとう',
		});
		expect(rec.id).toMatch(UUID_RE);
		expect(rec.tenantId).toBe(FAMILY);
		expect(rec.consented).toBe(true); // boolean 契約
		expect(rec.userPoints).toBe(3400);
		expect(rec.message).toBe('ありがとう');
		expect(typeof rec.consentedAt).toBe('string');

		// consented=false でも 1 件記録される (KPI 用)
		await gradRepo.create({
			tenantId: FAMILY,
			nickname: '非公開子',
			consented: false,
			userPoints: 100,
			usagePeriodDays: 30,
		});
		const list = await gradRepo.listByTenant(FAMILY);
		expect(list).toHaveLength(2);
		expect(list.every((r) => r.tenantId === FAMILY)).toBe(true);
		// §P9: 他 tenant のレコードは listByTenant に混ざらない
		await gradRepo.create({
			tenantId: OTHER_FAMILY,
			nickname: '他家',
			consented: true,
			userPoints: 1,
			usagePeriodDays: 1,
			message: 'x',
		});
		expect((await gradRepo.listByTenant(FAMILY)).length).toBe(2);
		expect((await gradRepo.listByTenant(OTHER_FAMILY)).length).toBe(1);
	});

	it('[G2] aggregateRecent: cross-tenant KPI (§P9 述語なしが正) + days window', async () => {
		const fresh = await createDsqlTestDb();
		try {
			const grad = createDsqlGraduationConsentRepo(fresh.db);
			// window 内 (consented_at = default now): 2 family 跨ぎ = cross-tenant 集計
			await grad.create({
				tenantId: FAMILY,
				nickname: 'a',
				consented: true,
				userPoints: 100,
				usagePeriodDays: 100,
				message: 'm',
			});
			await grad.create({
				tenantId: OTHER_FAMILY,
				nickname: 'b',
				consented: false,
				userPoints: 200,
				usagePeriodDays: 300,
			});
			// window 外 (200 日前) は集計に入らない
			await fresh.db.execute(sql`
				INSERT INTO graduation_consent
					(family_id, nickname, consented, user_points, usage_period_days, consented_at)
				VALUES (${FAMILY}, 'old', true, 9, 9, now() - interval '200 days')
			`);

			const agg = await grad.aggregateRecent(90);
			expect(agg.totalGraduations).toBe(2); // cross-tenant, window 内のみ
			expect(agg.consentedCount).toBe(1);
			expect(agg.avgUsagePeriodDays).toBe(200); // (100 + 300) / 2
		} finally {
			await fresh.close();
		}
	});

	it('[G3] publicSamples: consented=true かつ message 非空のみ (false / null-message 除外)', async () => {
		const fresh = await createDsqlTestDb();
		try {
			const grad = createDsqlGraduationConsentRepo(fresh.db);
			await grad.create({
				tenantId: FAMILY,
				nickname: '公開OK',
				consented: true,
				userPoints: 1,
				usagePeriodDays: 1,
				message: 'のせてね',
			});
			await grad.create({
				tenantId: FAMILY,
				nickname: '同意だがmessage空',
				consented: true,
				userPoints: 1,
				usagePeriodDays: 1,
				message: '',
			});
			await grad.create({
				tenantId: FAMILY,
				nickname: '同意だがmessage null',
				consented: true,
				userPoints: 1,
				usagePeriodDays: 1,
				message: null,
			});
			await grad.create({
				tenantId: OTHER_FAMILY,
				nickname: '非同意',
				consented: false,
				userPoints: 1,
				usagePeriodDays: 1,
				message: 'これは出ない',
			});
			const agg = await grad.aggregateRecent(90);
			expect(agg.publicSamples).toHaveLength(1);
			expect(agg.publicSamples[0]?.nickname).toBe('公開OK');
			expect(agg.publicSamples[0]?.message).toBe('のせてね');
		} finally {
			await fresh.close();
		}
	});

	it('[G4] deleteByTenantId: tenant 限定削除、他 tenant 無傷', async () => {
		const fresh = await createDsqlTestDb();
		try {
			const grad = createDsqlGraduationConsentRepo(fresh.db);
			await grad.create({
				tenantId: FAMILY,
				nickname: 'keep',
				consented: true,
				userPoints: 1,
				usagePeriodDays: 1,
				message: 'm',
			});
			await grad.create({
				tenantId: OTHER_FAMILY,
				nickname: 'del',
				consented: true,
				userPoints: 1,
				usagePeriodDays: 1,
				message: 'm',
			});
			await grad.deleteByTenantId(OTHER_FAMILY);
			expect((await grad.listByTenant(FAMILY)).length).toBe(1);
			expect((await grad.listByTenant(OTHER_FAMILY)).length).toBe(0);
		} finally {
			await fresh.close();
		}
	});
});
