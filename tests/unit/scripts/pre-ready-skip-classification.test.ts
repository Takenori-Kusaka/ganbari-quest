/**
 * tests/unit/scripts/pre-ready-skip-classification.test.ts (#4018)
 *
 * ## 何が壊れていたか
 *
 * `pre-ready.mjs` は「条件による自動 skip」と「`--skip-*` flag による明示 skip」を同じ
 * `skipped[]` に入れており、`--skip-*` を 1 つも渡していない実行でも summary が
 * `PARTIAL PASS — N step が --skip 指定で未実行です` になっていた。
 *
 * `lp-dimensions` は `site/` 配下を触る PR でしか実行されないため、**LP を触らない PR は
 * 原理的に ALL PASS を表示できない**。summary 自身が「Ready 化には skip なしの全 step PASS
 * が必要」と書くので、到達不能な条件を Ready 化要件として提示する状態だった。
 *
 * 実害は既に出ている: merge 済 #4011 (変更 3 file、LP 0 件) の PR body には
 * 「pre-ready 全 Step PASS」の `[x]` が 2 箇所あるが、実際の出力は PARTIAL PASS だった。
 * tool の出力と self-report が食い違ったまま merge されている (#4006 が指す
 * 「証跡なしの自己申告」が tool 側の欠陥によって強制されている形)。
 *
 * ## 本 test が固定すること
 *
 * 「適用対象外だけなら ALL PASS」と「--skip 指定があれば PARTIAL PASS」の両方。
 * 片方だけだと、分類を捨てて常に ALL PASS を返す修正でも緑になってしまう。
 *
 * ## 呼び出し方式
 *
 * `pre-ready.mjs` は plain .mjs (未 JSDoc 型) で、.ts から静的 import すると svelte-check の
 * 型 program に取り込まれ既存の implicit-any を大量に露出する。`pre-ready-preflight.test.ts`
 * (#3857) と同じく node 子プロセスの dynamic import 経由で呼ぶ (isMain guard により
 * import 時に main() は走らない)。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const preReadyUrl = pathToFileURL(resolve(repoRoot, 'scripts/pre-ready.mjs')).href;

/** pre-ready.mjs の named export を子プロセスで呼び、戻り値を JSON で受け取る。 */
function callExport<T>(fnName: string, arg: unknown): T {
	const code = `const m = await import(${JSON.stringify(preReadyUrl)});
process.stdout.write(JSON.stringify(m[${JSON.stringify(fnName)}](${JSON.stringify(arg)})));`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		encoding: 'utf8',
	});
	return JSON.parse(out) as T;
}

type SkipKind = 'flag' | 'script-missing' | 'pr-missing' | 'n/a' | null;
type SkipState = { skip: boolean; skipKind: SkipKind };
type Summary = { status: 'ALL_PASS' | 'PARTIAL_PASS'; text: string };
type StepShape = { name: string; skip: boolean; skipKind: SkipKind };

const skipStateOf = (arg: Record<string, boolean>) => callExport<SkipState>('skipStateOf', arg);
const buildSummary = (arg: Record<string, unknown>) => callExport<Summary>('buildSummary', arg);

/**
 * `buildSteps(args, changedFiles)` を子プロセスで呼び、name / skip / skipKind だけを取り出す。
 * step は runner (関数) を含むため JSON 直列化できず callExport が使えない。
 */
function buildStepShapes(args: Record<string, unknown>, changedFiles: string[]): StepShape[] {
	const code = `const m = await import(${JSON.stringify(preReadyUrl)});
const steps = m.buildSteps(${JSON.stringify(args)}, ${JSON.stringify(changedFiles)});
process.stdout.write(JSON.stringify(steps.map((s) => ({ name: s.name, skip: !!s.skip, skipKind: s.skipKind ?? null }))));`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		encoding: 'utf8',
	});
	return JSON.parse(out) as StepShape[];
}

