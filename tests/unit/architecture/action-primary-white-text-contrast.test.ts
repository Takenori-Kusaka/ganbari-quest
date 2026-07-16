// tests/unit/architecture/action-primary-white-text-contrast.test.ts
// #3744 / PR #3756 QM Re-Review (ADR-0061 same-class → guard): 白文字 × --color-action-primary の
// WCAG 1.4.3 低コントラスト (実測 3.34:1、AA 4.5:1 未達) を機械強制で 0 に固定する fitness function。
//
// 背景: challenges 子タブの白文字 × action-primary (3.34:1) を是正した際、PR body AC4 の検証 grep が
// `text-[var(--color-text-inverse)]` 形式のみ拾い **`text-white` リテラル形式を取りこぼした** (grep 盲点)。
// その結果 marketplace 選択フィルタチップ / CTA / ParentMessageOverlay 確認ボタンの計 7 箇所が同一欠陥で
// 残存した (虚偽の「残存 0」)。本 guard は grep 盲点の再発を構造的に防ぐため **両形式** を対象にする:
//   - `text-white`                        (Tailwind リテラル)
//   - `text-[var(--color-text-inverse)]`  (Semantic トークン arbitrary)
//
// 正しい修正 = 背景を `--color-action-primary-strong` (= brand-700、白文字 4.62:1、AA 達成) に変更する
// (DESIGN.md §2 Semantic トークン。hex 直書き禁止)。本 anti-pattern は 0 を維持する (hard guard)。
//
// 対象外 (誤検出しない):
//   - `bg-[var(--color-action-primary)]` 単体 (テキストなし progress bar fill 等、例: ops/cohort)
//   - `bg-[var(--color-action-primary-strong)]` / `-hover` (是正済トークン。closing `)` 直後判定で除外)
//   - `text-[var(--color-action-primary)]` (前景色としての action-primary。背景ではない)

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN_DIRS = [resolve(REPO_ROOT, 'src/routes'), resolve(REPO_ROOT, 'src/lib')];

// 背景に「素の」action-primary を使う Tailwind arbitrary class。closing `)` を primary 直後に固定する
// ことで `-strong)` / `-hover)` を除外する (是正済トークンは flag しない)。
const BG_ACTION_PRIMARY = /bg-\[var\(--color-action-primary\)\]/;
// 白系前景色 (両形式)。grep 盲点再発防止のため両方を対象にする。
const WHITE_TEXT = /(?:\btext-white\b|text-\[var\(--color-text-inverse\)\])/;

function walkSvelteFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			walkSvelteFiles(full, acc);
		} else if (entry.name.endsWith('.svelte')) {
			acc.push(full);
		}
	}
	return acc;
}

/**
 * class 文字列単位 (連続する非空白でない "1 つの className グループ") で bg-action-primary と
 * 白文字が同居する箇所を検出する。Svelte の三項式 `? '...class...' : '...'` のように 1 行に複数の
 * class グループが並ぶケースでも、`'` / `"` / backtick / `{` `}` 区切りで論理グループに分割してから
 * 判定するため、無関係な 2 つのグループ (bg だけのグループ + 白文字だけのグループ) を誤検出しない。
 */
function findViolations(): string[] {
	const violations: string[] = [];
	for (const dir of SCAN_DIRS) {
		for (const file of walkSvelteFiles(dir, [])) {
			const content = readFileSync(file, 'utf-8');
			const lines = content.split(/\r?\n/);
			lines.forEach((line, idx) => {
				// class グループ候補に分割 (クォート / 波括弧 / 空白の三項区切りで粗く区切る)。
				const segments = line.split(/['"`{}]|\s\?\s|\s:\s/);
				for (const seg of segments) {
					if (BG_ACTION_PRIMARY.test(seg) && WHITE_TEXT.test(seg)) {
						violations.push(`${relative(REPO_ROOT, file)}:${idx + 1}`);
						break;
					}
				}
			});
		}
	}
	return violations;
}

describe('#3744: 白文字 × --color-action-primary は WCAG 1.4.3 (3.34:1) 違反のため 0 件 (ADR-0061 same-class guard)', () => {
	it('bg-action-primary と白系前景色 (text-white / text-[var(--color-text-inverse)]) が同一 class に同居しない', () => {
		const violations = findViolations();
		expect(
			violations,
			'白文字 × --color-action-primary (3.34:1、AA 4.5:1 未達) の同一 class 同居を検出。' +
				'背景を --color-action-primary-strong (brand-700、白文字 4.62:1) に変更する (DESIGN.md §2、hex 直書き禁止)。' +
				`\n検出箇所:\n${violations.join('\n')}`,
		).toEqual([]);
	});

	it('guard 自身が両形式 (text-white / text-[var(--color-text-inverse)]) を検出する (grep 盲点回帰防止)', () => {
		// PR #3756 で虚偽 AC4 を招いた grep 盲点 (text-white 形式取りこぼし) の回帰を防ぐため、
		// guard 判定ロジックが両形式を等しく flag することを自己検証する。
		const literalForm = 'class="px-3 bg-[var(--color-action-primary)] text-white shadow"';
		const tokenForm =
			'class="px-3 bg-[var(--color-action-primary)] text-[var(--color-text-inverse)] shadow"';
		const strongForm = 'class="px-3 bg-[var(--color-action-primary-strong)] text-white shadow"';
		const bgOnly = 'class="h-full bg-[var(--color-action-primary)] transition-all"';

		const seg = (s: string) => BG_ACTION_PRIMARY.test(s) && WHITE_TEXT.test(s);
		expect(seg(literalForm), 'text-white リテラル形式を検出すべき').toBe(true);
		expect(seg(tokenForm), 'text-[var(--color-text-inverse)] トークン形式を検出すべき').toBe(true);
		expect(seg(strongForm), '是正済 -strong トークンは検出しない').toBe(false);
		expect(seg(bgOnly), 'テキストなし bg 単体 (progress bar) は検出しない').toBe(false);
	});
});
