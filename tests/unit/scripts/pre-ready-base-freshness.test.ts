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
import { resolve } from 'node:path';
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

type Drift = { level: 'fresh' | 'behind-only' | 'gate-ssot-moved'; gateFiles: string[] };

const classifyBaseDrift = (arg: { behind: number; baseChangedFiles: string[] }) =>
	callExport<Drift>('classifyBaseDrift', arg);
const isGateSsotPath = (file: string) => callExport<boolean>('isGateSsotPath', file);

describe('#4390 classifyBaseDrift — base 鮮度の 3 分類', () => {
	it('[B1] base が動いていなければ fresh (通常ケースを止めない)', () => {
		const r = classifyBaseDrift({ behind: 0, baseChangedFiles: [] });
		expect(r.level).toBe('fresh');
		expect(r.gateFiles).toEqual([]);
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
	it('[B7] scripts/lib/ci/ 配下は prefix で一括して検査基準扱い', () => {
		expect(readExport<string[]>('PRE_READY_GATE_SSOT_PREFIXES')).toContain('scripts/lib/ci/');
		expect(isGateSsotPath('scripts/lib/ci/pr-body-sections.mjs')).toBe(true);
	});

	it('[B8] 検査基準でない path は false (over-block しない)', () => {
		expect(isGateSsotPath('src/lib/domain/labels.ts')).toBe(false);
		expect(isGateSsotPath('docs/decisions/README.md')).toBe(false);
		// 名前が似ているだけの path を拾わない
		expect(isGateSsotPath('tests/unit/scripts/check-pr-body.test.ts')).toBe(false);
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
