/**
 * Issue #2098 AC7 — Stripe Dashboard 立ち上げランブック品質ゲート
 *
 * 「PO が Phase 1 立ち上げ 7 ステップを 1-2 時間で完了できる」を Dev 側で E2E 代替検証する。
 * ランブック (`docs/operations/stripe-dashboard-runbook.md`) が以下を満たすことを保証:
 *
 *  1. Phase 1 が 7 ステップで構成されている (`### ステップ N:` 見出しが 7 件)
 *  2. 各ステップに「操作対象画面」or「実行コマンド」相当の操作ポイントが明示
 *  3. 完了判定基準 (Save / HTTP 200 / 配備確認 等) が記載されている
 *  4. 全体所要時間が 60-120 分 (1-2 時間) 内で試算記述あり
 *  5. 独立した「トラブルシューティング」セクションが存在
 *  6. ADR-0006 整合 (配布証跡 3 箇所: SSM / NUC / GitHub Secrets) が記載
 *
 * AC7 と紐づくランブック構造を機械的に検証することで、PO ドライラン時の手戻りを最小化する。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNBOOK_PATH = resolve(process.cwd(), 'docs/operations/stripe-dashboard-runbook.md');
const STRIPE_SERVICE_PATH = resolve(process.cwd(), 'src/lib/server/services/stripe-service.ts');

/**
 * #3990: 「購読する event 一覧」と「handler が持つ case 一覧」の乖離を機械検知する。
 *
 * 手順書は `invoice.payment_succeeded` を 4 種の 1 つとして挙げていたが、コードが持つ case は
 * `invoice.paid` / `invoice.payment_failed` を含む 5 種で、**両者は Stripe 上の別 event**。
 * どちらか一方だけを購読していると、もう一方の handler は永久に発火しない。
 *
 * この乖離が厄介なのは **動作結果に現れない**ことにある。購読漏れは「その event が来ない」
 * だけなので、ログにも UI にも「何も起きなかった」以上のものが残らない。#3985 (dedup 未配線) と
 * 同じく、設定と実装のズレが沈黙する class である。
 *
 * したがって「手順書を直す」だけでは再発する。手順書とコードを**同時に落とす**ことで、
 * どちらか片方だけを変更できないようにする。
 */
function readStripeService(): string {
	return readFileSync(STRIPE_SERVICE_PATH, 'utf-8');
}

/** `handleWebhookEvent` の switch から `case 'xxx':` の event 名を抽出する。 */
function handledEventTypes(source: string): string[] {
	// #3985: dedup 配線に伴い switch は `handleWebhookEvent` から `dispatchWebhookEvent` へ移した。
	// 「switch を持つ関数」を見に行かないと 0 件マッチで素通りするため、抽出元も一緒に動かす。
	const fn = source.match(/async function dispatchWebhookEvent[\s\S]*?^}/m);
	if (!fn) throw new Error('dispatchWebhookEvent が見つかりません (関数名が変わった?)');
	return [...fn[0].matchAll(/case '([\w.]+)':/g)]
		.map((m) => m[1])
		.filter((v): v is string => v !== undefined)
		.sort();
}

/** 手順書の「Events to send」直後の箇条書きから event 名を抽出する。 */
function subscribedEventTypes(content: string): string[] {
	const section = content.match(/\*\*Events to send\*\*[\s\S]*?(?=^\d+\. )/m);
	if (!section) throw new Error('「Events to send」節が見つかりません (手順書の構造が変わった?)');
	return [...section[0].matchAll(/^\s*- `([\w.]+)`/gm)]
		.map((m) => m[1])
		.filter((v): v is string => v !== undefined)
		.sort();
}

function readRunbook(): string {
	if (!existsSync(RUNBOOK_PATH)) {
		throw new Error(`Stripe Dashboard runbook not found at ${RUNBOOK_PATH}`);
	}
	return readFileSync(RUNBOOK_PATH, 'utf-8');
}

