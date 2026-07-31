/**
 * tests/unit/scripts/pre-ready-order-and-base.test.ts (#4048 / #4046)
 *
 * 検証対象:
 *   1. #4048 — pre-ready の実行順が cheap-fail-first であること。
 *      Step 番号順にそのまま実行していたため、PR body の体裁ミス 1 つ (Step 9、ファイルを
 *      1 行も読まない検査) の検出に vitest / svelte-check の完走を待たされ 23 分を捨てていた。
 *      順序を変えても**検査の集合・合否条件は変わらない**ことと、将来 step を末尾に足しても
 *      順序が崩れないこと (登録漏れは throw) を固定する。
 *   2. #4046 — 変更集合の base 解決。lane whitelist (main / develop) 外の base を
 *      無条件で origin/main に clamp していたため、stacked PR で変更集合が実差分と一致せず、
 *      `uiChanged` が他 PR の .svelte 変更で YES になり SS embed gate が誤前提で走っていた。
 *
 * pre-ready.mjs は plain .mjs (未 JSDoc 型) のため、.ts test から静的 import すると
 * svelte-check の型 program に取り込まれ既存の implicit-any を大量に露出する。それを避けつつ
 * 実関数を検証するため、node 子プロセスの dynamic import 経由で呼び出す
 * (isMain guard により import 時に main() は走らない)。pre-ready-preflight.test.ts と同一手法。
 */

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const preReadyUrl = pathToFileURL(resolve(repoRoot, 'scripts/pre-ready.mjs')).href;
const baseBranchUrl = pathToFileURL(
	resolve(repoRoot, 'scripts/lib/ci/resolve-base-branch.mjs'),
).href;

/** 子プロセスで module を dynamic import し、式の評価結果を JSON で受け取る。 */
function evalInModule(moduleUrl: string, expression: string): unknown {
	const code = `const m = await import(${JSON.stringify(moduleUrl)});
process.stdout.write(JSON.stringify(${expression}));`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		encoding: 'utf8',
	});
	return JSON.parse(out);
}

/** `--pr` 指定あり / skip flag なしの既定 args (全 step が定義される条件)。 */
const DEFAULT_ARGS = { pr: '4048' };

/** buildSteps が返す step 名を定義順 (= Step 番号順) で取得する。 */
function definedStepNames(changedFiles: string[] = []): string[] {
	return evalInModule(
		preReadyUrl,
		`m.buildSteps(${JSON.stringify(DEFAULT_ARGS)}, ${JSON.stringify(changedFiles)}).map((s) => s.name)`,
	) as string[];
}

/** orderSteps 適用後の step 名を実行順で取得する。 */
function orderedStepNames(changedFiles: string[] = []): string[] {
	return evalInModule(
		preReadyUrl,
		`m.orderSteps(m.buildSteps(${JSON.stringify(DEFAULT_ARGS)}, ${JSON.stringify(changedFiles)})).map((s) => s.name)`,
	) as string[];
}

function costClasses(): string[] {
	return evalInModule(preReadyUrl, 'm.STEP_COST_CLASSES') as string[];
}

/**
 * step 名 → コストクラスの対応。
 *
 * #4086 で第 2 registry (`STEP_COST_CLASS_BY_NAME`) を廃止し、`costClass` は step 定義
 * オブジェクト自身が持つようになった。取得元が変わっただけで [O1]〜[O8] が固定する不変条件
 * (全 step が有効なクラスを持ち、実行順が単調非減少で、同一クラス内は定義順) は同一。
 * shape 不備そのものの検出は `pre-ready-step-shape.test.ts` [S2]〜[S5] が担う (#4086)。
 */
function costClassByName(changedFiles: string[] = []): Record<string, string> {
	return evalInModule(
		preReadyUrl,
		`Object.fromEntries(m.buildSteps(${JSON.stringify(DEFAULT_ARGS)}, ${JSON.stringify(changedFiles)}).map((s) => [s.name, s.costClass]))`,
	) as Record<string, string>;
}

