// tests/unit/architecture/cloudfront-s3-user-content-bypass-fitness.test.ts
// #3830 (EPIC #3408 slice D / ADR-0061): user-content の CloudFront/S3 直配信 bypass を機械検知する
// fitness function。
//
// 不変条件 (14-セキュリティ設計書 §7.2.1 / 13-AWS設計書 §3.5「user-content 配信不変条件」):
//   ① user-content (avatar / ZIP import 由来ファイル等) は常に Lambda (SvelteKit endpoint) 経由配信。
//      CloudFront の user-content 経路 (`/tenants/*` / `/uploads/*`) は専用 behavior を持たず default
//      behavior (= Lambda Function URL origin) に fall-through する。
//   ② S3 直配信 behavior を足す場合は object metadata で `Content-Disposition` (+ content-type) を
//      強制する (現状は Lambda 経由のみ = S3 直配信 behavior は error pages / immutable 静的アセットに限定)。
//
// root class (#3112 構造リスク 3): 「user-content が CloudFront/S3 から Lambda ヘッダを bypass して
// 直配信され得る」構造リスクが CDK 定義側で人の注意依存になっている。slice A の fitness
// (`user-content-delivery-headers-fitness.test.ts`) は **route / handler 層** の Content-Disposition を
// 表明するが、CloudFront が S3 を user-content 経路に直結する変更は route を一切通らないため
// slice A では検知できない。本 fitness は **CDK (network-stack.ts) の CloudFront behavior 定義** を
// 静的走査し、S3 origin を持つ behavior を allowlist (error pages / immutable 静的アセット) に分類済で
// あること + user-content 経路が S3 origin / 専用 behavior を持たないことを表明する。
// route-db-boundary / schema-range-ssot / slice A user-content fitness と同型の Architecture Fitness
// Function (Building Evolutionary Architecture / Neal Ford 他)。新規ツール導入ゼロ (既存 vitest + fs)。
//
// 本テストの表明:
//   (A) no-silent-gap: 実 stack で S3 origin を持つ全 behavior の path pattern が
//       STATIC_ASSET_S3_BEHAVIORS (allowlist) に分類済。新規に S3 直配信 behavior を足して未分類なら red。
//   (B) allowlist が stale でない (実在の S3-served path と一致)。
//   (C) 構造ガード: S3 origin を持つ behavior の path pattern が user-content prefix
//       (`/tenants` / `/uploads`) に一致しない (= allowlist へ user-content を紛れ込ませても検知)。
//   (D) user-content prefix にマッチする CloudFront behavior が 1 つも存在しない
//       (= user-content は専用 behavior を持たず default = Lambda に fall-through する)。
//   (E) default behavior の origin が Lambda (HttpOrigin) であり S3 ではない。
//   (F) `new cloudfront.Distribution` は network-stack.ts のみ (別 stack に CloudFront を足したら
//       本 fitness が走査対象から漏れるため red = fitness 拡張を強制する no-silent-gap)。
//   (G) failing-test-first / 非トートロジー証明: user-content を S3 直配信する合成 source を detector が
//       必ず flag する (guard が vacuous でない)。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test (実行時間が入力サイズに比例する)。既定 5s のままだと unit lane の
// 並列実行の負荷で落ち、「本物の回帰か負荷か」の切り分けが毎回発生するため file 単位で明示する。
// 区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT (未宣言 / timeout 欠落は CI が fail)。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const INFRA_LIB_DIR = resolve(REPO_ROOT, 'infra/lib');
const NETWORK_STACK = resolve(INFRA_LIB_DIR, 'network-stack.ts');

// ── SSOT registry (S3 origin を許可する behavior の allowlist、#3830 AC3) ─────────
//
// これらは user-content ではない静的コンテンツ配信であり、S3 origin を持つことが設計上正当:
//   - `/error/*`     : Lambda 障害時でも配信する S3 エラーページ (OAC 経由、13-AWS §3.5)。
//   - `/_app/immutable/*`: SvelteKit の content-hash 付き immutable 静的アセット (#3087 解決策 B、
//                          deploy 済 image から抽出した同一 build artifact を S3 に upload)。
// user-content (avatar / import 由来) は attacker が content-type を左右し得るため本 allowlist に
// 入れてはならない (入れても (C) が red になる)。
const STATIC_ASSET_S3_BEHAVIORS: Record<string, string> = {
	'/error/*':
		'S3 エラーページ (Lambda 障害時 fallback、OAC 経由、13-AWS §3.5)。user-content ではない',
	'/_app/immutable/*':
		'SvelteKit content-hash 付き immutable 静的アセット (#3087 解決策 B、build artifact、attacker-controllable ではない)',
};

