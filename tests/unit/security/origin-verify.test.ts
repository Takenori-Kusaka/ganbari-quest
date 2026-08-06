/**
 * tests/unit/security/origin-verify.test.ts (#4280 案 b)
 *
 * CloudFront → origin の shared secret header 検査。
 *
 * **本 test が最優先で守るのは「壊さないこと」**:
 *   `/api/stripe/webhook` と `/api/cron/*` は CloudFront を経由できない / する必要がない
 *   正当な実経路であり、header 無しで従来どおり通らなければならない。ここが落ちる実装を
 *   本番に出すと、課金 webhook が全滅し (Stripe は 403 連続で endpoint を無効化する)、
 *   cron が「経路はあるのに 0 通」で静かに死ぬ (#4119 / #4174 と同型)。
 *
 * 実測前提 (2026-08-06、read-only 照会):
 *   - 本番 (live)   we_1TGnf6BgMFbHJZ0Z3Djw6rpL → https://<prod-fn-url>/api/stripe/webhook
 *   - staging(test) we_1TcfvFBgMFbHJZ0Z5t5Tt53B → https://<staging-fn-url>/api/stripe/webhook
 *   いずれも **Lambda Function URL 直**で登録済 (CloudFront が geoRestriction JP のため、
 *   米国から送信される Stripe webhook を CloudFront 経由にはできない)。
 *   - cron-dispatcher Lambda の env `FUNCTION_URL` も Function URL 直。
 */

// cspell 例外 (本 file 限定、.cspell.json への global 追加はしない):
//   - `Tcfv`: staging Stripe webhook endpoint ID の実値の一部。綴りを変えると実測の証跡でなくなる
//   - `adminx` / `opsx`: **負例 fixture**。`/admin` `/ops` に前方一致するが保護対象であってはならない
//     path で、「緩い前方一致で無関係な path を巻き込まない」ことを検証する実体。綴りを直すと
//     negative case が成立しなくなる (tests/CLAUDE.md §負例 fixture と cspell)
// cspell:ignore Tcfv adminx opsx

import { describe, expect, it } from 'vitest';

import {
	countMatchingSecrets,
	evaluateFrontDoor,
	FRONT_DOOR_PROTECTED_PREFIXES,
	isFrontDoorProtectedPath,
	ORIGIN_VERIFY_HEADER,
} from '../../../src/lib/server/security/origin-verify';

const SECRET = 'a'.repeat(64);

/** 実際の `Request` から header を引いて評価する (hooks.server.ts と同じ引き方)。 */
function evaluateRequest(path: string, headers: Record<string, string>, secret = SECRET) {
	const request = new Request(`https://example.invalid${path}`, { headers });
	return evaluateFrontDoor(path, request.headers.get(ORIGIN_VERIFY_HEADER), secret);
}

describe('#4280 front door: 保護対象 (/admin ・ /api/v1/admin ・ /ops)', () => {
	const protectedPaths = [
		'/admin',
		'/admin/activities',
		'/admin/settings/rules',
		'/api/v1/admin',
		'/api/v1/admin/tenant-cleanup',
		'/ops',
		'/ops/cost',
	];

	it.each(protectedPaths)('header 無しの %s は拒否される', (path) => {
		expect(evaluateRequest(path, {})).toBe('deny');
	});

	it.each(protectedPaths)('正しい header 付きの %s は通る', (path) => {
		expect(evaluateRequest(path, { [ORIGIN_VERIFY_HEADER]: SECRET })).toBe('allow');
	});

	it('値が違う header は拒否される (推測では通らない)', () => {
		expect(evaluateRequest('/ops', { [ORIGIN_VERIFY_HEADER]: 'b'.repeat(64) })).toBe('deny');
	});

	it('長さの違う header は拒否される (定数時間比較の長さ guard)', () => {
		expect(evaluateRequest('/ops', { [ORIGIN_VERIFY_HEADER]: 'a'.repeat(63) })).toBe('deny');
		expect(evaluateRequest('/ops', { [ORIGIN_VERIFY_HEADER]: `${SECRET}x` })).toBe('deny');
	});

	it('空文字の header は拒否される', () => {
		expect(evaluateRequest('/admin', { [ORIGIN_VERIFY_HEADER]: '' })).toBe('deny');
	});

	it('header 名は case-insensitive に引ける (CloudFront の送出表記に依存しない)', () => {
		expect(evaluateRequest('/admin', { 'X-Origin-Verify': SECRET })).toBe('allow');
	});
});

describe('#4280 front door: 対象外 = 自前の認証を持つ実経路 (壊さない)', () => {
	// path → その path が front door の代わりに持っている認証 (PR body の除外根拠と同じ表)
	const exempt: Array<[string, string]> = [
		['/api/stripe/webhook', 'Stripe 署名検証 (STRIPE_WEBHOOK_SECRET)'],
		['/api/cron/retention-cleanup', 'CRON_SECRET (verifyCronAuth)'],
		['/api/cron/trial-notifications', 'CRON_SECRET (verifyCronAuth)'],
		['/api/cron/pglite-backup', 'CRON_SECRET (verifyCronAuth)'],
		['/api/health', '公開情報のみ (LWA readiness / post-deploy smoke が Function URL 直で叩く)'],
		['/api/ready', '同上'],
		['/auth/login', 'Cognito (未認証で到達するのが正常)'],
		['/', '公開ページ'],
		['/marketplace', '公開ページ'],
		['/api/v1/activities', 'Cognito セッション (子供画面が呼ぶ)'],
	];

	it.each(exempt)('header 無しの %s は従来どおり通る (根拠: %s)', (path) => {
		expect(evaluateRequest(path, {})).toBe('allow');
	});
});

