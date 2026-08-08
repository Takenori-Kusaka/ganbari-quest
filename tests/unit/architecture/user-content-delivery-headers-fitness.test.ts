// tests/unit/architecture/user-content-delivery-headers-fitness.test.ts
// #3827 (EPIC #3408 slice A / ADR-0061): user-content 配信不変条件の fitness function 化。
//
// 不変条件 (14-セキュリティ設計書 §7.2 「user-content 配信不変条件」):
//   ① user-content (avatar / import 由来ファイル等) は常に Lambda (SvelteKit endpoint) 経由配信。
//   ② その配信レスポンスは `X-Content-Type-Options: nosniff` (全レスポンス共通、hooks.server.ts の
//      単一強制点) + `Content-Disposition` (経路ごとに付与) を必ず持つ。ラスタ画像のみ inline、
//      SVG / audio / 不明 type は attachment (#3105 stored-XSS 封殺)。
//   ③ S3 直配信 behavior を足す場合は object metadata で `Content-Disposition` を強制する
//      (現状は Lambda 経由のみ。直配信 route が増える時に本 fitness の no-silent-gap で気づける)。
//
// root class (#3112 構造リスク 3): 「user-content が常に Lambda 経由 + Content-Disposition が付く」
// が人の注意依存で、新 user-content 配信 route 追加時に silent に破れる。ADR-0061 の
// same-class→guard / no-silent-gap に従い機械表明する。route-db-boundary / schema-range-ssot と
// 同型の Architecture Fitness Function (Building Evolutionary Architecture / Neal Ford 他)。
// 新規ツール導入ゼロ (既存 vitest + node fs + createMockEvent behavioral probe)。
//
// 本テストの表明:
//   (A) 経路レベル behavioral probe (failing-test-first): user-content 配信 route (avatar / tenants) を
//       実 GET handler で呼び、`Content-Disposition` が必ず付く + SVG→attachment / raster→inline を
//       確認する。route から `Content-Disposition` を外すと (A) が red になる (= guard 実効性)。
//   (B) 全レスポンス nosniff: hooks.server.ts の単一強制点が `X-Content-Type-Options: nosniff` を
//       付与している。強制点を外すと (B) が red になる。
//   (C) no-silent-gap: storage の `readFile()` でバイトを配信する全 +server.ts が「user-content 配信」
//       か「own-data download (ユーザー自身の生成物、固定 attachment)」のいずれかに分類済である。
//       新規に readFile 配信 route を足して未分類なら red (silent skip 禁止、
//       admin-resource-model-registry の NON_CANONICAL 方式 / schema-range-ssot の分類方式と同型)。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

import { createMockEvent } from '../../helpers/mock-event';

// storage / child-service を mock (behavioral probe は配信ヘッダの検証が目的で、実 storage / DB は不要)。
vi.mock('$lib/server/storage', () => ({ readFile: vi.fn() }));
vi.mock('$lib/server/services/child-service', () => ({ getChildById: vi.fn() }));

import { getChildById } from '$lib/server/services/child-service';
import { readFile } from '$lib/server/storage';
import { GET as tenantsGET } from '../../../src/routes/tenants/[...path]/+server';
import { GET as avatarsGET } from '../../../src/routes/uploads/avatars/[filename]/+server';

const readFileMock = vi.mocked(readFile);
const getChildByIdMock = vi.mocked(getChildById);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROUTES_DIR = resolve(REPO_ROOT, 'src/routes');
const HOOKS_FILE = resolve(REPO_ROOT, 'src/hooks.server.ts');

const rel = (abs: string) => relative(REPO_ROOT, abs).replace(/\\/g, '/');

// ── SSOT registry (no-silent-gap の分類、#3827 AC3) ───────────────────────────
//
// user-content 配信 route = user がアップロード / ZIP import 復元した「attacker が content-type を
// 左右し得る」バイトを、stored content-type から導出した Content-Type で配信する route。#3105 の
// stored-XSS 防御対象。これらは safeContentDisposition() 経由で SVG / 不明 type を attachment 配信する。
const USER_CONTENT_DELIVERY_ROUTES = [
	'src/routes/uploads/avatars/[filename]/+server.ts',
	'src/routes/tenants/[...path]/+server.ts',
] as const;

// own-data download = ユーザー自身が生成したバックアップ (JSON / ZIP) を配信する route。
// content-type は attacker-controllable ではなく (サーバー生成の application/zip 等)、常に
// `Content-Disposition: attachment` の固定配信のため stored-XSS の inline 実行経路にならない。
// user-content (avatar / import 由来) とは性質が異なるため別バケットで明示分類する (silent skip 禁止)。
const OWN_DATA_DOWNLOAD_ROUTES: Record<string, string> = {
	'src/routes/api/v1/export/cloud/[id]/download/+server.ts':
		'ユーザー自身が生成したバックアップ ZIP を固定 attachment で配信 (attacker-controllable content-type ではない、#3504)',
};

