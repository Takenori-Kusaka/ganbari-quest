/**
 * pre-ready の base 鮮度検査 (#4390)
 *
 * 背景 (実測): #4322 が develop 側で PR テンプレートを 11 → 7 セクションに作り替えたあと、
 * 旧構成のまま残っていた 6 PR が rebase した瞬間に `必須セクションの存在確認` で全滅した。
 * branch tip では「旧 SSOT と旧 body」が整合しているため pre-ready は PASS を返し、
 * rebase して初めて赤になる。pre-ready が branch を単体でしか見ておらず、
 * **base の移動で自分の判定が黙って無効になることを検出できない**のが根本原因。
 *
 * 本 test は判定の中核 (`classifyBaseDrift` / `isGateSsotPath`) を pin する:
 *   - base が動いていない通常ケースを止めない (回帰。ここで止まると全 PR が止まる)
 *   - base は動いたが検査基準は動いていない → 警告のみ (日に何度も動くので止めない)
 *   - base が動き、かつ **pre-ready の検査基準そのもの** が動いた → BLOCK (#4322 の実害形)
 *
 * ## 呼び出し方式
 *
 * `pre-ready.mjs` は plain .mjs (未 JSDoc 型) で、.ts から静的 import すると svelte-check の
 * 型 program に取り込まれ既存の implicit-any を大量に露出する (実測 31 errors)。
 * `pre-ready-skip-classification.test.ts` (#4018) と同じく node 子プロセスの dynamic import
 * 経由で呼ぶ (isMain guard により import 時に main() は走らない)。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..');
const preReadyUrl = pathToFileURL(resolve(repoRoot, 'scripts/pre-ready.mjs')).href;

/** pre-ready.mjs の named export を子プロセスで呼び、戻り値を JSON で受け取る。 */
function callExport<T>(fnName: string, ...args: unknown[]): T {
	const argList = args.map((a) => JSON.stringify(a)).join(', ');
	const code = `const m = await import(${JSON.stringify(preReadyUrl)});
process.stdout.write(JSON.stringify(m[${JSON.stringify(fnName)}](${argList})));`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		encoding: 'utf8',
	});
	return JSON.parse(out) as T;
}

/** pre-ready.mjs の named export (定数) を子プロセスで読み出す。 */
function readExport<T>(name: string): T {
	const code = `const m = await import(${JSON.stringify(preReadyUrl)});
process.stdout.write(JSON.stringify(m[${JSON.stringify(name)}]));`;
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
		encoding: 'utf8',
	});
	return JSON.parse(out) as T;
}

type Drift = {
	level: 'fresh' | 'unverified' | 'behind-only' | 'gate-ssot-moved';
	gateFiles: string[];
};

const classifyBaseDrift = (arg: {
	behind: number;
	baseChangedFiles: string[];
	fetchFailed?: boolean;
}) => callExport<Drift>('classifyBaseDrift', arg);
const isGateSsotPath = (file: string) => callExport<boolean>('isGateSsotPath', file);

