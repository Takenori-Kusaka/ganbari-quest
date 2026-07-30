import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #4111: autopilot オーケストレーターの構造検証。
 *
 * 本 script は「無人で長時間動く」ことが目的なので、壊れていることに気づくのが遅れる。
 * 起動できない / 安全弁が消えている / 環境依存パスが再混入した、を CI で検出する。
 *
 * PowerShell が無い環境 (Linux CI 等) では構文検査のみ skip し、
 * テキストレベルの不変条件は常に検査する (skip の silent 化を避ける、#4084 教訓)。
 */

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/autopilot.ps1');
const PROMPT = resolve(REPO_ROOT, 'scripts/autopilot-cycle-prompt.md');
const DOC = resolve(REPO_ROOT, 'docs/sessions/autopilot-session.md');

function hasPowerShell(): boolean {
	for (const exe of ['pwsh', 'powershell']) {
		try {
			execFileSync(exe, ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' });
			return true;
		} catch {
			// 次の候補へ
		}
	}
	return false;
}

function powerShellExe(): string {
	try {
		execFileSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' });
		return 'pwsh';
	} catch {
		return 'powershell';
	}
}

describe('autopilot orchestrator (#4111)', () => {
	it('[A1] 実行体・prompt・設計 doc の 3 点が揃っている', () => {
		expect(existsSync(SCRIPT), `${SCRIPT} が無い`).toBe(true);
		expect(existsSync(PROMPT), `${PROMPT} が無い`).toBe(true);
		expect(existsSync(DOC), `${DOC} が無い`).toBe(true);
	});

	it('[A2] 環境依存の絶対パスをハードコードしていない (別 PC / 別クローンで動く)', () => {
		const src = readFileSync(SCRIPT, 'utf8');
		// ドライブレター付きの絶対パス literal を禁止する。
		const absolutePaths = src.match(/'[A-Za-z]:\\[^']*'/g) ?? [];
		expect(absolutePaths, `絶対パス literal が残存: ${absolutePaths.join(', ')}`).toEqual([]);
		expect(src, 'PSScriptRoot 起点でリポジトリを解決していない').toContain('$PSScriptRoot');
	});

	it('[A3] 安全弁 5 種がすべて実装されている', () => {
		const src = readFileSync(SCRIPT, 'utf8');
		// 1 停止フラグ / 2 サイクル数 / 3 累計コスト / 4 経過時間 / 5 進捗ゼロ連続
		expect(src, '停止フラグ判定が無い').toMatch(/Test-Path\s+\$StopFile/);
		expect(src, 'サイクル数上限が無い').toMatch(/\$state\.cycle\s+-ge\s+\$MaxCycles/);
		expect(src, '累計コスト上限が無い').toMatch(/\$state\.totalCostUsd\s+-ge\s+\$MaxCostUsd/);
		expect(src, '経過時間上限が無い').toMatch(/TotalMinutes\s+-ge\s+\$MaxMinutes/);
		expect(src, '進捗ゼロ連続の上限が無い').toMatch(/\$state\.noProgressRuns\s+-ge\s+\$MaxNoProgress/);
	});

	it('[A4] --bare を付けて claude を起動していない (hooks を殺さない)', () => {
		const src = readFileSync(SCRIPT, 'utf8');
		// コメント行 (「--bare は使わない」等の説明) は除外して、実引数としての --bare だけを見る。
		const codeLines = src
			.split('\n')
			.filter((l) => !l.trimStart().startsWith('#'))
			.join('\n');
		expect(codeLines, "'--bare' を引数に渡している").not.toMatch(/'--bare'/);
	});

	it('[A5] 完了判定を worker の自己申告ではなく gh の実状態で行っている', () => {
		const src = readFileSync(SCRIPT, 'utf8');
		expect(src).toMatch(/gh\s+pr\s+list/);
		expect(src).toMatch(/gh\s+issue\s+list/);
	});

	it('[A6] サイクル prompt が「1 件だけ選ぶ」と「事実から読む」を指示している', () => {
		const prompt = readFileSync(PROMPT, 'utf8');
		expect(prompt, '1 件だけ進める指示が無い').toContain('1 件だけ');
		expect(prompt, '前サイクルの主張を読まない指示が無い').toContain('前のサイクルの主張');
		expect(prompt, '結果行のフォーマット指定が無い').toContain('AUTOPILOT_RESULT');
	});

	it('[A7] .ps1 が UTF-8 BOM 付きで保存されている (Windows PowerShell 5.1 の日本語コメント破損回避)', () => {
		// 実測 (#4111): BOM 無しだと Windows PowerShell 5.1 が ANSI として読み、
		// 日本語コメントが壊れて `}` / `)` の対応が崩れ、7 件の parse error になった。
		// pwsh 7 では再現しないため、BOM の有無自体を不変条件として固定する。
		const head = readFileSync(SCRIPT).subarray(0, 3);
		expect(Array.from(head), 'UTF-8 BOM (EF BB BF) が無い').toEqual([0xef, 0xbb, 0xbf]);
	});

	it.skipIf(!hasPowerShell())('[A8] PowerShell として構文エラーが無い', () => {
		const cmd = [
			'$errs = $null',
			`$null = [System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}', [ref]$null, [ref]$errs)`,
			'if ($errs -and $errs.Count -gt 0) { $errs | ForEach-Object { Write-Output ("line " + $_.Extent.StartLineNumber + ": " + $_.Message) }; exit 1 }',
			'exit 0',
		].join('; ');
		const out = execFileSync(powerShellExe(), ['-NoProfile', '-Command', cmd], {
			encoding: 'utf8',
		});
		expect(out.trim()).toBe('');
	});
});