// ── readFile 配信 route の discovery (no-silent-gap の走査対象、#3827 AC3) ──────
// storage の `readFile()` を呼んでバイトを返す +server.ts を FS 走査で列挙する。新規に readFile 配信
// route を足したら本走査に必ず載り、registry / allowlist に分類しない限り (C) が red になる。
const READFILE_CALL = /\breadFile\s*\(/;

function walkServerFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			walkServerFiles(full, acc);
		} else if (entry.name === '+server.ts') {
			acc.push(full);
		}
	}
	return acc;
}

function findReadFileServingRoutes(): string[] {
	return walkServerFiles(ROUTES_DIR, [])
		.filter((f) => READFILE_CALL.test(readFileSync(f, 'utf-8')))
		.map(rel)
		.sort();
}

/** 配信レスポンスが Content-Disposition (+ Content-Type) を必ず持つことを表明する behavioral 検証。 */
function expectDeliveredWithDisposition(res: Response, expected: 'inline' | 'attachment') {
	expect(res.status).toBe(200);
	const disposition = res.headers.get('Content-Disposition');
	// failing-test-first の核: route から Content-Disposition を外すと null になり必ず red。
	expect(
		disposition,
		'user-content 配信レスポンスは Content-Disposition 必須 (#3105/#3827、safeContentDisposition 経由)',
	).not.toBeNull();
	expect(disposition).toBe(expected);
	expect(
		res.headers.get('Content-Type'),
		'Content-Type は safeContentType 経由で必須',
	).not.toBeNull();
}

/**
 * 認証済 user-content 配信の Cache-Control 不変条件 (#4415 follow-up)。
 *
 * `public` は共有キャッシュ (CloudFront / 企業 proxy 等) に「誰にでも配ってよい」と伝える
 * ディレクティブであり、認証・tenant 一致を通してから返す子供の顔写真に付けてはならない。
 * ブラウザ private cache は `private` でも効くため体感速度は落ちない。
 */
function expectPrivateCacheControl(res: Response, opts: { immutable: boolean }) {
	const cacheControl = res.headers.get('Cache-Control');
	expect(cacheControl, 'user-content 配信レスポンスは Cache-Control 必須').not.toBeNull();
	// failing-test-first の核: `public` に戻すと必ず red。
	expect(
		cacheControl,
		'認証済 user-content (子供の顔写真等) を共有キャッシュに配らせない (public 禁止、#4415 follow-up)',
	).not.toMatch(/\bpublic\b/);
	expect(cacheControl).toMatch(/\bprivate\b/);
	if (opts.immutable) {
		// uuid / content-hash 入りキー = URL と内容が 1:1。長期 immutable が正しい。
		expect(cacheControl).toMatch(/\bimmutable\b/);
	} else {
		// 固定名キー (placeholder.svg) は同じ URL の中身が差し替わる。1 年 immutable だと
		// ニックネーム / テーマ変更後も古い画像が出続けるため長期 immutable を付けない。
		expect(
			cacheControl,
			'固定名キーに immutable を付けない (更新が cache に殺される、#4415 follow-up)',
		).not.toMatch(/\bimmutable\b/);
		const maxAge = Number(/max-age=(\d+)/.exec(cacheControl ?? '')?.[1] ?? '-1');
		expect(maxAge).toBeGreaterThanOrEqual(0);
		expect(maxAge, '固定名キーの max-age は短命 (1 時間以下)').toBeLessThanOrEqual(3600);
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	// 既定は raster 画像 (png) を配信する正常 Child (avatarUrl が要求 filename を指す)。
	readFileMock.mockResolvedValue({ data: Buffer.from([1, 2, 3]), contentType: 'image/png' });
	getChildByIdMock.mockResolvedValue({
		id: '1',
		tenantId: 't-self',
		avatarUrl: '/uploads/avatars/avatar-1-abc.png',
		// biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 Child スタブ
	} as any);
});

