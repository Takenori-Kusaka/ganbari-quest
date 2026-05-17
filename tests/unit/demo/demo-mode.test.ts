// tests/unit/demo/demo-mode.test.ts
// ADR-0048 PR-B4 / Issue #2189: demo 検出 env-only 単一化の単体テスト
//
// 目的:
// - `resolveDemoActive(env)`: env-only signature が AUTH_MODE × DATA_SOURCE matrix で
//   厳密 AND 判定されているか
// - `DEMO_WRITE_ALLOWLIST`: PR-B3 で /demo/** 撤去後の最小集合 (/api/feedback /
//   /api/demo-analytics / /api/health / /switch) が維持されているか
// - 旧 cookie/path/query signal 由来の API (DEMO_MODE_COOKIE / isDemoLambda) が
//   完全撤去されているか (import error で構造的に検出)

import { describe, expect, it } from 'vitest';
import type { TypedEnv } from '../../../src/lib/runtime/env';
import {
	DEMO_WRITE_ALLOWLIST,
	DEMO_WRITE_METHODS,
	isDemoWriteAllowed,
	resolveDemoActive,
} from '../../../src/lib/server/demo/demo-mode';

type DemoEnv = Pick<TypedEnv, 'AUTH_MODE' | 'DATA_SOURCE'>;

function makeEnv(authMode: DemoEnv['AUTH_MODE'], dataSource: DemoEnv['DATA_SOURCE']): DemoEnv {
	return { AUTH_MODE: authMode, DATA_SOURCE: dataSource };
}

describe('resolveDemoActive(env) — ADR-0048 PR-B4 / #2189 env-only signature', () => {
	it('AUTH_MODE=anonymous + DATA_SOURCE=demo → true (demo Lambda 中核)', () => {
		// AC1: demo.ganbari-quest.com の Lambda 環境 (Multi-Lambda demo deployment)。
		// 素の `/admin` アクセス (cookie/query/path なし) でも env だけで demo 判定が決まる。
		expect(resolveDemoActive(makeEnv('anonymous', 'demo'))).toBe(true);
	});

	it('AUTH_MODE=cognito + DATA_SOURCE=sqlite → false (本番 Lambda、NUC local)', () => {
		// AC6: ganbari-quest.com (本番 Cognito 認証 + sqlite/dynamodb) は当然 demo 扱いしない。
		expect(resolveDemoActive(makeEnv('cognito', 'sqlite'))).toBe(false);
	});

	it('AUTH_MODE=cognito + DATA_SOURCE=dynamodb → false (本番 Lambda、Lambda + DynamoDB)', () => {
		expect(resolveDemoActive(makeEnv('cognito', 'dynamodb'))).toBe(false);
	});

	it('AUTH_MODE=local + DATA_SOURCE=sqlite → false (npm run dev デフォルト)', () => {
		// `npm run dev` でローカル開発する場合の標準 env。demo 扱いしない。
		expect(resolveDemoActive(makeEnv('local', 'sqlite'))).toBe(false);
	});

	it('AUTH_MODE=anonymous + DATA_SOURCE=sqlite → false (開発者 misconfig 防止)', () => {
		// 重要: AnonymousAuthProvider + 実 sqlite DB の組合せは本番想定外。demo 扱いすると
		// 実 DB への書き込みが no-op になりローカル開発を壊すため env を厳密 AND する。
		expect(resolveDemoActive(makeEnv('anonymous', 'sqlite'))).toBe(false);
	});

	it('AUTH_MODE=anonymous + DATA_SOURCE=dynamodb → false (開発者 misconfig 防止)', () => {
		// 実 DynamoDB に対する no-op writer 化を防ぐ (同上)。
		expect(resolveDemoActive(makeEnv('anonymous', 'dynamodb'))).toBe(false);
	});

	it('AUTH_MODE=cognito + DATA_SOURCE=demo → false (理論上ありえないが防御)', () => {
		// 本番 cognito 認証で demo fixture を返すのは設計矛盾だが、env が不整合な状態でも
		// demo 扱いせず本番動作に倒す (安全側フォールバック)。
		expect(resolveDemoActive(makeEnv('cognito', 'demo'))).toBe(false);
	});

	it('AUTH_MODE=local + DATA_SOURCE=demo → false (理論上ありえないが防御)', () => {
		expect(resolveDemoActive(makeEnv('local', 'demo'))).toBe(false);
	});
});

