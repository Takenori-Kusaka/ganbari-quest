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

// #4538: 内部 ID 露出禁止 (DESIGN.md §6) は**画面を限定していない**。
// 子供画面だけを走査していたため、親画面に同型が 7 箇所残ったまま「子供画面は直したから完了」と
// 誤認する構造になっていた (実測: admin/challenges 3 / admin/checklists 2 / 共有 UI 2)。
// 子供に見せるより実害は小さいが、guard が見ていない限り永久に先送りされる。
// `src/lib/features` は `child-home` を含むため CHILD_SCOPE を足すと二重走査になる。
// 子供画面 (`(child)`) だけを明示的に足し、残りは親画面 + 共有 UI で覆う。
const UI_SCOPE = [
	join(ROOT, 'src', 'routes', '(child)'),
	join(ROOT, 'src', 'routes', '(parent)'),
	join(ROOT, 'src', 'lib', 'features'),
	join(ROOT, 'src', 'lib', 'ui'),
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
const UI_FILES = UI_SCOPE.flatMap(collectFiles);

function findViolations(pattern: RegExp, files: string[] = FILES): string[] {
	const hits: string[] = [];
	for (const file of files) {
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
		// #4538: 走査対象は子供画面に限らない。DESIGN.md §6 は画面を限定しておらず、
		// 子供画面だけを見る guard は「子供画面は直したから完了」の誤認を作る。
		//
		// 2 つの書き方を両方見る。テンプレートリテラルだけを見ていた旧実装は、同一ファイル内の
		// 文字列連結形 (admin/challenges の `'#' + instance.childId`) をそもそも検出できなかった。
		const templateForm = /`#\$\{[^}]*[Ii]d\b[^}]*\}/u; // `#${childId}`
		const concatForm = /['"]#['"]\s*\+\s*[A-Za-z0-9_.?[\]]*[Ii]d\b/u; // '#' + childId

		expect(findViolations(templateForm, UI_FILES)).toEqual([]);
		expect(findViolations(concatForm, UI_FILES)).toEqual([]);
	});

	it('① 経験値の増分を固定リテラルで描画しない (実データから導出する)', () => {
		expect(findViolations(/>\s*\+0\.\d+\s*</u)).toEqual([]);
	});

	it('guard の走査対象がゼロ件になっていない (scope 消失の検知)', () => {
		expect(FILES.length).toBeGreaterThan(20);
	});

	it('⑤ の走査対象が親画面まで届いている (#4538、scope 縮退の検知)', () => {
		// 0 件アンカー: dir を rename / 移動して UI_SCOPE が空振りしても guard が緑のままにならない。
		// 「子供画面のぶんだけ」に戻る退行も、件数が FILES を上回ることで検知する。
		expect(UI_FILES.length).toBeGreaterThan(FILES.length);
		for (const dir of UI_SCOPE) {
			expect(
				UI_FILES.filter((f) => f.startsWith(dir)).length,
				`${dir} の走査結果が 0 件 (dir 消失 / rename で guard が空振りしている)`,
			).toBeGreaterThan(0);
		}
	});
});