describe('#3827 user-content 配信不変条件 fitness (EPIC #3408 slice A / ADR-0061)', () => {
	// ── (A) 経路レベル behavioral probe (AC2) ────────────────────────────────
	describe('(A) user-content 配信 route は Content-Disposition を必ず付与し SVG を attachment 化する', () => {
		it('/uploads/avatars/[filename]: raster(png) は inline 配信 + Content-Disposition あり', async () => {
			const event = createMockEvent({
				url: '/uploads/avatars/avatar-1-abc.png',
				params: { filename: 'avatar-1-abc.png' },
				context: { tenantId: 't-self', role: 'parent' },
			});
			expectDeliveredWithDisposition((await avatarsGET(event)) as Response, 'inline');
		});

		it('/uploads/avatars/[filename]: SVG は attachment 配信 (stored-XSS 封殺、#3105)', async () => {
			readFileMock.mockResolvedValue({
				data: Buffer.from('<svg/>'),
				contentType: 'image/svg+xml',
			});
			getChildByIdMock.mockResolvedValue({
				id: '1',
				tenantId: 't-self',
				avatarUrl: '/uploads/avatars/avatar-1-abc.svg',
				// biome-ignore lint/suspicious/noExplicitAny: テスト用の最小 Child スタブ
			} as any);
			const event = createMockEvent({
				url: '/uploads/avatars/avatar-1-abc.svg',
				params: { filename: 'avatar-1-abc.svg' },
				context: { tenantId: 't-self', role: 'parent' },
			});
			expectDeliveredWithDisposition((await avatarsGET(event)) as Response, 'attachment');
		});

		it('/tenants/[...path]: raster(png) は inline 配信 + Content-Disposition あり', async () => {
			const event = createMockEvent({
				url: '/tenants/t-self/avatars/1/x.png',
				params: { path: 't-self/avatars/1/x.png' },
				context: { tenantId: 't-self', role: 'child' },
			});
			expectDeliveredWithDisposition((await tenantsGET(event)) as Response, 'inline');
		});

		it('/tenants/[...path]: SVG は attachment 配信 (stored-XSS 封殺、#3105)', async () => {
			readFileMock.mockResolvedValue({
				data: Buffer.from('<svg/>'),
				contentType: 'image/svg+xml',
			});
			const event = createMockEvent({
				url: '/tenants/t-self/generated/1/x.svg',
				params: { path: 't-self/generated/1/x.svg' },
				context: { tenantId: 't-self', role: 'child' },
			});
			expectDeliveredWithDisposition((await tenantsGET(event)) as Response, 'attachment');
		});

		it('/tenants/[...path]: 不明 type も attachment (whitelist 外は octet-stream + attachment)', async () => {
			readFileMock.mockResolvedValue({
				data: Buffer.from('%PDF-1.4'),
				contentType: 'application/pdf',
			});
			const event = createMockEvent({
				url: '/tenants/t-self/generated/1/x.pdf',
				params: { path: 't-self/generated/1/x.pdf' },
				context: { tenantId: 't-self', role: 'child' },
			});
			const res = (await tenantsGET(event)) as Response;
			expectDeliveredWithDisposition(res, 'attachment');
			// safeContentType の whitelist 外は octet-stream に落とす (MIME スニッフィング前提を潰す)。
			expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
		});

		it('guard 非トートロジー証明: Content-Disposition 無しの Response は本検証で必ず fail する', () => {
			// route が Content-Disposition を落とした場合を模擬。expectDeliveredWithDisposition が
			// これを検出できることを示す (= 検証が vacuous でない)。
			const noDisposition = new Response(new Uint8Array([1]), {
				headers: { 'Content-Type': 'image/png' },
			});
			expect(() => expectDeliveredWithDisposition(noDisposition, 'inline')).toThrow();
		});
	});

	// ── (A2) 認証済 user-content の Cache-Control (#4415 follow-up) ──────────
	describe('(A2) user-content 配信レスポンスは共有キャッシュに配らせない (private)', () => {
		it('/tenants/[...path]: uuid 入りアバターキーは private + immutable', async () => {
			const event = createMockEvent({
				url: '/tenants/t-self/avatars/1/3f2b0c8e-0000-4000-8000-000000000000.png',
				params: { path: 't-self/avatars/1/3f2b0c8e-0000-4000-8000-000000000000.png' },
				context: { tenantId: 't-self', role: 'child' },
			});
			expectPrivateCacheControl((await tenantsGET(event)) as Response, { immutable: true });
		});

		it('/tenants/[...path]: 固定名の仮アバター (placeholder.svg) は private + 短命 (immutable なし)', async () => {
			readFileMock.mockResolvedValue({
				data: Buffer.from('<svg/>'),
				contentType: 'image/svg+xml',
			});
			const event = createMockEvent({
				url: '/tenants/t-self/avatars/1/placeholder.svg',
				params: { path: 't-self/avatars/1/placeholder.svg' },
				context: { tenantId: 't-self', role: 'child' },
			});
			expectPrivateCacheControl((await tenantsGET(event)) as Response, { immutable: false });
		});

		it('/uploads/avatars/[filename]: legacy flat アバターも private + immutable', async () => {
			const event = createMockEvent({
				url: '/uploads/avatars/avatar-1-abc.png',
				params: { filename: 'avatar-1-abc.png' },
				context: { tenantId: 't-self', role: 'parent' },
			});
			expectPrivateCacheControl((await avatarsGET(event)) as Response, { immutable: true });
		});

		it('guard 非トートロジー証明: public な Cache-Control は本検証で必ず fail する', () => {
			const publicCached = new Response(new Uint8Array([1]), {
				headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
			});
			expect(() => expectPrivateCacheControl(publicCached, { immutable: true })).toThrow();
		});
	});

	// ── (B) 全レスポンス nosniff の単一強制点 (AC2) ──────────────────────────
	describe('(B) hooks.server.ts が全レスポンスに X-Content-Type-Options: nosniff を付与する', () => {
		const hooksSource = readFileSync(HOOKS_FILE, 'utf-8');

		it('nosniff 強制点が存在する (外すと red = MIME スニッフィング防御の喪失)', () => {
			// 全レスポンス共通の単一強制点。user-content 配信 route はこれに依存して nosniff を得る
			// (各 route での重複付与は不要)。この 1 行を消すと本テストが red になる。
			expect(
				/response\.headers\.set\(\s*['"]X-Content-Type-Options['"]\s*,\s*['"]nosniff['"]\s*\)/.test(
					hooksSource,
				),
				'hooks.server.ts の全レスポンス強制点で nosniff を付与すること (14-セキュリティ設計書 §7.1)',
			).toBe(true);
		});

		it('nosniff は単一 SSOT (強制点は 1 箇所)', () => {
			const count = (hooksSource.match(/['"]X-Content-Type-Options['"]/g) ?? []).length;
			expect(count, 'nosniff の付与点は hooks.server.ts の 1 箇所に集約する (散在させない)').toBe(
				1,
			);
		});
	});

	// ── (C) no-silent-gap (AC3) ──────────────────────────────────────────────
	describe('(C) readFile 配信の全 +server.ts が user-content / own-data に分類済', () => {
		const servingRoutes = findReadFileServingRoutes();
		const classified = new Set<string>([
			...USER_CONTENT_DELIVERY_ROUTES,
			...Object.keys(OWN_DATA_DOWNLOAD_ROUTES),
		]);

		it('storage.readFile() 配信 route を FS 走査できている (sanity)', () => {
			expect(servingRoutes.length).toBeGreaterThan(0);
		});

		it('readFile 配信の全 route が registry / allowlist に分類済 (未分類 = fail)', () => {
			const unclassified = servingRoutes.filter((f) => !classified.has(f));
			expect(
				unclassified,
				`未分類の readFile 配信 route:\n${unclassified.map((f) => `  - ${f}`).join('\n')}\n` +
					'→ user-content (attacker-controllable content-type、safeContentDisposition 経由) なら ' +
					'USER_CONTENT_DELIVERY_ROUTES へ追加し (A) の behavioral probe 対象にする。' +
					'ユーザー自身の生成物 (固定 attachment) なら OWN_DATA_DOWNLOAD_ROUTES に理由付きで pin する (#3827 AC3)',
			).toEqual([]);
		});

		it('registry / allowlist は stale でない (実在 route と一致、= 空振り走査を許さない)', () => {
			const servingSet = new Set(servingRoutes);
			const stale = [...classified].filter((f) => !servingSet.has(f));
			expect(
				stale,
				`実在しない / readFile 配信でない分類エントリ (削除してください):\n${stale
					.map((f) => `  - ${f}`)
					.join('\n')}`,
			).toEqual([]);
		});

		it('user-content 配信 route が safeContentDisposition() を経由する (集約点の実効性)', () => {
			for (const route of USER_CONTENT_DELIVERY_ROUTES) {
				const src = readFileSync(resolve(REPO_ROOT, route), 'utf-8');
				expect(
					src.includes('safeContentDisposition'),
					`${route} は file-sanitizer.ts の safeContentDisposition() 経由で配信すること (#3105 集約点)`,
				).toBe(true);
			}
		});

		it('own-data download route は Content-Disposition: attachment を固定付与する', () => {
			for (const route of Object.keys(OWN_DATA_DOWNLOAD_ROUTES)) {
				const src = readFileSync(resolve(REPO_ROOT, route), 'utf-8');
				expect(
					/content-disposition['"]\s*:\s*[`'"]attachment/i.test(src),
					`${route} はバックアップを attachment で配信すること (inline 化しない)`,
				).toBe(true);
			}
		});
	});
});
