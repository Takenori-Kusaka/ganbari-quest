// tests/unit/docs/stripe-webhook-subscribed-events-ssot.test.ts
// #3990: 「Dashboard で購読する event 集合」を書いている **全 doc** と、実装の `case` 一覧を突合する。
//
// 背景 (なぜ runbook だけでは足りなかったか):
//   初版 (#3990) は `docs/operations/stripe-dashboard-runbook.md` だけを実装と突合していた。
//   その結果、同じ集合を書いている設計文書 (phase5 §4.3 / phase6 Step 4) が
//   `checkout.session.completed` を落とし handler の無い `credit_note.created` を含んだまま残り、
//   しかも phase5 の「Phase 7 変更対象」表が **その誤った一覧で正しい guide を置き換えろ**と指示していた。
//   その通りに Dashboard を設定すると新規購入が DB に反映されない (= #3990 の実害そのもの)。
//
//   購読漏れも handler 不在も **動作結果に現れない (沈黙する)**。よって「1 文書だけ直す」では再発する。
//   ADR-0061 same-class-N→guard に従い、集合を宣言する doc を全て突合対象に含める。
//
// 本 gate が検出するもの / しないもの:
//   検出する: (1) 登録 doc の marker block と実装 `case` の不一致 (過不足どちらも)
//             (2) 集合を宣言していそうな未登録 doc (= 登録漏れ / 新規 doc の silent gap)
//             (3) marker block の欠落・0 件マッチ (検査の空振り)
//   検出しない: allowlist 済 doc の**本文中**に新たな集合宣言が散文で書かれた場合
//               (marker block を置けば (1) の対象になる。散文の意味解析は行わない)

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const STRIPE_SERVICE = 'src/lib/server/services/stripe-service.ts';

/**
 * 購読 event 集合を宣言する doc (marker block 必須)。
 * 集合を書く doc を新設したら **ここに追加する** (追加漏れは [W3] が検出する)。
 */
const DECLARING_DOCS = [
	'docs/operations/stripe-dashboard-runbook.md',
	'docs/guides/stripe-setup-guide.md',
	'docs/design/billing-redesign/phase5-stripe-product-architecture.md',
	'docs/design/billing-redesign/phase6-phase7-execution-ssot.md',
] as const;

/**
 * 個別 event の挙動を散文で述べるだけで、Dashboard 購読集合の宣言ではない doc。
 * [W3] の「集合を宣言していそう」判定 (3 種以上の event 名を含む) に引っかかるが正当な例外。
 */
const NON_DECLARING_DOCS: Record<string, string> = {
	'docs/design/plan-change-flow.md': 'プラン変更 / 解約フローの handler 別挙動の記述',
	'docs/design/billing-redesign/contract-state-matrix.md': '書き手 (W1-W5) と契約状態遷移の対応表',
	'docs/design/billing-redesign/phase5-webhook-idempotency-architecture.md':
		'event 別の重複到達リスク分析',
	'docs/design/billing-redesign/phase5-proration-architecture.md': 'proration 時の受信順序の記述',
	'docs/design/billing-redesign/phase6-test-clock-scenarios.md':
		'test clock シナリオ別の想定受信 event',
	'docs/design/billing-redesign/phase6-rollback-and-kill-switches.md':
		'ロールバックシナリオ別のトリガ event',
	'docs/design/19-プライシング戦略書.md': 'KPI / 課金モデルの説明文中の event 言及',
};

function read(relPath: string): string {
	return readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

/** `docs/` 配下の .md を再帰列挙する (repo 相対・POSIX 区切り)。 */
function walkMarkdown(dirRelPath: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(path.join(REPO_ROOT, dirRelPath), { withFileTypes: true })) {
		const rel = `${dirRelPath}/${entry.name}`;
		if (entry.isDirectory()) walkMarkdown(rel, acc);
		else if (entry.name.endsWith('.md')) acc.push(rel);
	}
	return acc;
}

/** 実装 `dispatchWebhookEvent` の switch から `case 'xxx':` を抽出する。 */
function handledEventTypes(): string[] {
	const source = read(STRIPE_SERVICE);
	const fn = source.match(/async function dispatchWebhookEvent[\s\S]*?^}/m);
	if (!fn) throw new Error('dispatchWebhookEvent が見つかりません (関数名が変わった?)');
	return [...fn[0].matchAll(/case '([\w.]+)':/g)]
		.map((m) => m[1])
		.filter((v): v is string => v !== undefined)
		.sort();
}