describe('#4048 実行順が cheap-fail-first であること', () => {
	it('[O1] 全 step にコストクラスが登録されている (新 step の登録漏れを検出)', () => {
		const registry = costClassByName();
		const unregistered = definedStepNames().filter((name) => !(name in registry));
		expect(unregistered).toEqual([]);
	});

	it('[O2] コストクラスの値が STEP_COST_CLASSES のいずれかである', () => {
		const classes = costClasses();
		const invalid = Object.entries(costClassByName()).filter(([, c]) => !classes.includes(c));
		expect(invalid).toEqual([]);
	});

	it('[O3] 実行順のコストクラスが単調非減少である (安い順)', () => {
		const classes = costClasses();
		const registry = costClassByName();
		const ranks = orderedStepNames().map((name) => classes.indexOf(registry[name] ?? '(未登録)'));
		// 未登録があれば indexOf は -1 になり、単調非減少の assert より先にここで落とす
		expect(ranks.every((r) => r >= 0)).toBe(true);
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
	});

	it('[O4] PR body 検査 (pr-body) が静的検査 / 型検査より先に走る (AC1 の核)', () => {
		// #4121 で vitest step は CI unit-test へ移したため、比較対象は残る最重量 step (svelte-check)。
		const order = orderedStepNames();
		expect(order.indexOf('pr-body')).toBeGreaterThanOrEqual(0);
		expect(order.indexOf('pr-body')).toBeLessThan(order.indexOf('biome'));
		expect(order.indexOf('pr-body')).toBeLessThan(order.indexOf('svelte-check'));
	});

	it('[O5] pr-body が実行順の先頭である (ファイルを読まない検査が最初)', () => {
		expect(orderedStepNames()[0]).toBe('pr-body');
	});

	it('[O6] meta → 静的検査 → 型検査 → UI 系 の相対順序を保つ', () => {
		const order = orderedStepNames(['site/index.html', 'src/lib/ui/x.svelte']);
		// LP / UI 変更ありの step 集合でも全 step にクラスが付いていること (旧 [O1] の条件付き step 分)
		const classes = costClasses();
		expect(
			Object.entries(costClassByName(['site/index.html', 'src/lib/ui/x.svelte'])).filter(
				([, c]) => !classes.includes(c),
			),
		).toEqual([]);
		const at = (n: string) => order.indexOf(n);
		// #4121: test / browser クラスの step は CI へ移したため、残る鎖は meta → static → typecheck → ui
		expect(at('pr-body')).toBeLessThan(at('biome'));
		expect(at('biome')).toBeLessThan(at('svelte-check'));
		expect(at('plan-literals')).toBeLessThan(at('svelte-check'));
		expect(at('local-tz-getters')).toBeLessThan(at('svelte-check'));
		expect(at('svelte-check')).toBeLessThan(at('ss-embed-gate'));
	});

	it('[O7] 並べ替えで step の集合が変わらない (AC2 — 検査を増減させていない)', () => {
		const defined = definedStepNames();
		const ordered = orderedStepNames();
		expect(ordered.length).toBe(defined.length);
		expect([...ordered].sort()).toEqual([...defined].sort());
	});

	it('[O8] 同一クラス内は定義順 (Step 番号順) を保つ安定ソート', () => {
		const registry = costClassByName();
		const defined = definedStepNames();
		const ordered = orderedStepNames();
		const staticDefined = defined.filter((n) => registry[n] === 'static');
		const staticOrdered = ordered.filter((n) => registry[n] === 'static');
		expect(staticOrdered).toEqual(staticDefined);
	});

	it('[O9] コストクラス未登録の step は throw する (末尾に黙って足させない)', () => {
		const thrown = evalInModule(
			preReadyUrl,
			`(() => { try { m.orderSteps([{ name: 'brand-new-step' }]); return null; } catch (e) { return e.message; } })()`,
		) as string | null;
		expect(thrown).toContain('brand-new-step');
		// #4086: 未登録の指摘先は「第 2 registry」ではなく step 定義自身の costClass になった
		expect(thrown).toContain('costClass');
		expect(thrown).toContain('buildSteps');
	});
});