// user-content 配信 route の path prefix (14-セキュリティ設計書 §5.2.1 / §7.2.1)。
// これらの経路は CloudFront で専用 behavior / S3 origin を持たず、default behavior (= Lambda) に
// fall-through して認証・tenant 一致・Content-Disposition 付与を通す。
const USER_CONTENT_PATH_PREFIXES = ['/tenants', '/uploads'] as const;

// ── detector (CDK source の CloudFront behavior 静的走査、純関数) ────────────────

/** `<var> = origins.S3*Origin...` で生成される S3 origin 変数名の集合を抽出する。 */
function findS3OriginVars(source: string): Set<string> {
	// `const s3ErrorOrigin = origins.S3BucketOrigin.withOriginAccessControl(...)` /
	// `prodImmutableS3Origin = origins.S3BucketOrigin...` (let 分離宣言後の再代入) の両方に一致。
	const vars = new Set<string>();
	for (const m of source.matchAll(/(\w+)\s*=\s*origins\.S3\w*Origin\b/g)) {
		if (m[1]) vars.add(m[1]);
	}
	return vars;
}

/** origin: 直前の最寄り behavior anchor (path pattern 文字列 or defaultBehavior) を返す。 */
function nearestBehaviorAnchor(source: string, beforeIndex: number): string | null {
	const region = source.slice(0, beforeIndex);
	// 最寄りの path pattern 文字列リテラル (`'/error/*'` / `['/_app/immutable/*']` の key 等)。
	const pathMatches = [...region.matchAll(/['"](\/[^'"\s]*)['"]/g)];
	const last = pathMatches.at(-1);
	const lastPath = last?.[1] ?? null;
	const lastPathIdx = last ? (last.index ?? -1) : -1;
	const defIdx = region.lastIndexOf('defaultBehavior');
	// defaultBehavior が path 文字列より origin に近ければ default 扱い (= allowlist 外 = red)。
	if (defIdx > lastPathIdx) return '<defaultBehavior>';
	return lastPath;
}

/**
 * source 内の CloudFront behavior のうち origin が S3 origin であるものの path pattern を列挙する。
 * `origin: <s3Var>` を全走査し、最寄りの behavior anchor を対応付ける。
 */
function extractS3ServedBehaviorPaths(source: string): string[] {
	const s3Vars = findS3OriginVars(source);
	const paths: string[] = [];
	for (const m of source.matchAll(/\borigin:\s*(\w+)/g)) {
		const originVar = m[1];
		if (!originVar || !s3Vars.has(originVar)) continue;
		const anchor = nearestBehaviorAnchor(source, m.index ?? 0);
		if (anchor) paths.push(anchor);
	}
	return [...new Set(paths)].sort();
}