describe('#4390 classifyBaseDrift — base 鮮度の 3 分類', () => {
	it('[B1] base が動いていなければ fresh (通常ケースを止めない)', () => {
		const r = classifyBaseDrift({ behind: 0, baseChangedFiles: [] });
		expect(r.level).toBe('fresh');
		expect(r.gateFiles).toEqual([]);
	});

	it('[B14] git fetch に失敗していたら fresh を名乗らない (未検証を検証済みと書かない)', () => {
		// fetch できていないときの behind=0 は「手元 ref との差が 0」でしかなく、
		// base を取り込み済である証明にならない。ここで fresh を返すと pre-ready が
		// 「base 鮮度: OK (取り込み済)」と出力し、**検証していない事実を検証済みとして残す**。
		const r = classifyBaseDrift({ behind: 0, baseChangedFiles: [], fetchFailed: true });
		expect(r.level).toBe('unverified');
		expect(r.gateFiles).toEqual([]);
	});

	it('[B15] fetch 成功時は従来どおり fresh (fetchFailed の既定は false)', () => {
		expect(classifyBaseDrift({ behind: 0, baseChangedFiles: [], fetchFailed: false }).level).toBe(
			'fresh',
		);
		expect(classifyBaseDrift({ behind: 0, baseChangedFiles: [] }).level).toBe('fresh');
	});

	it('[B16] fetch 失敗でも検査基準が動いていれば BLOCK を維持する (安全側を弱めない)', () => {
		const r = classifyBaseDrift({
			behind: 3,
			baseChangedFiles: ['.github/PULL_REQUEST_TEMPLATE.md'],
			fetchFailed: true,
		});
		expect(r.level).toBe('gate-ssot-moved');
	});

	it('[B17] unverified の注記は「取り込み済」と書かない', () => {
		const note = callExport<string>('buildBaseUnverifiedNote', 'develop');
		expect(note).toContain('未検証');
		expect(note).toContain('git fetch origin develop');
		expect(note).not.toContain('取り込み済み');
		expect(note).not.toContain('OK');
	});

	it('[B2] base が動いても検査基準を含まなければ behind-only (警告のみ)', () => {
		const r = classifyBaseDrift({
			behind: 12,
			baseChangedFiles: ['src/lib/server/services/activity-service.ts', 'docs/CLAUDE.md'],
		});
		expect(r.level).toBe('behind-only');
		expect(r.gateFiles).toEqual([]);
	});

	it('[B3] base の差分が PR テンプレート SSOT を含めば gate-ssot-moved (#4322 の実害形)', () => {
		const r = classifyBaseDrift({
			behind: 3,
			baseChangedFiles: [
				'src/routes/+page.svelte',
				'.github/PR_TEMPLATE_SECTIONS.json',
				'.github/PULL_REQUEST_TEMPLATE.md',
			],
		});
		expect(r.level).toBe('gate-ssot-moved');
		// 「何が動いたか」を出せるよう、該当 file だけを残すこと
		expect(r.gateFiles).toEqual([
			'.github/PR_TEMPLATE_SECTIONS.json',
			'.github/PULL_REQUEST_TEMPLATE.md',
		]);
	});

	it('[B4] base の差分が pre-ready が spawn する検査 script を含めば gate-ssot-moved', () => {
		expect(
			classifyBaseDrift({ behind: 1, baseChangedFiles: ['scripts/check-pr-body.mjs'] }).level,
		).toBe('gate-ssot-moved');
	});

	it('[B5] behind > 0 でも差分一覧が空なら behind-only (差分取得失敗を BLOCK にしない)', () => {
		// offline / ref 不在で「測れなかった」ときに全員が止まるのを避ける
		expect(classifyBaseDrift({ behind: 5, baseChangedFiles: [] }).level).toBe('behind-only');
	});

	it('[B6] behind が 0 なら検査基準が差分にあっても fresh (取り込み済みで止めない)', () => {
		const r = classifyBaseDrift({
			behind: 0,
			baseChangedFiles: ['.github/PR_TEMPLATE_SECTIONS.json'],
		});
		expect(r.level).toBe('fresh');
	});
});

