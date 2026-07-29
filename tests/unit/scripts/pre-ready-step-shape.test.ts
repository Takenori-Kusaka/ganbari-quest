/**
 * tests/unit/scripts/pre-ready-step-shape.test.ts (#4086)
 *
 * 検証対象: pre-ready の step 追加が **1 箇所の登録**で完結すること。
 *
 * 旧実装では step を 1 つ足すのに 2 つの独立 registry (`skipStateOf()` 経由の skip 分類 +
 * `STEP_COST_CLASS_BY_NAME`) への同時登録が必要で、片方だけ直しても CI が回るまで気づけず、
 * PR #4066 が 2 度連続 red になった (#4086 実測)。
 *
 * 本 test は「step 定義オブジェクト 1 箇所に必須フィールドが揃っていなければ即 throw する」
 * という新しい単一強制点 (`assertStepShapes` / `orderSteps`) を固定する。既存の
 * `[O1]`〜`[O9]` (#4048) / `[K10]` (#4018) の強度は落とさない (ADR-0006):
 *   - 旧 [O1] (コストクラス登録漏れ検出) は [S2] が step 定義側で同じ不変条件を assert する
 *   - 旧 [O9] (未登録 step で throw) は [S4] が同じ throw を assert する (対象が広がっただけ)
 *
 * pre-ready.mjs は plain .mjs のため、他の pre-ready test と同じく子プロセスの dynamic import
 * 経由で実関数を呼ぶ (svelte-check の型 program に取り込ませないため)。
 */

// cspell:ignore skipkind statik
// 上記は意図的な負例 fixture。`no-skipkind-step` は skipKind を欠いた step 名、`statik` は
// costClass の typo を再現するための値であり、綴りを直すと negative case が成立しなくなる
// (= 登録漏れ / typo を検出できないことを検出できなくなる)。tests/CLAUDE.md §負例 fixture と cspell。

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const preReadyUrl = pathToFileURL(resolve(repoRoot, 'scripts/pre-ready.mjs')).href;

function evalInModule(expression: string): unknown {
	const code = `const m = await import(${JSON.stringify(preReadyUrl)});
process.stdout.write(JSON.stringify(${expression}));`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		encoding: 'utf8',
	});
	return JSON.parse(out);
}

const DEFAULT_ARGS = { pr: '4086' };

/** buildSteps の各 step から「関数以外の」フィールドを取り出す (JSON 化のため runner は有無だけ)。 */
function stepShapes(changedFiles: string[] = []): {
	name: string;
	costClass: string;
	skipKindPresent: boolean;
	hasRunner: boolean;
	hasFixHint: boolean;
	hasLabel: boolean;
	hasSkip: boolean;
}[] {
	return evalInModule(
		`m.buildSteps(${JSON.stringify(DEFAULT_ARGS)}, ${JSON.stringify(changedFiles)}).map((s) => ({
			name: s.name,
			costClass: s.costClass,
			skipKindPresent: 'skipKind' in s,
			hasRunner: typeof s.runner === 'function',
			hasFixHint: typeof s.fixHint === 'string',
			hasLabel: typeof s.label === 'string',
			hasSkip: typeof s.skip === 'boolean',
		}))`,
	) as ReturnType<typeof stepShapes>;
}

function requiredFields(): string[] {
	return evalInModule('m.REQUIRED_STEP_FIELDS') as string[];
}

function costClasses(): string[] {
	return evalInModule('m.STEP_COST_CLASSES') as string[];
}

/** assertStepShapes / orderSteps を呼び、throw した場合はその message を返す。 */
function throwMessage(expression: string): string | null {
	return evalInModule(
		`(() => { try { ${expression}; return null; } catch (e) { return e.message; } })()`,
	) as string | null;
}

describe('#4086 step 定義 1 箇所で登録が完結すること', () => {
	it('[S1] 必須フィールドの SSOT が step 定義の全項目を列挙している', () => {
		// 「どこに何を書けばよいか」を 1 箇所で読めることが本 Issue の主目的。
		expect(requiredFields().sort()).toEqual(
			['costClass', 'fixHint', 'label', 'name', 'runner', 'skip', 'skipKind'].sort(),
		);
	});

	it('[S2] 全 step が有効な costClass を step 定義自身に持つ (旧 [O1]/[O2] を定義側で担保)', () => {
		const classes = costClasses();
		const invalid = stepShapes()
			.filter((s) => !classes.includes(s.costClass))
			.map((s) => `${s.name}=${String(s.costClass)}`);
		expect(invalid).toEqual([]);
	});

	it('[S3] 全 step が必須フィールドを 1 つも欠かない', () => {
		const incomplete = stepShapes(['site/index.html', 'src/lib/ui/x.svelte']).filter(
			(s) =>
				!s.hasLabel ||
				!s.hasRunner ||
				!s.hasFixHint ||
				!s.hasSkip ||
				!s.skipKindPresent ||
				!s.costClass,
		);
		expect(incomplete).toEqual([]);
	});

	it('[S4] 不完全な step 定義は orderSteps が throw する (旧 [O9] の対象拡張)', () => {
		// costClass だけ欠けたケース (= #4048 の登録漏れと同じ症状)
		const missingCostClass = throwMessage(
			`m.orderSteps([{ name: 'brand-new-step', label: 'x', skip: false, skipKind: null, runner: () => 0, fixHint: 'x' }])`,
		);
		expect(missingCostClass).toContain('brand-new-step');
		expect(missingCostClass).toContain('costClass');

		// runner / fixHint 欠落も同じ 1 箇所で落ちる (2 registry 時代には検出できなかった)
		const missingRunner = throwMessage(
			`m.orderSteps([{ name: 'no-runner-step', label: 'x', costClass: 'static', skip: false, skipKind: null, fixHint: 'x' }])`,
		);
		expect(missingRunner).toContain('no-runner-step');
		expect(missingRunner).toContain('runner');

		// skipKind 欠落 = #4018 [K10] が防いでいた劣化。step shape でも落ちる (二重防御)
		const missingSkipKind = throwMessage(
			`m.orderSteps([{ name: 'no-skipkind-step', label: 'x', costClass: 'static', skip: false, runner: () => 0, fixHint: 'x' }])`,
		);
		expect(missingSkipKind).toContain('skipKind');
	});

	it('[S5] 不正な costClass 値も throw する (typo を silent に通さない)', () => {
		const msg = throwMessage(
			`m.orderSteps([{ name: 'typo-step', label: 'x', costClass: 'statik', skip: false, skipKind: null, runner: () => 0, fixHint: 'x' }])`,
		);
		expect(msg).toContain('typo-step');
		expect(msg).toContain('statik');
	});

	it('[S6] 第 2 registry (STEP_COST_CLASS_BY_NAME) が廃止されている', () => {
		// 残っていると「step 定義に書いたのに古い registry も要る」状態が復活する。
		const exists = evalInModule(`'STEP_COST_CLASS_BY_NAME' in m`) as boolean;
		expect(exists).toBe(false);
	});
});
