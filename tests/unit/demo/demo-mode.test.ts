// tests/unit/demo/demo-mode.test.ts
// ADR-0048 Phase B-1 / Issue #2097: demo Lambda 判定の単体テスト
//
// 目的:
// - `isDemoLambda(authMode)`: AUTH_MODE=anonymous 単独で isDemo=true となるか
// - 既存 `resolveDemoActive()` legacy 3 経路 (query / cookie / `/demo/*`) との
//   OR 合流が壊れていないか (NUC local モード等の backward compat)

import { describe, expect, it } from 'vitest';
import {
	DEMO_WRITE_ALLOWLIST,
	isDemoLambda,
	isDemoWriteAllowed,
	resolveDemoActive,
} from '../../../src/lib/server/demo/demo-mode';

describe('isDemoLambda (ADR-0048 Phase B-1 / #2097)', () => {
	it('AUTH_MODE=anonymous → demo Lambda として判定 (Pattern A 中核)', () => {
		// AC1: demo.ganbari-quest.com の素の /admin アクセス (cookie/query/path なし) でも
		// AUTH_MODE=anonymous なら isDemo=true になることを保証する。
		expect(isDemoLambda('anonymous')).toBe(true);
	});

	it('AUTH_MODE=cognito → demo Lambda ではない (production)', () => {
		// AC2: 本番 ganbari-quest.com (cognito) は当然 demo 扱いしない。
		expect(isDemoLambda('cognito')).toBe(false);
	});

	it('AUTH_MODE=local → demo Lambda ではない (NUC local モード)', () => {
		// AC3 関連: NUC local 運用環境では isDemoLambda() は false を返し、
		// resolveDemoActive() の cookie (gq_demo=1) 経路が backward compat で機能する。
		expect(isDemoLambda('local')).toBe(false);
	});

	it('AUTH_MODE undefined → demo Lambda ではない', () => {
		// 想定外の値や未設定でも false にフォールバックすることを保証 (デフォルト = local 扱い)。
		expect(isDemoLambda(undefined)).toBe(false);
	});

	it('AUTH_MODE が想定外の文字列 → demo Lambda ではない', () => {
		expect(isDemoLambda('foo')).toBe(false);
		expect(isDemoLambda('')).toBe(false);
	});
});

describe('resolveDemoActive (legacy 3 経路) + isDemoLambda OR 合流 (#2097)', () => {
	it('legacy cookie 経路は単独で isDemo=true (NUC local + gq_demo=1)', () => {
		// AC3: AUTH_MODE=local かつ gq_demo cookie がセットされている場合、
		// legacy resolveDemoActive() 単独で isDemo=true となる (Pattern A 後も維持)。
		const result = resolveDemoActive(null, '1', '/admin');
		expect(result.isDemo).toBe(true);
	});

	it('legacy query 経路: ?mode=demo → isDemo=true', () => {
		// 入口クエリは依然有効 (NUC local の検証 URL 等で使用)。
		const result = resolveDemoActive('demo', undefined, '/admin');
		expect(result.isDemo).toBe(true);
		expect(result.fromQuery).toBe(true);
	});

	it('legacy path 経路: /demo/* → isDemo=true (Phase 1 backward compat)', () => {
		const result = resolveDemoActive(null, undefined, '/demo/admin');
		expect(result.isDemo).toBe(true);
		expect(result.fromLegacyPath).toBe(true);
	});

	it('legacy 3 経路すべて未設定 → isDemo=false (= demo Lambda 外の通常 production)', () => {
		// この場合 hooks.server.ts は `demoActive || isDemoLambda(env.AUTH_MODE)` で
		// fallback して最終 isDemo を決める。
		const result = resolveDemoActive(null, undefined, '/admin');
		expect(result.isDemo).toBe(false);
	});

	it('hooks.server.ts OR 合流ロジックの再現: legacy=false かつ AUTH_MODE=anonymous → true', () => {
		// hooks.server.ts の `event.locals.isDemo = demoActive || isDemoLambda(env.AUTH_MODE)`
		// を最小再現。実 hooks 統合テスト (hooks-integration.test.ts) で詳細パス確認するが、
		// 合流式の真偽値が意図通りであることをここで unit レベル保証。
		const legacy = resolveDemoActive(null, undefined, '/admin');
		const finalIsDemo = legacy.isDemo || isDemoLambda('anonymous');
		expect(finalIsDemo).toBe(true);
	});

	it('hooks.server.ts OR 合流ロジックの再現: legacy=false かつ AUTH_MODE=cognito → false', () => {
		const legacy = resolveDemoActive(null, undefined, '/admin');
		const finalIsDemo = legacy.isDemo || isDemoLambda('cognito');
		expect(finalIsDemo).toBe(false);
	});

	it('hooks.server.ts OR 合流ロジックの再現: legacy=true (cookie) かつ AUTH_MODE=local → true', () => {
		// NUC local の cookie 経路は維持されることを再確認。
		const legacy = resolveDemoActive(null, '1', '/admin');
		const finalIsDemo = legacy.isDemo || isDemoLambda('local');
		expect(finalIsDemo).toBe(true);
	});
});

describe('DEMO_WRITE_ALLOWLIST (#2097 Phase B Bug 4: /switch 子供選択の no-op 例外)', () => {
	it('/switch を含む (子供切替 form action `?/select` の redirect を no-op しないため)', () => {
		// Bug 4 根本原因: demo Lambda 上で /switch?/select POST が
		// `shouldReturnDemoNoop` で `{ ok:true, demo:true }` を返してしまい、
		// SvelteKit form action が成功と認識せず redirect 303 が発火しないため
		// 子供クリックが効かない。/switch を allowlist に追加することで本番ルートを
		// 通常駆動 (cookie set + redirect) させる。実 DB write は無いので demo 安全。
		expect(DEMO_WRITE_ALLOWLIST).toContain('/switch');
	});

	it('isDemoWriteAllowed("/switch") === true (POST /switch?/select 含む前方一致)', () => {
		expect(isDemoWriteAllowed('/switch')).toBe(true);
		// form action POST のパスは `/switch?/select` だが、SvelteKit hooks では
		// `event.url.pathname` (= `/switch`) で前方一致する。
		expect(isDemoWriteAllowed('/switch?/select')).toBe(true);
	});

	it('既存 allowlist (/api/feedback / /api/demo-analytics / /api/demo/exit / /api/health / /demo/) が維持されている', () => {
		// /switch 追加で既存 backward compat を壊していないことを保証する。
		expect(DEMO_WRITE_ALLOWLIST).toContain('/api/feedback');
		expect(DEMO_WRITE_ALLOWLIST).toContain('/api/demo-analytics');
		expect(DEMO_WRITE_ALLOWLIST).toContain('/api/demo/exit');
		expect(DEMO_WRITE_ALLOWLIST).toContain('/api/health');
		expect(DEMO_WRITE_ALLOWLIST).toContain('/demo/');
	});

	it('allowlist 外パス (例: /admin/activities) は isDemoWriteAllowed=false (no-op 対象維持)', () => {
		expect(isDemoWriteAllowed('/admin/activities')).toBe(false);
		expect(isDemoWriteAllowed('/api/v1/children')).toBe(false);
	});
});
