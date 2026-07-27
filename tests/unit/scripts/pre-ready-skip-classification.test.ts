// tests/unit/scripts/pre-ready-skip-classification.test.ts
// #4018 — pre-ready が「条件による自動 skip」と「--skip 指定」を区別する。
//
// ## 何が壊れていたか
//
// `pre-ready.mjs` は両者を同じ `skipped[]` に入れており、`--skip-*` を 1 つも渡していない
// 実行でも summary が `PARTIAL PASS — N step が --skip 指定で未実行です` になっていた。
// `lp-dimensions` は `site/**` を触る PR でしか実行されないため、**LP を触らない PR は
// 原理的に ALL PASS を表示できない**。summary 自身が「Ready 化には skip なしの全 step PASS
// が必要」と書くので、到達不能な条件を Ready 化要件として提示する状態だった。
//
// 実害は既に出ている: merge 済 #4011 (変更 3 file、LP 0 件) の PR body には
// 「pre-ready 全 Step PASS」の `[x]` が 2 箇所あるが、実際の出力は PARTIAL PASS だった。
// tool の出力と self-report が食い違ったまま merge されている (#4006 が指す
// 「証跡なしの自己申告」が tool 側の欠陥によって強制されている形)。
//
// ## 本 test が固定すること
//
// 「適用対象外だけなら ALL PASS」と「--skip 指定があれば PARTIAL PASS」の両方。
// 片方だけだと、分類を捨てて常に ALL PASS を返す修正でも緑になってしまう。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — .mjs (JSDoc 型) を TS から読む。他の scripts 系 test と同じ扱い
import { buildSummary, skipStateOf } from '../../../scripts/pre-ready.mjs';

describe('#4018 skipStateOf — skip 理由の分類', () => {
	it('[K1] --skip flag が最優先で flag に分類される', () => {
		// 明示 skip したのに「適用対象外」と表示すると、skip した事実が summary から消える
		expect(skipStateOf({ byFlag: true, notApplicable: true })).toEqual({
			skip: true,
			skipKind: 'flag',
		});
		expect(skipStateOf({ byFlag: true, scriptMissing: true })).toEqual({
			skip: true,
			skipKind: 'flag',
		});
	});

	it('[K2] 検査 script 未配備は script-missing (gate 不在なので n/a 扱いにしない)', () => {
		expect(skipStateOf({ scriptMissing: true })).toEqual({
			skip: true,
			skipKind: 'script-missing',
		});
	});

	it('[K3] 変更内容が対象外なら n/a', () => {
		expect(skipStateOf({ notApplicable: true })).toEqual({ skip: true, skipKind: 'n/a' });
	});

	it('[K4] どの理由も無ければ skip しない', () => {
		expect(skipStateOf({})).toEqual({ skip: false, skipKind: null });
	});
});

describe('#4018 buildSummary — ALL PASS 到達可能性', () => {
	// **これが本 Issue の中核。** LP を触らない PR (= 大半の PR) が ALL PASS に到達できること。
	it('[K5] 適用対象外のみの実行は ALL PASS になる (AC1)', () => {
		const summary = buildSummary({
			totalSteps: 17,
			skippedByFlag: [],
			skippedScriptMissing: [],
			skippedNotApplicable: ['lp-dimensions'],
			pr: '3996',
		});
		expect(summary.status).toBe('ALL_PASS');
		expect(summary.text).toContain('ALL PASS');
		// 「--skip 指定」という誤った説明を出さないこと (本 Issue の表面症状)
		expect(summary.text).not.toContain('--skip 指定');
	});

	it('[K6] --skip flag 指定時は PARTIAL PASS のまま (AC2、#3649 の意図を壊さない)', () => {
		const summary = buildSummary({
			totalSteps: 17,
			skippedByFlag: ['vitest'],
			skippedScriptMissing: [],
			skippedNotApplicable: ['lp-dimensions'],
			pr: '3996',
		});
		expect(summary.status).toBe('PARTIAL_PASS');
		expect(summary.text).toContain('PARTIAL PASS');
		expect(summary.text).toContain('vitest');
	});

	it('[K7] 適用対象外と明示 skip を別行で表示する (AC3)', () => {
		const summary = buildSummary({
			totalSteps: 17,
			skippedByFlag: ['vitest'],
			skippedScriptMissing: [],
			skippedNotApplicable: ['lp-dimensions', 'capture'],
			pr: '3996',
		});
		const skipLine = summary.text.split('\n').find((l) => l.includes('--skip 指定'));
		const naLine = summary.text.split('\n').find((l) => l.includes('適用対象外'));
		expect(skipLine).toBeDefined();
		expect(naLine).toBeDefined();
		expect(skipLine).not.toBe(naLine);
		// 適用対象外の step 名が「未実行の skip」側に混ざっていないこと
		expect(skipLine).not.toContain('lp-dimensions');
		expect(naLine).toContain('lp-dimensions');
	});

	it('[K8] 検査 script 未配備は ALL PASS を名乗らせない (gate 不在の silent pass 防止)', () => {
		const summary = buildSummary({
			totalSteps: 17,
			skippedByFlag: [],
			skippedScriptMissing: ['plan-literals'],
			skippedNotApplicable: [],
			pr: '3996',
		});
		expect(summary.status).toBe('PARTIAL_PASS');
		expect(summary.text).toContain('検査 script 未配備');
	});

	it('[K9] 実行 step 数から適用対象外と skip の両方が差し引かれる', () => {
		const summary = buildSummary({
			totalSteps: 17,
			skippedByFlag: ['vitest'],
			skippedScriptMissing: [],
			skippedNotApplicable: ['lp-dimensions', 'capture'],
			pr: '3996',
		});
		expect(summary.text).toContain('実行した 14 step');
	});
});

describe('#4018 回帰 gate — 新しい step が分類を迂回しないこと', () => {
	// 分類は step 定義側で `...skipStateOf({...})` を spread することで成立する。
	// 新しい step が `skip: args.skipX || !cond` を直書きすると skipKind が undefined になり、
	// 集計ループの else 分岐で n/a に落ちる = **明示 skip が ALL PASS を妨げなくなる**。
	// その方向の劣化は summary が緑になるだけで誰も気づけないため、ソース側で禁じる。
	it('[K10] buildSteps 内に skip: の直書きが残っていない', () => {
		const src = readFileSync(resolve(process.cwd(), 'scripts/pre-ready.mjs'), 'utf8');
		const offenders = src
			.split('\n')
			.map((line, i) => ({ line: line.trim(), no: i + 1 }))
			.filter(({ line }) => /^skip:\s/.test(line));
		expect(offenders).toEqual([]);
	});
});