describe('#4046 変更集合の base 解決 (stacked PR で実差分と一致させる)', () => {
	/** resolveDiffBase を呼ぶ。refExists は「存在する ref 名の集合」で表現する。 */
	function resolveDiffBase(
		base: string,
		existingRefs: string[],
	): { base: string; clamped: boolean; reason: string | null } {
		return evalInModule(
			preReadyUrl,
			`m.resolveDiffBase({ base: ${JSON.stringify(base)}, refExists: (b) => ${JSON.stringify(existingRefs)}.includes(b) })`,
		) as { base: string; clamped: boolean; reason: string | null };
	}

	it('[B1] stacked PR の base (lane 外) でも ref が存在すればそのまま使う', () => {
		const stackedBase = 'fix/3997-4001-hook-gate-defects';
		const r = resolveDiffBase(stackedBase, ['main', 'develop', stackedBase]);
		expect(r).toEqual({ base: stackedBase, clamped: false, reason: null });
	});

	it('[B2] develop / main はそのまま (既存挙動の回帰ガード)', () => {
		expect(resolveDiffBase('develop', ['main', 'develop']).base).toBe('develop');
		expect(resolveDiffBase('main', ['main', 'develop']).base).toBe('main');
		expect(resolveDiffBase('develop', ['main', 'develop']).clamped).toBe(false);
	});

	it('[B3] ref がローカルに無い base は main に clamp し、その事実を返す', () => {
		const r = resolveDiffBase('fix/not-fetched-yet', ['main', 'develop']);
		expect(r).toEqual({ base: 'main', clamped: true, reason: 'ref-missing' });
	});

	it('[B4] shell メタ文字を含む base は ref 存在確認より先に弾く (injection 防御、#2982 の目的)', () => {
		// refExists が呼ばれたら true を返す実装にしても、safe 判定で先に落ちる
		const r = evalInModule(
			preReadyUrl,
			`m.resolveDiffBase({ base: 'main; rm -rf /', refExists: () => true })`,
		) as { base: string; clamped: boolean; reason: string | null };
		expect(r).toEqual({ base: 'main', clamped: true, reason: 'unsafe-name' });
	});

	it('[B5] clamp 注記が「実差分と一致しない」と「条件付き step への影響」を明示する (AC1 / AC2)', () => {
		const note = evalInModule(
			preReadyUrl,
			`m.buildBaseClampNote('fix/not-fetched-yet', 'ref-missing')`,
		) as string;
		expect(note).toContain('実差分と一致していません');
		expect(note).toContain('条件付き step');
		expect(note).toContain('ss-embed-gate');
		expect(note).toContain('#4046');
	});

	it('[B6] isSafeGitRefName は git refname として不正な形も弾く', () => {
		const check = (name: string) =>
			evalInModule(baseBranchUrl, `m.isSafeGitRefName(${JSON.stringify(name)})`) as boolean;
		expect(check('fix/4046-base')).toBe(true);
		expect(check('release/1.2.3')).toBe(true);
		expect(check('main')).toBe(true);
		expect(check('')).toBe(false);
		expect(check('feat/../../etc')).toBe(false);
		expect(check('--upload-pack=evil')).toBe(false);
		expect(check('/leading-slash')).toBe(false);
		expect(check('feat/$(whoami)')).toBe(false);
		expect(check('feat/a b')).toBe(false);
	});

	it('[B7] isAllowedBaseBranch は lane 判定として残っている (--verify-base 用、責務分離)', () => {
		const check = (name: string) =>
			evalInModule(baseBranchUrl, `m.isAllowedBaseBranch(${JSON.stringify(name)})`) as boolean;
		expect(check('main')).toBe(true);
		expect(check('develop')).toBe(true);
		expect(check('fix/4046-base')).toBe(false);
	});
});
