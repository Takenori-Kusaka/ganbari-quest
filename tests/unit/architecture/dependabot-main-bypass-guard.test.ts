// tests/unit/architecture/dependabot-main-bypass-guard.test.ts
// #4544 — dependabot の main 直行を止める装置に fail-open を作らない。
//
// ## 何を守る test か
//
// dependabot の **security 更新** は `.github/dependabot.yml` の `target-branch: develop` を
// 無視して default branch (= main) に PR を作る（GitHub 仕様。設定では直せない）。
// #3190 / #3920 / #4251 / #4271 / #4272 / #4422 / #4532 と再発し続けている class で、
// 止める装置は #3922（fail-close）/ #4273（retarget コマンドの案内）で既に入っている。
//
// 本 test が固定するのは、その装置に残っていた **2 つの fail-open** である:
//
//   [G1] `main-pr-base-guard` の bot 分岐が repository variable `BRANCH_STRATEGY_CUTOVER_AT` の
//        早期 exit より **前** にあること。旧実装は後ろにあり、variable が未設定 / 改名 / typo に
//        なった瞬間に bot の main 直行検出まで道連れで黙って消えていた。cutover の grandfather は
//        「人が作った既存 open PR を止めない」ための経過措置であり、bot の main 直行とは無関係。
//   [G2] `dependabot-auto-merge.yml` の auto-merge 起動が base=develop に限定されていること。
//        main 向け PR に auto-merge を武装したまま置くと、guard の条件が変わった瞬間に監査を
//        通らないまま main へ merge = 本番 deploy が走る（PR #4532 で武装しなかったのは
//        「人の commit を検出した」偶然の副作用であり、base を見た結果ではない）。
//
// ## なぜ workflow の文字列を test で見るのか
//
// この 2 つの条件は **bot が main 向け PR を作ったときにしか評価されない**。通常の PR では
// 1 度も通らないため、条件が緩んでも誰も気づかない。静的に固定しておく
// （`main-pr-base-guard-message.test.ts`（#4273）と同じ理由。あちらは「fail メッセージが
// 直し方を出しているか」、本 test は「そもそも fail に到達するか」で観点が異なる）。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW = '.github/workflows/ci.yml';
const AUTO_MERGE_WORKFLOW = '.github/workflows/dependabot-auto-merge.yml';

/** `main-pr-base-guard` job の本文（次の job 定義までを job の範囲とする）。 */
function guardJobBody(): string {
	const workflow = readFileSync(CI_WORKFLOW, 'utf-8');
	const start = workflow.indexOf('  main-pr-base-guard:');
	expect(start, `${CI_WORKFLOW} に main-pr-base-guard job が無い`).toBeGreaterThan(-1);
	const rest = workflow.slice(start + 1);
	const nextJob = rest.search(/\n {2}(?:#|[a-z][a-z0-9-]*:)/);
	return nextJob < 0 ? rest : rest.slice(0, nextJob);
}

describe('#4544 dependabot の main 直行 guard に fail-open を作らない', () => {
	it('[G1] bot 分岐は CUTOVER_AT の早期 exit より前にある（variable 未設定でも bot を止める）', () => {
		const body = guardJobBody();

		const botBranch = body.indexOf('dependabot\\[bot\\]|renovate\\[bot\\]');
		expect(botBranch, 'bot 分岐が無い（#3922 の fail-close が消えている）').toBeGreaterThan(-1);

		// CUTOVER_AT 未設定時に早期 exit する箇所（`if [ -z "$CUTOVER_AT" ]`）。
		const cutoverEarlyExit = body.indexOf('-z "$CUTOVER_AT"');
		expect(cutoverEarlyExit, 'CUTOVER_AT の早期 exit が見つからない').toBeGreaterThan(-1);

		expect(
			botBranch,
			'bot 分岐が CUTOVER_AT 早期 exit より後ろにある = repository variable を外すだけで ' +
				'dependabot の main 直行検出が黙って無効化される（#4544 が塞いだ fail-open の再混入）',
		).toBeLessThan(cutoverEarlyExit);
	});

	it('[G1] bot 分岐は grandfather（PR 作成日時比較）より前にある', () => {
		const body = guardJobBody();
		const botBranch = body.indexOf('dependabot\\[bot\\]|renovate\\[bot\\]');
		const grandfather = body.indexOf('$PR_CREATED_AT');
		expect(grandfather, 'grandfather 判定が見つからない').toBeGreaterThan(-1);
		expect(
			botBranch,
			'bot 分岐が grandfather より後ろにある = cutover 前に作られた bot PR が免除される',
		).toBeLessThan(grandfather);
	});

	it('[G2] auto-merge の起動は base=develop に限定されている', () => {
		const workflow = readFileSync(AUTO_MERGE_WORKFLOW, 'utf-8');
		const enableStep = workflow.indexOf('Enable auto-merge');
		expect(enableStep, `${AUTO_MERGE_WORKFLOW} に auto-merge 起動 step が無い`).toBeGreaterThan(-1);

		// step 名から `gh pr merge --auto` までが起動 step の条件範囲。
		const mergeCall = workflow.indexOf('gh pr merge --auto', enableStep);
		expect(mergeCall, 'auto-merge を起動する `gh pr merge --auto` が無い').toBeGreaterThan(-1);
		const stepBody = workflow.slice(enableStep, mergeCall);

		expect(
			stepBody,
			'auto-merge 起動 step が base を判定していない = main 向け dependabot PR に auto-merge が ' +
				'武装し、guard の条件が変わった瞬間に監査を通らず main へ merge されうる（#4544）',
		).toMatch(/github\.event\.pull_request\.base\.ref\s*==\s*'develop'/);
	});
});
