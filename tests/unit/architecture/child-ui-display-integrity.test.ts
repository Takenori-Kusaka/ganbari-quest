// tests/unit/architecture/child-ui-display-integrity.test.ts
// #4509: 子供画面の表示整合について「同じ壊れ方が再発したら CI で落ちる」線を引く
// (fitness function、ADR-0061 same-class-N→guard)。
//
// 個別の値は component / route の test が固定する。本 test はその外側 —
// **同じ class の実装がほかの画面で再発すること** を止める。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (scope: 'repo'、#4085)。unit lane の並列実行で FS / CPU を奪い合っても
// 既定 5s timeout で偽陽性にならないよう明示 timeout を置く
// (SSOT: scripts/lib/ci/repo-scan-test-registry.mjs / tests/CLAUDE.md §repo 走査 test)。
vi.setConfig({ testTimeout: 60_000 });

const ROOT = join(__dirname, '..', '..', '..');
const CHILD_SCOPE = [
	join(ROOT, 'src', 'routes', '(child)'),
	join(ROOT, 'src', 'lib', 'features', 'child-home'),
];

function collectFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...collectFiles(full));
		else if (/\.(svelte|ts)$/.test(entry)) out.push(full);
	}
	return out;
}

const FILES = CHILD_SCOPE.flatMap(collectFiles);

function findViolations(pattern: RegExp): string[] {
	const hits: string[] = [];
	for (const file of FILES) {
		const lines = readFileSync(file, 'utf-8').split(/\r?\n/);
		lines.forEach((line, i) => {
			// 実装ではなく経緯を書いたコメント行は対象外
			const trimmed = line.trim();
			if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
			if (pattern.test(line)) hits.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${trimmed}`);
		});
	}
	return hits;
}

describe('#4509 子供画面の表示整合 — 再発 guard', () => {
	it('⑥ 年齢帯を「別ラベルの値」で判定しない (uiMode 由来の variant からのみ導出する)', () => {
		// 例: `t.historyCountUnit === 'かい' ? 'がつ' : '月'`
		// 回数の単位を変えるだけで日付表記が壊れる結合を作らない。
		expect(
			findViolations(/\bt\.[A-Za-z][A-Za-z0-9]*\s*===\s*['"][^'"]*[ぁ-んァ-ヶ一-龥]/u),
		).toEqual([]);
	});

	it('⑤ 内部 ID を表示名のフォールバックにしない (DESIGN.md §6、#498 / #573)', () => {
		// 例: `nickname ?? \`#${s.childId}\`
		expect(findViolations(/`#\$\{[^}]*[Ii]d\b[^}]*\}/u)).toEqual([]);
	});

	it('① 経験値の増分を固定リテラルで描画しない (実データから導出する)', () => {
		expect(findViolations(/>\s*\+0\.\d+\s*</u)).toEqual([]);
	});

	it('guard の走査対象がゼロ件になっていない (scope 消失の検知)', () => {
		expect(FILES.length).toBeGreaterThan(20);
	});
});