describe('#4390 isGateSsotPath — 検査基準の判定', () => {
	it('[B7] pre-ready が読む scripts/lib/ci/ の module は検査基準', () => {
		expect(isGateSsotPath('scripts/lib/ci/pr-body-sections.mjs')).toBe(true);
		expect(isGateSsotPath('scripts/lib/ci/resolve-base-branch.mjs')).toBe(true);
	});

	it('[B8] 検査基準でない path は false (over-block しない)', () => {
		expect(isGateSsotPath('src/lib/domain/labels.ts')).toBe(false);
		expect(isGateSsotPath('docs/decisions/README.md')).toBe(false);
		// 名前が似ているだけの path を拾わない
		expect(isGateSsotPath('tests/unit/scripts/check-pr-body.test.ts')).toBe(false);
	});

	it('[B18] pre-ready が読まない scripts/lib/ci/ の module は検査基準ではない', () => {
		// ディレクトリ prefix で一括指定していた頃は、ページガイド撮影ヘルパを直しただけで
		// 全 PR の pre-ready が止まっていた。止める根拠 (手元と CI で読む SSOT が食い違う) が
		// 成立しない file を BLOCK しない (#4390)。
		expect(isGateSsotPath('scripts/lib/ci/page-guide-capture.mjs')).toBe(false);
		expect(isGateSsotPath('scripts/lib/ci/brand-style-guide.js')).toBe(false);
		expect(isGateSsotPath('scripts/lib/ci/workflow-judgment-registry.mjs')).toBe(false);
	});

	it('[B9] Windows の \\ 区切りでも同じ判定になる', () => {
		expect(isGateSsotPath('.github\\PR_TEMPLATE_SECTIONS.json')).toBe(true);
		expect(isGateSsotPath('scripts\\lib\\ci\\resolve-base-branch.mjs')).toBe(true);
	});
});

describe('#4390 BLOCK / 警告の文言', () => {
	it('[B10] BLOCK 文言は「何が動いたか」と「どう直すか」を両方持つ', () => {
		const msg = callExport<string>('buildBaseDriftBlockMessage', 'develop', 3, [
			'.github/PR_TEMPLATE_SECTIONS.json',
		]);
		expect(msg).toContain('.github/PR_TEMPLATE_SECTIONS.json');
		expect(msg).toContain('git rebase origin/develop');
		// 「なぜ止めたか」= 判定が無効になっている、が読み取れること
		expect(msg).toContain('検査基準');
	});

	it('[B11] 警告文言は commit 数と base 名を持ち、止めない旨が読める', () => {
		const note = callExport<string>('buildBaseDriftNote', 'develop', 12);
		expect(note).toContain('12');
		expect(note).toContain('develop');
		expect(note).toContain('止めません');
	});
});

/**
 * #4390 fitness function — 検査基準 list の網羅性
 *
 * 実測 (QM lead): `PRE_READY_GATE_SSOT_PATHS` は spawn する entry script だけを列挙しており、
 * その script が import する sibling module (`pr-template-gate-checks.mjs` 等) を取りこぼしていた。
 * CI の判定ロジック本体が develop 側で動いても `fresh` / `behind-only` を返して素通しするため、
 * #4322 と同一クラスの障害が別 file 経由でそのまま再現する。
 *
 * list を手で足すだけでは同じ穴が再び開くので、**実際に import を辿って閉包を計算し**、
 * 全 file が検査基準に被覆されていることを機械で固定する (ADR-0061 同 class N→guard)。
 * 期待 list を test 側に手書きすると二重管理になるため、entry も閉包も source から導出する。
 *
 * 被覆は **両方向**で見る。片方向 (漏れのみ) だと、逆方向の穴 = pre-ready が一度も読まない
 * file を検査基準に混ぜる over-block が素通りする (実際 `scripts/lib/ci/` の prefix 指定で
 * 13 file 中 9 file が無関係に BLOCK 対象になっていた)。[B13] が漏れ、[B19] が余分を見る。
 */
