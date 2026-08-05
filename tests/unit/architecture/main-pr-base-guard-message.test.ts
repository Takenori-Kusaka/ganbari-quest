// tests/unit/architecture/main-pr-base-guard-message.test.ts
// #4273 — main 向け PR を止める guard が「直し方」を出しているか。
//
// ## 何を守る test か
//
// `main-pr-base-guard` は dependabot / renovate の main 向け PR を #3922 で既に fail-close
// している（**gate は存在し、実際に #4251 は fail していた**）。残っていたのは *止め方* ではなく
// *直し方* で、旧メッセージは「本 PR は merge せず **close し**、同 version への更新を develop
// 向けに反映してください（次回 grouped bump を待つ / 手動で develop 向け bump PR を作成）」だった。
//
// 実際の解決は `gh pr edit <N> --base develop` の **retarget 1 コマンド**で足りる（#4251 /
// #4271 / #4272 の 3 件をこれで通常レーンに載せた）。close + 再作成を案内すると、
// **最も安い直し方に到達できないまま手戻りが発生する**。
//
// PO 決裁 (#4273 案 c): 「fail メッセージに retarget コマンドをそのまま出す。
// **止めるだけで直し方を書かない guard にしない**」。
//
// ## なぜ workflow の文字列を test で見るのか
//
// このメッセージは **main 向け PR が作られたときにしか出ない**。通常の PR では 1 度も実行されず、
// 文言が壊れても誰も気づかない（#4275 で「self-hosted でしか走らない step が main に到達して
// 初めて落ちた」のと同じ構造）。静的に固定しておく。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW = '.github/workflows/ci.yml';

/** `main-pr-base-guard` job の本文（次の job 定義までを job の範囲とする）。 */
function guardJobBody(): string {
	const workflow = readFileSync(CI_WORKFLOW, 'utf-8');
	const start = workflow.indexOf('  main-pr-base-guard:');
	expect(start, `${CI_WORKFLOW} に main-pr-base-guard job が無い`).toBeGreaterThan(-1);
	// job キーはインデント 2。次の「インデント 2 のキー」または comment 行までを本文とする。
	const rest = workflow.slice(start + 1);
	const nextJob = rest.search(/\n {2}(?:#|[a-z][a-z0-9-]*:)/);
	return nextJob < 0 ? rest : rest.slice(0, nextJob);
}

describe('#4273 main-pr-base-guard は「直し方」を出す', () => {
	const body = guardJobBody();

	it('dependabot / renovate の main 向け PR を fail-close する（#3922 の維持）', () => {
		// **本 test は既存挙動の維持確認**。ここが緩むと security 更新が main へ直行する。
		expect(body, 'dependabot / renovate の分岐が無い').toMatch(
			/dependabot\\\[bot\\\]\|renovate\\\[bot\\\]/,
		);
		const branch = body.slice(body.indexOf('dependabot'));
		expect(branch.slice(0, branch.indexOf('esac')), '分岐内で exit 1 していない').toContain(
			'exit 1',
		);
	});

	it('dependabot 分岐が retarget コマンドを出す（close + 再作成を第一手にしない）', () => {
		// **分岐の中を見る。** body 全体で `gh pr edit` を探すと、後段 (head 不一致) の
		// メッセージに引っかかって dependabot 側が空でも通ってしまう
		// （実際 mutation で素通りし、この assert の絞り込みで初めて red になった）。
		const start = body.indexOf('dependabot');
		const branch = body.slice(start, body.indexOf('esac', start));
		expect(
			branch,
			'dependabot 分岐に `gh pr edit <N> --base develop` が無い = 止めるだけで直し方を書かない guard',
		).toContain('gh pr edit');
		expect(branch, 'retarget 先が develop と書かれていない').toMatch(/--base\s+develop/);
		expect(branch, 'close して作り直す案内が第一手のまま残っている').not.toMatch(
			/close し、同 version/,
		);
	});

	it('head が develop / release/* / fix/* 以外のときも retarget を案内する', () => {
		// dependabot 以外の経路（人が誤って main 宛に出した PR）でも同じ直し方が要る。
		const tail = body.slice(body.lastIndexOf('main 向け PR の head'));
		expect(tail, 'head 不一致の fail メッセージに retarget コマンドが無い').toContain('gh pr edit');
	});
});
