// tests/unit/architecture/stripe-webhook-single-entrypoint.test.ts
//
// #4128 AC1 / AC2: 「課金 event を受け取ったのに処理せず 200 を返す経路」を構造的に禁止する
// fitness function。
//
// 2026-07-26 の実障害 (初回の有料課金が丸ごと落ち、無通知) と同 class の穴として、統合監査で
// webhook 受信口が 2 本 (`/api/stripe/webhook` と `/api/stripe/webhook-v2`) 並存している状態が
// 検出された。v2 は `STRIPE_WEBHOOK_SHADOW_MODE=true` のとき **署名検証だけして log を 1 行出し、
// `{received:true, mode:'shadow'}` を 200 で返す**。Stripe は 200 を受けると再送しないため、
// Dashboard の destination を v2 に向けた瞬間 (cutover 順序を誤った瞬間) に課金 event が
// silent drop される。台帳にも残らないので、後から「落ちた」ことすら分からない。
//
// 受信口が 1 本であること自体を機械で固定する。route を増やす / shadow 分岐を戻す変更は
// 本 test が落とす (ADR-0061 原則 2 = same-class 2 回目は機械 guard に畳む)。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');

/** Stripe webhook の署名検証 = 「Stripe から event を受け取る口」の決定的な指標。 */
const SIGNATURE_VERIFY_PATTERN = /verifyWebhookSignature|webhooks\.constructEvent/;

/** dispatcher 本体。受信口はこれを呼ばなければ event を捨てていることになる。 */
const DISPATCH_SYMBOL = 'handleWebhookEvent';

/**
 * 受信口として唯一許可される route。
 *
 * 運用 doc / runbook (`docs/operations/stripe-dashboard-runbook.md` /
 * `docs/guides/stripe-setup-guide.md`) が Stripe Dashboard に登録する URL と一致していること。
 */
const ALLOWED_WEBHOOK_ROUTE = 'src/routes/api/stripe/webhook/+server.ts';

function listFiles(dir: string, filter: (path: string) => boolean): string[] {
	const found: string[] = [];
	const walk = (current: string): void => {
		for (const entry of readdirSync(current)) {
			const full = join(current, entry);
			if (statSync(full).isDirectory()) {
				if (entry === 'node_modules' || entry === '.svelte-kit') continue;
				walk(full);
				continue;
			}
			if (filter(full)) found.push(full);
		}
	};
	walk(dir);
	return found;
}

const serverRouteFiles = listFiles(join(repoRoot, 'src', 'routes'), (p) =>
	p.endsWith('+server.ts'),
);

interface WebhookRoute {
	path: string;
	source: string;
}

const webhookRoutes: WebhookRoute[] = serverRouteFiles
	.map((path) => ({
		path: relative(repoRoot, path).replace(/\\/g, '/'),
		source: readFileSync(path, 'utf-8'),
	}))
	.filter((file) => SIGNATURE_VERIFY_PATTERN.test(file.source));

describe('Stripe webhook 受信口 (#4128 AC1 / AC2)', () => {
	it('署名検証を行う route を検出できている (検査が空振りしていない)', () => {
		// 0 件で PASS すると「受信口が無い」ことを健全と見なしてしまう。検査対象の存在自体を assert する。
		expect(webhookRoutes.length).toBeGreaterThan(0);
	});

	it('受信口は 1 本だけである', () => {
		expect(webhookRoutes.map((r) => r.path)).toEqual([ALLOWED_WEBHOOK_ROUTE]);
	});

	it('受信口はすべて handleWebhookEvent に dispatch する (受け取って捨てる経路が無い)', () => {
		for (const route of webhookRoutes) {
			expect(route.source, `${route.path} が ${DISPATCH_SYMBOL} を呼んでいない`).toContain(
				DISPATCH_SYMBOL,
			);
		}
	});

	it('shadow mode (受信して破棄し 200 を返す分岐) が src に存在しない', { timeout: 60_000 }, () => {
		const srcFiles = listFiles(
			join(repoRoot, 'src'),
			(p) => p.endsWith('.ts') || p.endsWith('.svelte'),
		);
		const offenders = srcFiles
			.filter((p) =>
				/STRIPE_WEBHOOK_SHADOW_MODE|isWebhookShadowModeEnabled|getWebhookSecretForShadow/.test(
					readFileSync(p, 'utf-8'),
				),
			)
			.map((p) => relative(repoRoot, p).replace(/\\/g, '/'));
		expect(offenders).toEqual([]);
	});

	it('shadow mode の env 配線 (infra / workflow / .env.example) が残っていない', {
		timeout: 60_000,
	}, () => {
		// アプリ側から分岐を消しても env が配布され続けていると、「flag はあるのに効かない」状態が
		// 運用 doc と食い違ったまま残る。配線ごと落とす。
		const wiringFiles = [
			...listFiles(join(repoRoot, 'infra', 'lib'), (p) => p.endsWith('.ts')),
			...listFiles(join(repoRoot, '.github', 'workflows'), (p) => p.endsWith('.yml')),
			join(repoRoot, '.env.example'),
		];
		const offenders = wiringFiles
			.filter((p) =>
				/STRIPE_WEBHOOK_SHADOW_MODE|stripeWebhookShadowMode/.test(readFileSync(p, 'utf-8')),
			)
			.map((p) => relative(repoRoot, p).replace(/\\/g, '/'));
		expect(offenders).toEqual([]);
	});
});
