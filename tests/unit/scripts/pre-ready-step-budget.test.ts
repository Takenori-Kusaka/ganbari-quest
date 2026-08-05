/**
 * tests/unit/scripts/pre-ready-step-budget.test.ts (#4121 E5 Wave 2)
 *
 * 検証対象:
 *   1. pre-ready の hard-fail step が **6 本ちょうど**であること (ADR-0007 §1-2 判断原則 v2)。
 *      20 本まで増えた結果 1 PR が 1 日で回らなくなったため、類型 1 (証跡の真正性) と
 *      類型 2 (顧客に見える正しさ) のうち安価なものだけを残し、残りは CI へ寄せた。
 *      **「6 本に無い = 検査を消した」ではない**。外した step は CI 側で hard-fail のまま走る。
 *   2. 外した重量 step (vitest / LP ブラウザ実測) が pre-ready に戻ってこないこと。
 *      戻ると 300 秒予算が即座に壊れる (vitest 単独でローカル実測 1753s、#4007)。
 *   3. `check-lp-plan-sync` が CI で hard-fail であること (類型 2 = 顧客に見える正しさ / LP の嘘)。
 *      #4121 で一度 `continue-on-error: true` に降格したが、cheap な類型 2 は hard-fail が正。
 *
 * pre-ready.mjs は plain .mjs のため、.ts test から静的 import すると svelte-check の型 program に
 * 取り込まれる。既存 pre-ready-*.test.ts と同じく node 子プロセスの dynamic import 経由で呼ぶ。
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const preReadyUrl = pathToFileURL(resolve(repoRoot, 'scripts/pre-ready.mjs')).href;

/**
 * pre-ready が hard-fail として残す 6 step (#4121)。
 *
 * | step             | ADR-0007 §1-2 類型 | 残す理由 |
 * |------------------|-------------------|----------|
 * | pr-body          | 1 証跡の真正性     | Ready checklist / AC 証跡 / 禁止語。Ready 化そのものの前提 |
 * | ss-embed-gate    | 1 証跡の真正性     | UI 変更 PR の SS 証跡。Ready 化後に CI が言っても往復が増えるだけ |
 * | biome            | 2 顧客に見える正しさ | recommended の correctness / suspicious (noImportCycles 等) を含む。数十秒 |
 * | svelte-check     | 2 顧客に見える正しさ | 型エラー = 実行時破綻。ローカルで回さないと CI 往復が最も高くつく |
 * | plan-literals    | 2 顧客に見える正しさ | プラン名・状態の直書き = 顧客に見える誤表示 (ADR-0045) |
 * | local-tz-getters | 2 顧客に見える正しさ | ローカル TZ 由来の日付ずれ = 顧客に見える誤り (#4015) |
 */
const KEEP_STEPS = [
	'biome',
	'svelte-check',
	'plan-literals',
	'local-tz-getters',
	'pr-body',
	'ss-embed-gate',
] as const;

/** pre-ready から外し、CI 側 hard-fail に委ねた step 名 (pre-ready に戻さない)。 */
const MOVED_TO_CI = [
	'cspell',
	'vitest',
	'hardcoded-strings',
	'lp-dimensions',
	'lp-fallback',
	'license-key-leak',
	'cli-entry-guard',
	'sparse-checkout-closure',
	'readdir-rotation-guard',
	'repo-scan-test-declaration',
	'lp-labels',
	'doc-code-references',
	'terminology-coherence',
] as const;

type StepShape = { name: string; costClass: string; skip: boolean };

function buildStepShapes(args: Record<string, unknown>, changedFiles: string[] = []): StepShape[] {
	const code = `const m = await import(${JSON.stringify(preReadyUrl)});
const steps = m.buildSteps(${JSON.stringify(args)}, ${JSON.stringify(changedFiles)});
process.stdout.write(JSON.stringify(steps.map((s) => ({ name: s.name, costClass: s.costClass, skip: !!s.skip }))));`;
	return JSON.parse(
		execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }),
	) as StepShape[];
}

describe('#4121 pre-ready の hard-fail step は 6 本', () => {
	it('[P1] buildSteps がちょうど keep 6 step を返す', () => {
		const names = buildStepShapes({ pr: '4121' }).map((s) => s.name);
		expect([...names].sort()).toEqual([...KEEP_STEPS].sort());
	});

	it('[P2] LP / UI 変更ありの入力でも step が増えない (条件付き step を足し戻していない)', () => {
		const names = buildStepShapes({ pr: '4121' }, [
			'site/index.html',
			'src/lib/domain/labels.ts',
			'src/lib/domain/validation/age-tier.ts',
			'src/routes/foo/+page.svelte',
		]).map((s) => s.name);
		expect([...names].sort()).toEqual([...KEEP_STEPS].sort());
	});

	it('[P3] CI へ寄せた step が pre-ready に戻っていない (300 秒予算の回帰ガード)', () => {
		const names = new Set(buildStepShapes({ pr: '4121' }).map((s) => s.name));
		expect(MOVED_TO_CI.filter((n) => names.has(n))).toEqual([]);
	});

	it('[P4] 残す 6 本に重量クラス (test / browser) が含まれない', () => {
		const heavy = buildStepShapes({ pr: '4121' }, ['site/index.html']).filter((s) =>
			['test', 'browser'].includes(s.costClass),
		);
		expect(heavy).toEqual([]);
	});

	it('[P5] 6 本すべてが --skip-* flag を持つ (skip 分類を迂回する step がない)', () => {
		const allSkipped = buildStepShapes(
			{
				pr: '4121',
				skipBiome: true,
				skipSvelteCheck: true,
				skipPlanLiterals: true,
				skipLocalTzGetters: true,
				skipPrBody: true,
				skipSsEmbedGate: true,
			},
			['src/routes/foo/+page.svelte'],
		);
		expect(allSkipped.filter((s) => !s.skip).map((s) => s.name)).toEqual([]);
	});
});
