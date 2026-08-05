// tests/unit/architecture/cron-smoke-reaches-route.test.ts
// #4206 — post-deploy smoke が「実際に cron route まで届くか」を検査していない穴を塞ぐ。
//
// ## 実害（本番 us-east-1 実測、2026-08-02）
//
// 本番の cron は **稼働開始（2026-04）から約 4 ヶ月間、成功 0 回**だった。
// 直近 24h の実測は「dispatcher が呼んだ 945 回 = HTTP 401 が 945 回」で、
// `export-build` / `stripe-webhook-delivery-check` / `retention-cleanup` /
// `trial-notifications` / `lifecycle-emails` の**全部**が落ちていた。
//
// 原因（#4216 で develop に修正済）は `isPublicRoute()` に `/api/cron` が無く、
// リクエストが hooks の認可層で 401 になり cron route に到達しなかったこと。
//
// ## なぜ 4 ヶ月も気づけなかったか（本 test が塞ぐのはこちら）
//
// `deploy.yml` の post-deploy smoke は **`{"cronJob":"...","dryRun":true}`** を投げる。
// dryRun は env 検証だけで **HTTP POST の手前で return する**ため、
// **実経路が 100% 失敗していても smoke は常に 200 で green** だった。
//
// アラームの宛先ゼロ（#4189）は「鳴っても届かない」問題だが、こちらは
// **「そもそも検査していないのに pass と表示される」**問題で、原因が別である。
// #4084（SS gate がペア 0 件で skip）/ #3962（jq が落ちて catch で握り潰し）と同じクラス。
//
// ## 何を要求するか
//
// smoke が **実 HTTP 経路**を 1 回叩き、返ってきた 401 が
//
//   - route 側 (`verifyCronAuth`) の `Unauthorized`        → 到達している = OK
//   - hooks 側 (`hooks.server.ts`) の `認証が必要です`      → 到達していない = FAIL
//
// のどちらかを**区別する**こと。わざと誤った secret を送るので、
// 認証は job 実行前に落ち、**副作用はゼロ**である。
//
// 「到達しているか」と「secret 検証が生きているか」を 1 回の probe で同時に見る。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW = '.github/workflows/deploy.yml';

/**
 * YAML のコメント行を落とす。
 *
 * コメントで満たせる fitness は fitness ではない（#4206 で 1 度踏んでいる)。
 * 「# 実 HTTP 経路を叩く」と書いただけで通ってしまうと、**検査が無いのに緑**という
 * 本 test が塞ごうとしている当の状態を再生産する。
 */
function stripYamlComments(text: string): string {
	return text
		.split('\n')
		.map((line) => line.replace(/(^|\s)#.*$/, ''))
		.join('\n');
}

describe('#4206 post-deploy smoke は cron route まで到達しているかを検査する', () => {
	const raw = readFileSync(WORKFLOW, 'utf8');
	const yaml = stripYamlComments(raw);

	it('dryRun だけで終わらせず、実 HTTP 経路を 1 回叩いている', () => {
		expect(
			yaml,
			`${WORKFLOW}: cron smoke が FUNCTION_URL 経由で /api/cron/ を叩いていません。` +
				`dryRun は HTTP POST の手前で return するため、実経路が 100% 失敗していても green になります` +
				`（本番で約 4 ヶ月間そうなっていました）`,
		).toMatch(/\/api\/cron\//);
	});

	it('route 側の Unauthorized と hooks 側の 401 を区別している', () => {
		// 到達していれば route 側 verifyCronAuth の `Unauthorized` が返る。
		expect(
			yaml,
			`${WORKFLOW}: route 側 (verifyCronAuth) の応答本文を assert していません。` +
				`ステータスコードだけを見ると、hooks で弾かれた 401 と区別できません`,
		).toContain('Unauthorized');

		// hooks 側で落ちた場合の本文を名指しで検出できること。
		expect(
			yaml,
			`${WORKFLOW}: hooks 側の 401 本文 (認証が必要です) を検出していません。` +
				`これが返ったら「cron route に届いていない」= #4206 の再発です`,
		).toContain('認証が必要です');
	});

	it('smoke が失敗したら deploy を止める (warning で流さない)', () => {
		const step = yaml.slice(yaml.indexOf('Cron dispatcher smoke test'));
		const nextStep = step.indexOf('\n      - name:');
		const body = nextStep > 0 ? step.slice(0, nextStep) : step;

		expect(body, 'cron smoke step が見つかりません').toContain('/api/cron/');
		expect(
			body,
			'cron smoke が continue-on-error になっています。検知しても止めないなら gate ではありません',
		).not.toContain('continue-on-error: true');
		expect(body, 'cron smoke が失敗時に exit 1 していません').toContain('exit 1');
	});
});
