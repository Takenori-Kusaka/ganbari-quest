// tests/unit/db/family-repo-lifecycle-3574.test.ts
// Issue #3574 (Family repo 実装担保、#3573 follow-up) / 設計 SSOT: dsql-data-model.md §11.2 / §P5 / §P9 / §3.4 B6
//
// #3573 で Family 系 8 表の DDL (global UNIQUE 含む) を凍結した際、Adversarial Reviewer が
// 指摘した「repo 実装で担保すべき下流責務」を failing-test-first (ADR-0061) で red→green にする。
//
// 本ファイルは DSQL backend (実 schema、PGlite) で 3 つの不変条件を担保する:
//
//   ① pin/token 再発行ライフサイクル (expire-then-purge)
//      cloud_exports.pin_code / viewer_tokens.token は expire/revoke 後の「値再利用」が前提だが
//      global UNIQUE のため、dead な旧行が値を占有したまま再発行すると UNIQUE 衝突で沈黙失敗する。
//      insert は「自 family の dead 行 (期限切れ / DL 上限 / revoke 済) を purge してから挿入」する
//      (§11.2)。live 行が占有していれば UNIQUE 衝突が surface する = 2 live 行防止は維持する。
//
//   ② global lookup 後の family scope 再適用 (§P9)
//      push_subscriptions.endpoint の無 tenant 値単独 lookup (findByEndpoint / deleteByEndpoint) は
//      request が endpoint (attacker 可制御) + 認証済 tenantId を渡すため、返却/削除は family_id で
//      再スコープする。再適用漏れは cross-family read/IDOR-delete 経路 (unsubscribe が body.endpoint を
//      そのまま渡すため実害あり)。cloud_exports.pin / viewer_tokens.token は credential 自体が
//      authz なので findByPin/findByToken は無 tenant のまま正、後続 mutation が返却 family_id を
//      使う (incrementDownloadCount/deleteById 等が tenantId 必須) ことで §P9 を満たす。
//
//   ④ graduation_consent の COPPA 同意証跡 tamper-evidence (append-only)
//      卒業同意は COPPA 対象の同意証跡。repo は create/list/aggregate/deleteByTenantId のみを持ち
//      UPDATE を一切定義しない (改竄不能)。同 tenant で複数回 create しても upsert でなく追記 (多数行が正)。
//      append-only 契約の機械強制は tests/unit/architecture/dsql-append-only-mutation-allowlist.test.ts。

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDsqlCloudExportRepo } from '../../../src/lib/server/db/dsql/cloud-export-repo';
import { createDsqlGraduationConsentRepo } from '../../../src/lib/server/db/dsql/graduation-consent-repo';
import { createDsqlPushSubscriptionRepo } from '../../../src/lib/server/db/dsql/push-subscription-repo';
import { createDsqlViewerTokenRepo } from '../../../src/lib/server/db/dsql/viewer-token-repo';
import type { ICloudExportRepo } from '../../../src/lib/server/db/interfaces/cloud-export-repo.interface';
import type { IGraduationConsentRepo } from '../../../src/lib/server/db/interfaces/graduation-consent-repo.interface';
import type { IPushSubscriptionRepo } from '../../../src/lib/server/db/interfaces/push-subscription-repo.interface';
import type { IViewerTokenRepo } from '../../../src/lib/server/db/interfaces/viewer-token-repo.interface';
import type { InsertCloudExportInput } from '../../../src/lib/server/db/types';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000005a1';
const OTHER_FAMILY = '00000000-0000-4000-8000-0000000005a2';
const PAST_ISO = '2020-01-01T00:00:00.000Z';
const FUTURE_ISO = '2099-01-01T00:00:00.000Z';