describe('#4390 検査基準 list は spawn する script の import 閉包と一致する', () => {
	/**
	 * pre-ready.mjs の source から、子プロセスで起動する script path を拾う。
	 *
	 * 単に `'scripts/....mjs'` という文字列リテラルを拾うと **`PRE_READY_GATE_SSOT_PATHS` の
	 * 配列リテラル自身**を entry として読んでしまい、[B12] が「list に載っているものが list に
	 * 載っている」を assert する tautology になる。実際に spawn するのは `run(...)` に渡す
	 * `['node', 'scripts/xxx.mjs', …]` の argv だけなので、その形だけを拾う。
	 *
	 * pre-ready.mjs 自身は spawn 対象ではないが、6 step のオーケストレータであり
	 * 判定順・合否条件そのものを持つため entry (= 閉包の起点) に含める。
	 */
	function readEntryScripts(): string[] {
		const src = readFileSync(resolve(repoRoot, 'scripts/pre-ready.mjs'), 'utf8');
		const spawned = [
			...src.matchAll(/['"]node['"]\s*,\s*['"](scripts\/[A-Za-z0-9_./-]+\.mjs)['"]/g),
		].flatMap((m) => (m[1] ? [m[1]] : []));
		return [...new Set(['scripts/pre-ready.mjs', ...spawned])];
	}

	/** repo-relative な .mjs から相対 import を辿り、到達する全 file (entry 含む) を返す。 */
	function collectImportClosure(entries: string[]): string[] {
		const seen = new Set<string>();
		const queue = [...entries];
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current || seen.has(current)) continue;
			seen.add(current);
			const abs = resolve(repoRoot, current);
			if (!existsSync(abs)) continue;
			const src = readFileSync(abs, 'utf8');
			// `from './x.mjs'` / `import('./x.mjs')` の相対 specifier のみ辿る
			// (bare specifier = node_modules / 標準モジュールは対象外)
			for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
				const specifier = m[1];
				if (!specifier) continue;
				const target = relative(repoRoot, resolve(dirname(abs), specifier)).replace(/\\/g, '/');
				if (!seen.has(target)) queue.push(target);
			}
		}
		return [...seen].sort();
	}

	/** isGateSsotPath を 1 回の子プロセスで一括評価する (path ごとに spawn しない)。 */
	function isGateSsotPathAll(files: string[]): boolean[] {
		const code = `const m = await import(${JSON.stringify(preReadyUrl)});
process.stdout.write(JSON.stringify(${JSON.stringify(files)}.map((f) => m.isGateSsotPath(f))));`;
		const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
			encoding: 'utf8',
		});
		return JSON.parse(out) as boolean[];
	}

	it('[B12] spawn する entry script 自体が検査基準に含まれる', () => {
		const entries = readEntryScripts();
		// spawn 経路を絞ったので、entry が 0 本 / pre-ready.mjs 単体に縮退していたら
		// 正規表現が argv の形と食い違っている (test 自体の空振り防止)
		expect(entries.length).toBeGreaterThan(1);
		const covered = isGateSsotPathAll(entries);
		expect(entries.filter((_, i) => !covered[i])).toEqual([]);
	});

	it('[B13] entry script が import する module も全て検査基準に含まれる (取りこぼし 0)', () => {
		const closure = collectImportClosure(readEntryScripts());
		// 閉包が entry だけに縮退していたら walker が壊れている (test 自体の空振り防止)
		expect(closure.length).toBeGreaterThan(readEntryScripts().length);
		const covered = isGateSsotPathAll(closure);
		expect(closure.filter((_, i) => !covered[i])).toEqual([]);
	});

	it('[B19] scripts/ 配下の検査基準に、閉包に無い file を余分に列挙していない (over-block 防止)', () => {
		// [B13] は「列挙漏れ」だけを見る。片方向だと、prefix 指定や手書き追加で
		// **pre-ready が一度も読まない file** が検査基準に紛れ込み、無関係な変更で
		// 全 PR を止める over-block が再発する (#4390 の実害形)。
		// `.github/*` や biome.json / tsconfig.json は import 閉包に現れない検査基準なので、
		// 両方向 assert の対象は `scripts/` 配下に限る。
		const closure = new Set(collectImportClosure(readEntryScripts()));
		const listed = readExport<string[]>('PRE_READY_GATE_SSOT_PATHS').filter((p) =>
			p.startsWith('scripts/'),
		);
		expect(listed.filter((p) => !closure.has(p))).toEqual([]);
	});
});