/** source 内の default behavior の origin 変数名を返す (`defaultBehavior: { origin: <var>` の一致)。 */
function extractDefaultBehaviorOrigins(source: string): string[] {
	const origins: string[] = [];
	for (const m of source.matchAll(/defaultBehavior:\s*\{\s*origin:\s*(\w+)/g)) {
		if (m[1]) origins.push(m[1]);
	}
	return origins;
}

/** source 内の全 CloudFront behavior key (path pattern 文字列) を列挙する。 */
function extractAllBehaviorPathPatterns(source: string): string[] {
	const paths = new Set<string>();
	// additionalBehaviors 代入: `xxxAdditionalBehaviors['/_app/*'] = {`
	for (const m of source.matchAll(/Behaviors\[\s*['"](\/[^'"\s]*)['"]\s*\]\s*=/g)) {
		if (m[1]) paths.add(m[1]);
	}
	// object literal key: `'/error/*': {`
	for (const m of source.matchAll(/['"](\/[^'"\s]*)['"]\s*:\s*\{/g)) {
		if (m[1]) paths.add(m[1]);
	}
	return [...paths].sort();
}

function matchesUserContentPrefix(pathPattern: string): boolean {
	const base = pathPattern.replace(/\/\*$/, '').replace(/\/$/, '');
	return USER_CONTENT_PATH_PREFIXES.some(
		(prefix) => base === prefix || base.startsWith(`${prefix}/`),
	);
}

// ── 実 stack source ─────────────────────────────────────────────────────────
const networkSource = readFileSync(NETWORK_STACK, 'utf-8');
const s3ServedPaths = extractS3ServedBehaviorPaths(networkSource);

describe('#3830 CloudFront/S3 user-content 直配信 bypass fitness (EPIC #3408 slice D / ADR-0061)', () => {
	// ── sanity: detector が実 stack の S3 behavior を走査できている ────────────
	it('detector が S3 origin 変数を抽出できる (sanity)', () => {
		const s3Vars = findS3OriginVars(networkSource);
		// s3ErrorOrigin (error pages) + prod/demo immutable (#3087) の 3 変数。
		expect(s3Vars.size).toBeGreaterThanOrEqual(1);
		expect(s3Vars.has('s3ErrorOrigin')).toBe(true);
	});

	it('detector が S3-served path を検出できている (sanity、空振り走査を許さない)', () => {
		expect(s3ServedPaths.length).toBeGreaterThan(0);
	});

	// ── (A) no-silent-gap: 全 S3-served behavior が allowlist に分類済 ──────────
	it('(A) S3 origin を持つ全 behavior が allowlist に分類済 (未分類 = red)', () => {
		const allowed = new Set(Object.keys(STATIC_ASSET_S3_BEHAVIORS));
		const unclassified = s3ServedPaths.filter((p) => !allowed.has(p));
		expect(
			unclassified,
			`未分類の S3 直配信 behavior:\n${unclassified.map((p) => `  - ${p}`).join('\n')}\n` +
				'→ user-content 経路 (avatar / import 由来) を S3 直配信してはならない (Lambda ヘッダ bypass)。' +
				'静的アセット (error pages / immutable) なら STATIC_ASSET_S3_BEHAVIORS へ理由付きで分類する。' +
				'user-content を S3 直配信する必要がある場合は object metadata で Content-Disposition + ' +
				'content-type を強制する (14-セキュリティ設計書 §7.2.1 不変条件③ / 13-AWS設計書 §3.5、#3830 AC3)',
		).toEqual([]);
	});

	// ── (B) allowlist が stale でない ────────────────────────────────────────
	it('(B) allowlist が stale でない (実在の S3-served path と一致)', () => {
		const servedSet = new Set(s3ServedPaths);
		const stale = Object.keys(STATIC_ASSET_S3_BEHAVIORS).filter((p) => !servedSet.has(p));
		expect(
			stale,
			`実在しない S3-served behavior 分類エントリ (削除してください):\n${stale
				.map((p) => `  - ${p}`)
				.join('\n')}`,
		).toEqual([]);
	});

	// ── (C) 構造ガード: S3-served path が user-content prefix でない ───────────
	it('(C) S3 origin を持つ behavior の path pattern が user-content prefix に一致しない', () => {
		const violating = s3ServedPaths.filter(matchesUserContentPrefix);
		expect(
			violating,
			`user-content prefix を S3 直配信している behavior:\n${violating
				.map((p) => `  - ${p}`)
				.join('\n')}\n` +
				'→ user-content は attacker-controllable な content-type を持つため S3 直配信で Lambda の ' +
				'Content-Disposition / nosniff を bypass させてはならない (#3105 stored-XSS 封殺の bypass、#3830 AC3)',
		).toEqual([]);
	});

	// ── (D) user-content prefix にマッチする behavior が存在しない ────────────
	it('(D) user-content prefix にマッチする CloudFront behavior が存在しない (default = Lambda に fall-through)', () => {
		const allPaths = extractAllBehaviorPathPatterns(networkSource);
		const userContentBehaviors = allPaths.filter(matchesUserContentPrefix);
		expect(
			userContentBehaviors,
			`user-content 経路の専用 CloudFront behavior:\n${userContentBehaviors
				.map((p) => `  - ${p}`)
				.join('\n')}\n` +
				'→ user-content (`/tenants/*` / `/uploads/*`) は専用 behavior を持たず default behavior ' +
				'(= Lambda Function URL origin) に fall-through して認証・tenant 一致・Content-Disposition を ' +
				'通す必要がある (14-セキュリティ設計書 §7.2.1 不変条件①、#3830 AC3)',
		).toEqual([]);
	});

	// ── (E) default behavior の origin が Lambda (HttpOrigin) ─────────────────
	it('(E) default behavior の origin が S3 origin ではない (Lambda 経由配信を保証)', () => {
		const s3Vars = findS3OriginVars(networkSource);
		const defaultOrigins = extractDefaultBehaviorOrigins(networkSource);
		// prod (CDN) + demo (DemoCDN) の 2 distribution。
		expect(defaultOrigins.length).toBeGreaterThanOrEqual(1);
		const s3Defaults = defaultOrigins.filter((v) => s3Vars.has(v));
		expect(
			s3Defaults,
			`default behavior が S3 origin を使用:\n${s3Defaults.map((v) => `  - ${v}`).join('\n')}\n` +
				'→ default behavior (user-content が fall-through する先) は Lambda Function URL origin で ' +
				'なければならない (#3830 AC3)',
		).toEqual([]);
	});

	// ── (F) new cloudfront.Distribution は network-stack.ts のみ ──────────────
	it('(F) new cloudfront.Distribution は network-stack.ts のみ (別 stack 追加で fitness 拡張を強制)', () => {
		const stacksWithDistribution = readdirSync(INFRA_LIB_DIR)
			.filter((f) => f.endsWith('.ts'))
			.filter((f) =>
				/new cloudfront\.Distribution\b/.test(readFileSync(resolve(INFRA_LIB_DIR, f), 'utf-8')),
			)
			.sort();
		expect(
			stacksWithDistribution,
			'new cloudfront.Distribution を network-stack.ts 以外で定義した場合、本 fitness の S3 直配信 ' +
				'走査が漏れる。新 CloudFront も走査対象にするため本テストを拡張すること (no-silent-gap)',
		).toEqual(['network-stack.ts']);
	});

	// ── (G) failing-test-first / 非トートロジー証明 ───────────────────────────
	describe('(G) detector 非トートロジー証明 (guard が vacuous でない)', () => {
		it('user-content を S3 直配信する合成 source を detector が flag する', () => {
			const malicious = `
				const userContentS3Origin = origins.S3BucketOrigin.withOriginAccessControl(userBucket);
				const prodAdditionalBehaviors = {};
				prodAdditionalBehaviors['/uploads/avatars/*'] = {
					origin: userContentS3Origin,
					viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
				};
			`;
			const paths = extractS3ServedBehaviorPaths(malicious);
			expect(paths).toContain('/uploads/avatars/*');
			// (A) の allowlist / (C) の user-content prefix 両方で検出されることを示す。
			const allowed = new Set(Object.keys(STATIC_ASSET_S3_BEHAVIORS));
			expect(paths.some((p) => !allowed.has(p))).toBe(true);
			expect(paths.some(matchesUserContentPrefix)).toBe(true);
		});

		it('/tenants を S3 直配信する合成 source も flag する', () => {
			const malicious = `
				const tenantS3 = origins.S3BucketOrigin.withOriginAccessControl(b);
				behaviors['/tenants/*'] = { origin: tenantS3 };
			`;
			const paths = extractS3ServedBehaviorPaths(malicious);
			expect(paths.some(matchesUserContentPrefix)).toBe(true);
		});

		it('static asset のみを S3 配信する合成 source は clean (誤検知しない)', () => {
			const benign = `
				const immutableS3 = origins.S3BucketOrigin.withOriginAccessControl(b);
				behaviors['/_app/immutable/*'] = { origin: immutableS3 };
			`;
			const paths = extractS3ServedBehaviorPaths(benign);
			expect(paths.every((p) => !matchesUserContentPrefix(p))).toBe(true);
			const allowed = new Set(Object.keys(STATIC_ASSET_S3_BEHAVIORS));
			expect(paths.every((p) => allowed.has(p))).toBe(true);
		});

		it('user-content prefix 判定が正しい (false positive/negative なし)', () => {
			expect(matchesUserContentPrefix('/tenants/*')).toBe(true);
			expect(matchesUserContentPrefix('/uploads/avatars/*')).toBe(true);
			expect(matchesUserContentPrefix('/uploads')).toBe(true);
			expect(matchesUserContentPrefix('/error/*')).toBe(false);
			expect(matchesUserContentPrefix('/_app/immutable/*')).toBe(false);
			expect(matchesUserContentPrefix('/_app/*')).toBe(false);
		});
	});
});