/** Readiness gate 系 (`--pr` を前提とする 3 step) */
const READINESS_GATE_STEPS = ['pr-body', 'ss-embed-gate', 'capture'] as const;

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

	it('[K11] 前提 (--pr) 未充足は pr-missing で、n/a より優先される', () => {
		// `--pr` は「渡せば必ず実行できる前提」であり「内容的に適用対象外」ではない。
		// n/a に落とすと Readiness gate 未実行のまま ALL PASS を名乗れてしまう (#4018 QM 指摘)。
		expect(skipStateOf({ prMissing: true })).toEqual({ skip: true, skipKind: 'pr-missing' });
		expect(skipStateOf({ prMissing: true, notApplicable: true })).toEqual({
			skip: true,
			skipKind: 'pr-missing',
		});
		// flag / script-missing は pr-missing より優先 (明示 skip / gate 不在の事実を消さない)
		expect(skipStateOf({ byFlag: true, prMissing: true })).toEqual({
			skip: true,
			skipKind: 'flag',
		});
		expect(skipStateOf({ scriptMissing: true, prMissing: true })).toEqual({
			skip: true,
			skipKind: 'script-missing',
		});
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
		const lines = summary.text.split('\n');
		const skipLine = lines.find((l) => l.includes('--skip 指定'));
		const naLine = lines.find((l) => l.includes('適用対象外'));
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

	it('[K12] --pr 未指定で Readiness gate 系が未実行なら PARTIAL PASS のまま', () => {
		const summary = buildSummary({
			totalSteps: 17,
			skippedByFlag: [],
			skippedScriptMissing: [],
			skippedPrMissing: ['pr-body'],
			skippedNotApplicable: ['lp-dimensions'],
			pr: null,
		});
		expect(summary.status).toBe('PARTIAL_PASS');
		expect(summary.text).toContain('PARTIAL PASS');
		expect(summary.text).toContain('--pr 未指定');
		expect(summary.text).toContain('pr-body');
		// 「--skip 指定」と誤って説明しない (#4018 の本旨は分類の正確さ)
		expect(summary.text).not.toContain('--skip 指定');
		// 適用対象外側に混ぜない (混ぜると ALL PASS を妨げなくなる)
		const naLine = summary.text.split('\n').find((l) => l.includes('適用対象外'));
		expect(naLine).toBeDefined();
		expect(naLine).not.toContain('pr-body');
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

describe('#4018 QM 指摘 — --pr 未指定は ALL PASS を名乗れない (Readiness gate 素通り防止)', () => {
	/** main() と同じ手順で step 分類 → summary を組み立てる (配線ごと検証する)。 */
	function summarizeRun(args: Record<string, unknown>, changedFiles: string[]): Summary {
		const steps = buildStepShapes(args, changedFiles);
		const pick = (kind: SkipKind) =>
			steps.filter((s) => s.skip && s.skipKind === kind).map((s) => s.name);
		return buildSummary({
			totalSteps: steps.length,
			skippedByFlag: pick('flag'),
			skippedScriptMissing: pick('script-missing'),
			skippedPrMissing: pick('pr-missing'),
			skippedNotApplicable: pick('n/a'),
			pr: args.pr ?? null,
		});
	}

	it('[K13] --pr 未指定なら Readiness gate 3 step が blocking (pr-missing) に分類される', () => {
		// UI 変更あり = 3 step すべてが本来実行対象。`--pr` を渡していないだけなので n/a ではない。
		const steps = buildStepShapes({ pr: null }, ['src/routes/foo/+page.svelte']);
		for (const name of READINESS_GATE_STEPS) {
			const step = steps.find((s) => s.name === name);
			expect(step, `step ${name} が見つからない`).toBeDefined();
			expect(step?.skip, `step ${name} は --pr 未指定で skip されるはず`).toBe(true);
			expect(step?.skipKind, `step ${name} を n/a にすると ALL PASS を妨げなくなる`).toBe(
				'pr-missing',
			);
		}
	});

	it('[K14] --pr 未指定の実行は (UI 変更の有無に関わらず) PARTIAL PASS になる', () => {
		// 本 PR 自身と同型のケース: LP / UI を触らない script 修正 PR で `npm run pre-ready` を素で叩く。
		const nonUi = summarizeRun({ pr: null }, ['scripts/pre-ready.mjs']);
		expect(nonUi.status).toBe('PARTIAL_PASS');
		expect(nonUi.text).toContain('--pr 未指定');
		expect(nonUi.text).toContain('pr-body');
		// Ready 化案内 (gh pr ready) を出さないこと = 抜け穴が塞がっている証跡
		expect(nonUi.text).not.toContain('Ready for Review に進めます');

		const uiChanged = summarizeRun({ pr: null }, ['src/routes/foo/+page.svelte']);
		expect(uiChanged.status).toBe('PARTIAL_PASS');
		expect(uiChanged.text).toContain('ss-embed-gate');
	});

	it('[K15] --pr 指定 + LP/UI 非変更なら ALL PASS に到達できる (#4018 本来の成果を壊さない)', () => {
		// 条件 skip (lp-dimensions / ss-embed-gate / capture 等) は n/a のままで ALL PASS を妨げない。
		const summary = summarizeRun({ pr: '4037' }, ['scripts/pre-ready.mjs']);
		expect(summary.status).toBe('ALL_PASS');
		expect(summary.text).toContain('適用対象外');
		expect(summary.text).not.toContain('--pr 未指定');
	});
});

describe('#4018 回帰 gate — 新しい step が分類を迂回しないこと', () => {
	// 分類は step 定義側で `...skipStateOf({...})` を spread することで成立する。
	// 新しい step が `skip: args.skipX || !cond` を直書きすると skipKind が undefined になり、
	// 集計ループの else 分岐で n/a に落ちる = **明示 skip が ALL PASS を妨げなくなる**。
	// その方向の劣化は summary が緑になるだけで誰も気づけないため、ソース側で禁じる。
	it('[K10] buildSteps 内に skip: の直書きが残っていない', () => {
		const src = readFileSync(resolve(repoRoot, 'scripts/pre-ready.mjs'), 'utf8');
		const offenders = src
			.split('\n')
			.map((line, i) => ({ line: line.trim(), no: i + 1 }))
			.filter(({ line }) => /^skip:\s/.test(line));
		expect(offenders).toEqual([]);
	});
});
