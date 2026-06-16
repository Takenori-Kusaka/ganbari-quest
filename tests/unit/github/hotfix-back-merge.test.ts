// Issue #2951 (Phase B/B-5) AC1/AC2/AC5: hotfix back-merge 判定 SSOT
// (scripts/hotfix-back-merge.mjs) の純粋関数を網羅する unit test。
// develop 二層ブランチ戦略 (docs/sessions/branch-strategy.md §5「hotfix 経路」) の
// back-merge 自動化の起動判定 SSOT。
import { describe, expect, it } from 'vitest';
import {
	backMergeBranchName,
	classifyMergedPr,
	evaluateBackMerge,
	HOTFIX_LABELS,
	parseArgs,
	shouldBackMerge,
} from '../../../scripts/hotfix-back-merge.mjs';

describe('classifyMergedPr (#2951 AC1/AC2)', () => {
	it('hotfix: fix/* → main は hotfix (AC1)', () => {
		expect(classifyMergedPr({ headRef: 'fix/999-x', baseRef: 'main' })).toBe('hotfix');
	});

	it('hotfix: priority:critical label 付き (fix/* でなくても) は hotfix (AC1)', () => {
		expect(
			classifyMergedPr({ headRef: 'urgent-patch', baseRef: 'main', labels: ['priority:critical'] }),
		).toBe('hotfix');
	});

	it('hotfix: hotfix label 付きは hotfix (AC1)', () => {
		expect(classifyMergedPr({ headRef: 'patch-x', baseRef: 'main', labels: ['hotfix'] })).toBe(
			'hotfix',
		);
	});

	it('integration: develop → main は integration = back-merge 除外 (AC2 無限ループ防止)', () => {
		expect(classifyMergedPr({ headRef: 'develop', baseRef: 'main' })).toBe('integration');
	});

	it('integration: develop → main は label に critical があっても integration (head 優先)', () => {
		// 統合 PR に critical label が付いていても develop は同期済 = back-merge 不要。
		expect(
			classifyMergedPr({ headRef: 'develop', baseRef: 'main', labels: ['priority:critical'] }),
		).toBe('integration');
	});

	it('other: base が main でない (develop 向け feature merge) は other', () => {
		expect(classifyMergedPr({ headRef: 'fix/999-x', baseRef: 'develop' })).toBe('other');
	});

	it('other: feat/* → main (cutover 前 / CI 環境構築 PR) は other = back-merge 対象外', () => {
		expect(classifyMergedPr({ headRef: 'feat/x', baseRef: 'main' })).toBe('other');
	});

	it('other: infra/* → main (CI 環境構築例外、§5) は other', () => {
		expect(classifyMergedPr({ headRef: 'infra/ci-setup', baseRef: 'main' })).toBe('other');
	});

	it('空入力は other (副作用なし防御)', () => {
		expect(classifyMergedPr({ headRef: '', baseRef: '' })).toBe('other');
	});

	it('前後空白を trim して判定する', () => {
		expect(classifyMergedPr({ headRef: '  fix/9  ', baseRef: '  main  ' })).toBe('hotfix');
	});
});

describe('shouldBackMerge (#2951 AC1/AC2)', () => {
	it('hotfix のみ true', () => {
		expect(shouldBackMerge('hotfix')).toBe(true);
	});

	it('integration は false (AC2)', () => {
		expect(shouldBackMerge('integration')).toBe(false);
	});

	it('other は false', () => {
		expect(shouldBackMerge('other')).toBe(false);
	});
});

describe('backMergeBranchName (#2951)', () => {
	it('fix/999-x → back-merge/fix-999-x (決定的、再実行で同名)', () => {
		expect(backMergeBranchName('fix/999-x')).toBe('back-merge/fix-999-x');
		// 冪等性: 同入力は常に同出力 (upsert 可能)
		expect(backMergeBranchName('fix/999-x')).toBe(backMergeBranchName('fix/999-x'));
	});

	it('不正文字 (slash / 連続記号) を 1 つの - に正規化', () => {
		expect(backMergeBranchName('fix/feature@v1.2')).toBe('back-merge/fix-feature-v1.2');
	});

	it('前後の - を除去', () => {
		expect(backMergeBranchName('--fix/x--')).toBe('back-merge/fix-x');
	});

	it('空入力は back-merge/unknown', () => {
		expect(backMergeBranchName('')).toBe('back-merge/unknown');
	});
});

describe('evaluateBackMerge facade (#2951 CLI 出力 SSOT)', () => {
	it('hotfix: shouldBackMerge true + branch 名あり', () => {
		expect(evaluateBackMerge({ headRef: 'fix/999-x', baseRef: 'main' })).toEqual({
			classification: 'hotfix',
			shouldBackMerge: true,
			branch: 'back-merge/fix-999-x',
		});
	});

	it('integration: shouldBackMerge false + branch null (AC2)', () => {
		expect(evaluateBackMerge({ headRef: 'develop', baseRef: 'main' })).toEqual({
			classification: 'integration',
			shouldBackMerge: false,
			branch: null,
		});
	});

	it('other: shouldBackMerge false + branch null', () => {
		expect(evaluateBackMerge({ headRef: 'feat/x', baseRef: 'main' })).toEqual({
			classification: 'other',
			shouldBackMerge: false,
			branch: null,
		});
	});
});

describe('parseArgs (#2951)', () => {
	it('--base / --head / --labels (カンマ区切り → 配列)', () => {
		expect(parseArgs(['--base', 'main', '--head', 'fix/9', '--labels', 'a,b , c'])).toEqual({
			baseRef: 'main',
			headRef: 'fix/9',
			labels: ['a', 'b', 'c'],
		});
	});

	it('--key=value 形式も解釈する', () => {
		expect(parseArgs(['--base=main', '--head=develop'])).toEqual({
			baseRef: 'main',
			headRef: 'develop',
			labels: [],
		});
	});

	it('labels 未指定は空配列', () => {
		expect(parseArgs(['--base', 'main', '--head', 'fix/9']).labels).toEqual([]);
	});
});

describe('HOTFIX_LABELS SSOT (#2951)', () => {
	it('hotfix / priority:critical を含む', () => {
		expect(HOTFIX_LABELS.has('hotfix')).toBe(true);
		expect(HOTFIX_LABELS.has('priority:critical')).toBe(true);
		expect(HOTFIX_LABELS.has('priority:high')).toBe(false);
	});
});