describe('Stripe Dashboard 立ち上げランブック (#2098 AC7)', () => {
	const content = readRunbook();

	describe('AC7-1: Phase 1 構造 — 7 ステップ', () => {
		it('Phase 1 立ち上げチェックリスト section が存在する', () => {
			expect(content).toMatch(/## Phase 1: 立ち上げチェックリスト/);
		});

		it('Phase 1 内に 7 件の `### ステップ N:` 見出しがある', () => {
			// Phase 1 セクションを抽出
			const phase1Match = content.match(
				/## Phase 1:[\s\S]*?(?=^## (?:Phase 2|トラブルシューティング|$))/m,
			);
			expect(phase1Match).toBeTruthy();
			const phase1Section = phase1Match![0];

			// `### ステップ 1:` 〜 `### ステップ 7:` をカウント
			const stepMatches = phase1Section.match(/^### ステップ \d+:/gm) ?? [];
			expect(stepMatches.length).toBe(7);
		});

		it('ステップ 1-7 の番号が連続している (歯抜けなし)', () => {
			const phase1Match = content.match(
				/## Phase 1:[\s\S]*?(?=^## (?:Phase 2|トラブルシューティング|$))/m,
			);
			expect(phase1Match).toBeTruthy();
			const stepNumbers = [...phase1Match![0].matchAll(/^### ステップ (\d+):/gm)].map((m) =>
				Number(m[1]),
			);
			expect(stepNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
		});
	});

	describe('AC7-2: 各ステップに操作ポイントが明示', () => {
		it('「操作対象画面」記述が 7 件以上ある (ステップ 1-7 + 子セクション)', () => {
			const operationPointMatches = content.match(/操作対象画面:/g) ?? [];
			expect(operationPointMatches.length).toBeGreaterThanOrEqual(7);
		});

		it('Stripe Dashboard URL リンクが本文に複数回登場する', () => {
			// dashboard.stripe.com / docs.stripe.com のいずれか
			const stripeLinks = content.match(/https:\/\/(?:dashboard|docs)\.stripe\.com\//g) ?? [];
			expect(stripeLinks.length).toBeGreaterThanOrEqual(5);
		});
	});

	describe('AC7-3: 完了判定基準が記載', () => {
		it('「完了判定基準」セクションがステップ 7 に存在する', () => {
			expect(content).toMatch(/完了判定基準/);
		});

		it('Webhook HTTP 200 受信を完了判定として明示', () => {
			expect(content).toMatch(/HTTP 200/);
		});

		it('Save / Save product / Save endpoint 等の保存アクションが各ステップ末尾に記述', () => {
			const saveActions = content.match(/「?Save( product| endpoint)?」?/g) ?? [];
			expect(saveActions.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe('AC7-4: 全体所要時間 60-120 分内', () => {
		it('「所要時間サマリー」テーブルが存在する', () => {
			expect(content).toMatch(/所要時間サマリー/);
		});

		it('合計所要時間が 60-120 分 (1-2 時間) 範囲内であることが明記', () => {
			// 「**合計** | **70-110 分（1-2 時間）**」テーブル行表記をマッチ
			// または「全体所要時間: **約 1 時間 10 分 〜 1 時間 50 分**」を許容
			// 60-130 分範囲のいずれかの表記を探す
			const tableMatch = content.match(/合計\*?\*?\s*\|\s*\*?\*?(\d{2,3})[-〜](\d{2,3})\s*分/);
			expect(tableMatch).toBeTruthy();
			if (tableMatch) {
				const minTime = Number(tableMatch[1]);
				const maxTime = Number(tableMatch[2]);
				// 60-120 分 (1-2 時間) 範囲内 + buffer 10 分
				expect(minTime).toBeGreaterThanOrEqual(60);
				expect(maxTime).toBeLessThanOrEqual(130);
			}
		});

		it('「1-2 時間」or「1 時間」相当の表記が冒頭メタ情報に存在する', () => {
			// "想定所要時間" / "Phase 1: 1-2 時間" 等
			expect(content).toMatch(/想定所要時間[\s\S]{0,100}?(?:1-2 時間|1\s*時間)/);
		});
	});

	describe('AC7-5: 独立トラブルシューティングセクション', () => {
		it('「## トラブルシューティング」見出しが存在する', () => {
			expect(content).toMatch(/^## トラブルシューティング/m);
		});

		it('トラブルシューティング section 内に複数の問題系統が記載 (Webhook / Price / Portal 等)', () => {
			const tsMatch = content.match(
				/## トラブルシューティング[\s\S]*?(?=^## (?:Phase 2|配布|改訂|$))/m,
			);
			expect(tsMatch).toBeTruthy();
			const tsSection = tsMatch![0];

			// 5 系統のキーワードのうち 3 つ以上が登場
			const keywords = ['Webhook', 'Price', 'Customer Portal', 'Tax', '配布証跡'];
			const matchedKeywords = keywords.filter((kw) => tsSection.includes(kw));
			expect(matchedKeywords.length).toBeGreaterThanOrEqual(3);
		});

		it('HTTP エラーコード (400 / 401 / 403 / 500) 別の対処が記載', () => {
			// 400 / 401 / 403 / 500 のうち 3 つ以上
			const errorCodes = ['400', '401', '403', '500'];
			const matched = errorCodes.filter((code) =>
				new RegExp(`HTTP ${code}|${code} エラー`).test(content),
			);
			expect(matched.length).toBeGreaterThanOrEqual(3);
		});
	});

	describe('AC7-6: ADR-0006 配布証跡 3 箇所', () => {
		it('SSM Parameter Store 配備手順が記載', () => {
			expect(content).toMatch(/aws ssm put-parameter/);
			expect(content).toMatch(/STRIPE_WEBHOOK_SECRET/);
		});

		it('NUC `.env` 配備手順が記載', () => {
			expect(content).toMatch(/NUC.*\.env/i);
		});

		it('GitHub Actions Secrets 配備手順が記載', () => {
			expect(content).toMatch(/gh secret set/);
		});

		it('ADR-0006 への参照がある', () => {
			expect(content).toMatch(/ADR-0006/);
		});
	});

	// #3990: 手順書とコードの乖離を「両方同時に落ちる」形で固定する。
	describe('#3990: 購読 event 一覧 ↔ handleWebhookEvent の case 一覧', () => {
		const handled = handledEventTypes(readStripeService());
		const subscribed = subscribedEventTypes(content);

		it('[W0] 双方から event を 1 件以上抽出できる (0 件マッチの素通りを防ぐ)', () => {
			expect(handled.length).toBeGreaterThan(0);
			expect(subscribed.length).toBeGreaterThan(0);
		});

		it('[W1] 手順書の購読一覧と handler の case 一覧が完全一致する', () => {
			expect(
				subscribed,
				[
					'手順書とコードで webhook event 一覧が食い違っています。',
					`  手順書: ${subscribed.join(', ')}`,
					`  コード: ${handled.join(', ')}`,
					'',
				].join('\n') +
					'→ 購読しているのに handler が無い / handler があるのに永久に発火しない、のどちらかが起きます。' +
					'この乖離は動作結果に現れない (沈黙する) ため、ここで落とします',
			).toEqual(handled);
		});

		// `invoice.paid` と `invoice.payment_succeeded` は Stripe 上の別 event。
		// 実際に手順書が後者を挙げていたのが本 Issue の発端なので、実名で固定する。
		it('[W2] 手順書は invoice.payment_succeeded を挙げない (invoice.paid とは別 event)', () => {
			expect(subscribed).not.toContain('invoice.payment_succeeded');
			expect(subscribed).toContain('invoice.paid');
		});
	});

	describe('AC7-7: 関連 Issue / ADR / 設計書への横断 link', () => {
		it('親 EPIC #2098 への参照', () => {
			expect(content).toMatch(/#2098/);
		});

		it('Stripe Webhook signature verification の Stripe doc link', () => {
			expect(content).toMatch(/docs\.stripe\.com\/webhooks/);
		});

		it('関連設計書 (license-key-requirements / plan-change-flow) link', () => {
			expect(content).toMatch(/license-key-requirements/);
			expect(content).toMatch(/plan-change-flow/);
		});
	});
});