describe('Family repo 実装担保 (#3574、DSQL 実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let exportRepo: ICloudExportRepo;
	let tokenRepo: IViewerTokenRepo;
	let pushRepo: IPushSubscriptionRepo;
	let consentRepo: IGraduationConsentRepo;

	const seedExport = (
		pinCode: string,
		over: Partial<InsertCloudExportInput> = {},
	): Promise<Awaited<ReturnType<ICloudExportRepo['insert']>>> =>
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
		exportRepo = createDsqlCloudExportRepo(t.db);
		tokenRepo = createDsqlViewerTokenRepo(t.db);
		pushRepo = createDsqlPushSubscriptionRepo(t.db);
		consentRepo = createDsqlGraduationConsentRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	// ───────────────── ① cloud_exports pin 再発行ライフサイクル ─────────────────

	it('[CE-reissue] 期限切れ旧行を占有する pin を再発行できる (expire-then-purge)', async () => {
		// 旧行: 同 family / 同 pin だが既に期限切れ (dead)。
		const old = await seedExport('910001', { expiresAt: PAST_ISO });
		// 再発行: 同 pin を live 行として insert → 旧 dead 行を purge してから挿入され成功する。
		const fresh = await seedExport('910001', { expiresAt: FUTURE_ISO });
		expect(fresh.pinCode).toBe('910001');
		expect(fresh.id).not.toBe(old.id); // 新規行 (upsert でない)
		// global UNIQUE 維持: pin lookup は live 新行 1 件のみに解決する。
		const resolved = await exportRepo.findByPin('910001');
		expect(resolved?.id).toBe(fresh.id);
		expect(Date.parse(resolved?.expiresAt ?? '')).toBe(Date.parse(FUTURE_ISO));
		expect(await exportRepo.findById(old.id, FAMILY)).toBe(undefined); // 旧行は purge 済
	});

	it('[CE-reissue] DL 上限到達 (consumed) 旧行を占有する pin も再発行できる', async () => {
		const old = await seedExport('910002', { maxDownloads: 1 });
		await exportRepo.incrementDownloadCount(old.id, FAMILY); // downloadCount(1) >= maxDownloads(1) = dead
		const fresh = await seedExport('910002');
		expect(fresh.id).not.toBe(old.id);
		expect(await exportRepo.findById(old.id, FAMILY)).toBe(undefined);
	});

	it('[CE-reissue] live 行が占有する pin の再発行は UNIQUE 衝突で拒否 (2 live 行防止)', async () => {
		await seedExport('910003', { expiresAt: FUTURE_ISO }); // live
		// 同 family / 同 pin の 2 本目 live は purge 対象外 → UNIQUE 衝突 throw。
		await expect(seedExport('910003', { expiresAt: FUTURE_ISO })).rejects.toThrow();
	});

	it('[CE-reissue] 他 family の live 行が占有する pin も奪取不可 (cross-family 2 live 行防止)', async () => {
		await seedExport('910004', { tenantId: OTHER_FAMILY, expiresAt: FUTURE_ISO });
		// purge は自 family scope のため他 family の live 行に触れない → global UNIQUE 衝突 throw。
		await expect(seedExport('910004', { tenantId: FAMILY })).rejects.toThrow();
	});

	// ───────────────── ① viewer_tokens token 再発行ライフサイクル ─────────────────

	it('[VT-reissue] revoke 済旧行を占有する token を再発行できる', async () => {
		const old = await tokenRepo.insert({ token: 'tok-reissue' }, FAMILY);
		await tokenRepo.revoke(old.id, FAMILY); // revokedAt set = dead
		const fresh = await tokenRepo.insert({ token: 'tok-reissue' }, FAMILY);
		expect(fresh.id).not.toBe(old.id);
		expect(fresh.revokedAt).toBe(null);
		const resolved = await tokenRepo.findByToken('tok-reissue');
		expect(resolved?.id).toBe(fresh.id);
		expect(resolved?.revokedAt).toBe(null);
	});

	it('[VT-reissue] 期限切れ旧行を占有する token も再発行できる', async () => {
		const old = await tokenRepo.insert({ token: 'tok-expired', expiresAt: PAST_ISO }, FAMILY);
		const fresh = await tokenRepo.insert({ token: 'tok-expired', expiresAt: FUTURE_ISO }, FAMILY);
		expect(fresh.id).not.toBe(old.id);
	});

	it('[VT-reissue] live token の再発行は UNIQUE 衝突で拒否 (2 live 行防止)', async () => {
		await tokenRepo.insert({ token: 'tok-live', expiresAt: FUTURE_ISO }, FAMILY);
		await expect(
			tokenRepo.insert({ token: 'tok-live', expiresAt: FUTURE_ISO }, FAMILY),
		).rejects.toThrow();
	});

	// ───────────────── ② push_subscriptions global lookup の family 再スコープ ─────────────────

	it('[PS-scope] findByEndpoint は返却前に family scope を再適用する (§P9 cross-family read 遮断)', async () => {
		await pushRepo.insert({
			tenantId: FAMILY,
			endpoint: 'https://push.example/scoped-ep',
			keysP256dh: 'p256',
			keysAuth: 'auth',
			subscriberRole: 'parent',
		});
		// 所有 family は取得できる。
		expect(
			(await pushRepo.findByEndpoint('https://push.example/scoped-ep', FAMILY))?.tenantId,
		).toBe(FAMILY);
		// 他 family を名乗った lookup は endpoint (attacker 可制御) を渡しても解決不能 = cross-family 漏出遮断。
		expect(await pushRepo.findByEndpoint('https://push.example/scoped-ep', OTHER_FAMILY)).toBe(
			undefined,
		);
	});

	it('[PS-scope] deleteByEndpoint は family 不一致なら no-op (§P9 cross-family IDOR-delete 遮断)', async () => {
		await pushRepo.insert({
			tenantId: FAMILY,
			endpoint: 'https://push.example/del-ep',
			keysP256dh: 'p256',
			keysAuth: 'auth',
			subscriberRole: 'owner',
		});
		// 他 family を名乗った削除 (unsubscribe が body.endpoint をそのまま渡す経路) は no-op。
		await pushRepo.deleteByEndpoint('https://push.example/del-ep', OTHER_FAMILY);
		expect((await pushRepo.findByEndpoint('https://push.example/del-ep', FAMILY))?.tenantId).toBe(
			FAMILY,
		);
		// 所有 family からの削除は成功する。
		await pushRepo.deleteByEndpoint('https://push.example/del-ep', FAMILY);
		expect(await pushRepo.findByEndpoint('https://push.example/del-ep', FAMILY)).toBe(undefined);
	});

	// ───────────────── ④ graduation_consent COPPA tamper-evidence (append-only) ─────────────────

	it('[GC-append] 同 tenant で複数回 create しても追記される (upsert でなく多数行 = 改竄不能)', async () => {
		const before = (await consentRepo.listByTenant(FAMILY)).length;
		const a = await consentRepo.create({
			tenantId: FAMILY,
			nickname: 'そつぎょうA',
			consented: true,
			userPoints: 100,
			usagePeriodDays: 30,
			message: 'ありがとう',
		});
		const b = await consentRepo.create({
			tenantId: FAMILY,
			nickname: 'そつぎょうB',
			consented: false,
			userPoints: 200,
			usagePeriodDays: 60,
		});
		expect(a.id).not.toBe(b.id); // 別行 (surrogate PK)
		const after = await consentRepo.listByTenant(FAMILY);
		expect(after.length).toBe(before + 2); // 追記 (上書きでない)
		// 先の同意証跡 (a) は 2 本目 create で改変されない。
		const persistedA = after.find((r) => r.id === a.id);
		expect(persistedA?.consented).toBe(true);
		expect(persistedA?.userPoints).toBe(100);
	});

	it('[GC-append] repo は同意行を書き換える mutation メソッドを一切公開しない (改竄面の非露出)', () => {
		// interface 契約: create / listByTenant / aggregateRecent / deleteByTenantId のみ。
		// update / setConsent / patch 等の書き換え口が生えていないことを構造検証する
		// (append-only 表への UPDATE 経路自体が存在しない = tamper-evidence の第一防御)。
		const methodNames = Object.keys(consentRepo).sort();
		expect(methodNames).toEqual(['aggregateRecent', 'create', 'deleteByTenantId', 'listByTenant']);
	});
});