describe('DEMO_WRITE_ALLOWLIST — PR-B3 で /demo/** 撤去後の最小集合', () => {
	it('/switch を含む (子供切替 form action `?/select` の redirect を no-op しないため、#2097 Phase B Bug 4)', () => {
		// demo Lambda 上で POST /switch?/select が `shouldReturnDemoNoop` で
		// `{ ok:true, demo:true }` を返してしまうと SvelteKit form action が成功と
		// 認識せず redirect 303 が発火しない → 子供クリックが動かない。
		// /switch を allowlist に追加することで本番ルートを通常駆動 (cookie set + redirect) させる。
		expect(DEMO_WRITE_ALLOWLIST).toContain('/switch');
	});

	it('/api/feedback / /api/demo-analytics / /api/health が含まれる (運用最小集合)', () => {
		expect(DEMO_WRITE_ALLOWLIST).toContain('/api/feedback');
		expect(DEMO_WRITE_ALLOWLIST).toContain('/api/demo-analytics');
		expect(DEMO_WRITE_ALLOWLIST).toContain('/api/health');
	});

	it('/api/demo/exit は含まれない (PR-B4 #2189 で撤去、demo Lambda には /demo/exit route なし)', () => {
		// PR-B3 で `/demo/**` route 物理撤去 + PR-B4 で cookie 機構自体撤去のため
		// `/demo/exit` 経路は完全消滅。allowlist からも撤去する。
		expect(DEMO_WRITE_ALLOWLIST).not.toContain('/api/demo/exit');
	});

	it('/demo/ プレフィックスは含まれない (PR-B3 で /demo/** route 物理撤去済)', () => {
		// PR-B3 (#2188) で `src/routes/demo/**` 配下 0 file 達成 → legacy /demo/** 配下の
		// form actions は到達経路がない。allowlist からも撤去する。
		expect(DEMO_WRITE_ALLOWLIST).not.toContain('/demo/');
	});

	it('isDemoWriteAllowed("/switch") === true (POST /switch?/select 含む前方一致)', () => {
		expect(isDemoWriteAllowed('/switch')).toBe(true);
		// form action POST のパスは `/switch?/select` だが、SvelteKit hooks では
		// `event.url.pathname` (= `/switch`) で前方一致する。
		expect(isDemoWriteAllowed('/switch?/select')).toBe(true);
	});

	it('allowlist 外パス (例: /admin/activities) は isDemoWriteAllowed=false (no-op 対象維持)', () => {
		expect(isDemoWriteAllowed('/admin/activities')).toBe(false);
		expect(isDemoWriteAllowed('/api/v1/children')).toBe(false);
	});
});

describe('DEMO_WRITE_METHODS — 書き込み HTTP メソッド集合 (PR-B4 影響なし、不変回帰防止)', () => {
	it('POST / PUT / PATCH / DELETE のみ含まれる', () => {
		expect(DEMO_WRITE_METHODS.has('POST')).toBe(true);
		expect(DEMO_WRITE_METHODS.has('PUT')).toBe(true);
		expect(DEMO_WRITE_METHODS.has('PATCH')).toBe(true);
		expect(DEMO_WRITE_METHODS.has('DELETE')).toBe(true);
		expect(DEMO_WRITE_METHODS.has('GET')).toBe(false);
		expect(DEMO_WRITE_METHODS.has('HEAD')).toBe(false);
	});
});
