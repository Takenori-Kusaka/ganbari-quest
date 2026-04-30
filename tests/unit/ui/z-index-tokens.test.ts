// tests/unit/ui/z-index-tokens.test.ts
// #1722 — z-index トークン階層の回帰防止
//
// 検証対象（DESIGN.md §10 z-index 階層）:
// 1. app.css に --z-* トークンが定義されている
// 2. 期待される値（base=0, sticky=10, ..., debug=9999）に従う
// 3. MonthlyRewardDialog が --z-reward を参照している（生数値直書きではない）
//
// 目的: 新規コンポーネントが生数値（z-index: 90 等）を直書きする退行を検出するための
// セーフティネット。app.css の token 定義変更や MonthlyRewardDialog の z-index 直書き復帰を
// 早期に検出する。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const APP_CSS_PATH = path.join(REPO_ROOT, 'src/lib/ui/styles/app.css');
const MONTHLY_REWARD_DIALOG_PATH = path.join(
	REPO_ROOT,
	'src/lib/ui/components/MonthlyRewardDialog.svelte',
);

const EXPECTED_Z_INDEX_TOKENS: Record<string, string> = {
	'--z-base': '0',
	'--z-sticky': '10',
	'--z-dropdown': '20',
	'--z-banner': '30',
	'--z-overlay': '40',
	'--z-modal': '50',
	'--z-reward': '90',
	'--z-tutorial': '100',
	'--z-celebration': '200',
	'--z-debug': '9999',
};

describe('#1722 — z-index トークン階層 (DESIGN.md §10)', () => {
	const appCss = fs.readFileSync(APP_CSS_PATH, 'utf8');

	it.each(
		Object.entries(EXPECTED_Z_INDEX_TOKENS),
	)('app.css に %s: %s が定義されている', (token, expectedValue) => {
		// 期待値: `--z-token: <value>;`（ホワイトスペース許容）
		const pattern = new RegExp(`${token.replace(/-/g, '\\-')}\\s*:\\s*${expectedValue}\\s*;`, 'm');
		expect(appCss, `app.css に ${token}: ${expectedValue}; が見つからない`).toMatch(pattern);
	});

	it('app.css の z-index トークン定義はトークン以外で 9999 を新規追加していない', () => {
		// debug 階層 (9999) は --z-debug のみが許容。それ以外で 9999 直書きは禁止
		const lines = appCss.split('\n');
		const violations = lines.filter(
			(line) => /z-index\s*:\s*9999/.test(line) && !line.includes('--z-debug'),
		);
		expect(violations).toEqual([]);
	});
});

describe('#1722 — MonthlyRewardDialog の z-index は --z-reward を参照する', () => {
	const dialogSrc = fs.readFileSync(MONTHLY_REWARD_DIALOG_PATH, 'utf8');

	it('z-index に --z-reward を使用している', () => {
		expect(dialogSrc).toMatch(/z-index:\s*var\(--z-reward\)/);
	});

	it('z-index に生数値（90 等）を直書きしていない', () => {
		// `z-index: 90` のような直書きは禁止
		const directNumericMatches = dialogSrc.match(/z-index\s*:\s*\d+\s*;/g) ?? [];
		expect(directNumericMatches, 'z-index に生数値直書きが残っている').toEqual([]);
	});
});