const MARKER_START = '<!-- webhook-subscribed-events:start -->';
const MARKER_END = '<!-- webhook-subscribed-events:end -->';

/** doc の marker block 内の箇条書きから event 名を抽出する。 */
function declaredEventTypes(relPath: string): string[] {
	const content = read(relPath);
	const start = content.indexOf(MARKER_START);
	const end = content.indexOf(MARKER_END);
	if (start < 0 || end < 0 || end < start) {
		throw new Error(
			`${relPath} に購読 event の marker block (${MARKER_START} 〜 ${MARKER_END}) がありません。` +
				'集合を宣言する doc は marker で囲むこと (囲まないと機械突合できない)',
		);
	}
	const block = content.slice(start + MARKER_START.length, end);
	return [...block.matchAll(/^\s*- `([\w.]+)`/gm)]
		.map((m) => m[1])
		.filter((v): v is string => v !== undefined)
		.sort();
}

describe('#3990: 購読 event 集合 ↔ dispatchWebhookEvent の case 一覧', () => {
	const handled = handledEventTypes();

	it('[W0] 実装から event を 1 件以上抽出できる (0 件マッチの素通りを防ぐ)', () => {
		expect(handled.length).toBeGreaterThan(0);
	});

	it.each(DECLARING_DOCS)('[W1] %s の購読一覧が実装の case 一覧と完全一致する', (relPath) => {
		const declared = declaredEventTypes(relPath);
		expect(declared.length, `${relPath} の marker block から event を抽出できない`).toBeGreaterThan(
			0,
		);
		expect(
			declared,
			[
				`${relPath} と実装で webhook event 一覧が食い違っています。`,
				`  doc  : ${declared.join(', ')}`,
				`  コード: ${handled.join(', ')}`,
				'→ 購読しているのに handler が無い / handler があるのに永久に発火しない、のどちらかが起きます。',
				'この乖離は動作結果に現れない (沈黙する) ため、ここで落とします',
			].join('\n'),
		).toEqual(handled);
	});

	// `invoice.paid` と `invoice.payment_succeeded` は Stripe 上の別 event。
	// 実際に手順書が後者を挙げていたのが #3990 の発端なので、実名で固定する。
	it('[W2] どの doc も invoice.payment_succeeded を購読一覧に挙げない', () => {
		for (const relPath of DECLARING_DOCS) {
			const declared = declaredEventTypes(relPath);
			expect(declared, relPath).not.toContain('invoice.payment_succeeded');
			expect(declared, relPath).toContain('invoice.paid');
		}
	});

	it('[W3] 集合を宣言していそうな doc が登録 / 例外リストのどちらかに載っている', () => {
		const files = walkMarkdown('docs');
		expect(files.length, 'docs 配下の .md を列挙できていない (検査の空振り)').toBeGreaterThan(50);
		const unclassified: string[] = [];
		for (const relPath of files) {
			if ((DECLARING_DOCS as readonly string[]).includes(relPath)) continue;
			if (relPath in NON_DECLARING_DOCS) continue;
			const content = read(relPath);
			// 3 種以上の handled event 名を含む doc = 集合を宣言している可能性が高い
			const mentioned = handled.filter((e) => content.includes(e));
			if (mentioned.length >= 3) unclassified.push(`${relPath} (${mentioned.join(', ')})`);
		}
		expect(
			unclassified,
			[
				'購読 event 集合を宣言していそうな doc が未分類です。',
				'集合の宣言なら DECLARING_DOCS に追加し marker block で囲む。',
				'個別 event の挙動を述べる散文なら NON_DECLARING_DOCS に理由付きで登録する。',
				...unclassified,
			].join('\n'),
		).toEqual([]);
	});

	it('[W4] 例外リストの doc が全て実在する (rename で例外が死に票にならない)', () => {
		for (const relPath of Object.keys(NON_DECLARING_DOCS)) {
			expect(() => read(relPath), `${relPath} が見つからない`).not.toThrow();
		}
	});
});