describe('#4280 front door: prefix 境界 (緩い前方一致で巻き込まない)', () => {
	it.each([
		'/administrator',
		'/adminx',
		'/opsx',
		'/api/v1/administrators',
	])('%s は保護対象ではない', (path) => {
		expect(isFrontDoorProtectedPath(path)).toBe(false);
	});

	it.each([...FRONT_DOOR_PROTECTED_PREFIXES])('%s 自身は保護対象', (prefix) => {
		expect(isFrontDoorProtectedPath(prefix)).toBe(true);
	});
});

describe('#4364 front door: 新旧 2 値受理 (無停止ローテーション)', () => {
	// secret は 2 stack に配られる: CloudFront origin custom header (NetworkStack) と
	// Lambda env (ComputeStack)。`cdk deploy --all` は Compute → Network の依存順で走るため、
	// **Lambda が新値を期待し始めた後に CloudFront がまだ旧値を送っている**窓が必ず開く
	// (distribution が Deployed になるまで数分)。単一値受理のままローテーションすると
	// その間 /admin ・ /api/v1/admin ・ /ops が全顧客で 404 になる。
	//
	// AWS 参照実装 (Security Blog の X-Origin-Verify) は AWSCURRENT + AWSPENDING の
	// 2 値を OR 受理することで、既定 1 日間隔のローテーションでも窓を作らない。同じ形に揃える。
	const NEXT = 'n'.repeat(64);
	const PREVIOUS = 'p'.repeat(64);

	it('伝播中の旧値 header を受理する (これが無いとローテーション = 確実な全 /admin 404)', () => {
		expect(evaluateFrontDoor('/admin', PREVIOUS, NEXT, PREVIOUS)).toBe('allow');
	});

	it('新値 header も同時に受理する (伝播が終わった後の経路)', () => {
		expect(evaluateFrontDoor('/admin', NEXT, NEXT, PREVIOUS)).toBe('allow');
	});

	it('新旧どちらでもない値は拒否される (2 値にしても素通しにならない)', () => {
		expect(evaluateFrontDoor('/ops', 'x'.repeat(64), NEXT, PREVIOUS)).toBe('deny');
		expect(evaluateFrontDoor('/ops', null, NEXT, PREVIOUS)).toBe('deny');
		expect(evaluateFrontDoor('/ops', '', NEXT, PREVIOUS)).toBe('deny');
	});

	it('旧値未設定なら新値のみで判定する (初回導入 / ローテーション完了後の定常状態)', () => {
		expect(evaluateFrontDoor('/admin', NEXT, NEXT, undefined)).toBe('allow');
		expect(evaluateFrontDoor('/admin', NEXT, NEXT, '')).toBe('allow');
		expect(evaluateFrontDoor('/admin', PREVIOUS, NEXT, undefined)).toBe('deny');
		expect(evaluateFrontDoor('/admin', PREVIOUS, NEXT, '')).toBe('deny');
	});

	// --- 短絡評価をさせない (どちらが一致したかをタイミング差で漏らさない) ---
	//
	// `current || previous` と書くと「新値一致 = 比較 1 回 / 旧値一致 = 比較 2 回」になり、
	// 応答時間の差から「今どちらの値が現役か」を外部から区別できてしまう。
	// 実測 timing は環境ノイズで固定できないため、**「一致した個数を返す」契約**で構造的に縛る。
	// 個数を返す以上、実装は必ず全候補を評価しなければならない (短絡評価が書けない)。
	describe('countMatchingSecrets: 全候補を必ず評価する', () => {
		it('先頭が一致しても後続を評価する (短絡していたら 1 になって fail する)', () => {
			expect(countMatchingSecrets(NEXT, [NEXT, NEXT])).toBe(2);
		});

		it('新値のみ一致 / 旧値のみ一致 は 1', () => {
			expect(countMatchingSecrets(NEXT, [NEXT, PREVIOUS])).toBe(1);
			expect(countMatchingSecrets(PREVIOUS, [NEXT, PREVIOUS])).toBe(1);
		});

		it('どちらとも不一致 / header 無し は 0', () => {
			expect(countMatchingSecrets('x'.repeat(64), [NEXT, PREVIOUS])).toBe(0);
			expect(countMatchingSecrets(null, [NEXT, PREVIOUS])).toBe(0);
			expect(countMatchingSecrets('', [NEXT, PREVIOUS])).toBe(0);
		});
	});
});

describe('#4280 front door: secret 未設定時 (fail-open)', () => {
	// CloudFront を持たない配備 (NUC セルフホスト / ローカル開発 / demo Lambda) では
	// secret が無いのが正常。fail-closed にすると全顧客の /admin が 404 になる。
	// AWS 側の設定漏れは CDK synth (origin-verify-context.ts) と deploy.yml が止める。
	it.each([
		'/admin',
		'/ops',
		'/api/v1/admin/tenant-cleanup',
	])('%s は not-configured を返す (呼び出し側が 1 回だけ log して通す)', (path) => {
		expect(evaluateFrontDoor(path, null, undefined)).toBe('not-configured');
		expect(evaluateFrontDoor(path, null, '')).toBe('not-configured');
	});

	it('保護対象外は secret 未設定でも allow (not-configured を返さない = 無駄な log を出さない)', () => {
		expect(evaluateFrontDoor('/api/stripe/webhook', null, undefined)).toBe('allow');
	});
});
