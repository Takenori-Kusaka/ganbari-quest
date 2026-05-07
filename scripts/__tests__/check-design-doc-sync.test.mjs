/**
 * scripts/__tests__/check-design-doc-sync.test.mjs
 *
 * #1985 — design-doc-check 判定ロジックのユニットテスト。
 *
 * 実行: node --test scripts/__tests__/check-design-doc-sync.test.mjs
 *
 * テストケースは以下の判定ツリーを網羅する:
 * 1. src/routes/ 変更なし → skip
 * 2. src/routes/ 変更あり + docs/design/ 同期あり → pass
 * 3. src/routes/ 変更あり + 全ファイル exempt パターン (file-pattern exempt) → skip
 * 4. src/routes/ 変更あり + label exempt あり → skip
 * 5. src/routes/ 変更あり + どの exempt も該当せず → fail
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	checkDesignDocSync,
	hasDesignDocChanges,
	hasInternalRefactorLabel,
	hasRouteChanges,
	INTERNAL_REFACTOR_LABEL,
	isAllFilesExempt,
} from '../check-design-doc-sync.mjs';

// ---------------------------------------------------------------------------
// 個別 helper
// ---------------------------------------------------------------------------

describe('hasRouteChanges', () => {
	it('src/routes/ 配下の変更を検出する', () => {
		assert.equal(hasRouteChanges(['src/routes/admin/+page.svelte']), true);
		assert.equal(hasRouteChanges(['src/routes/(child)/[uiMode=uiMode]/home/+page.ts']), true);
	});

	it('src/routes/ 以外は false', () => {
		assert.equal(hasRouteChanges(['src/lib/foo.ts', 'docs/design/06-UI設計書.md']), false);
		assert.equal(hasRouteChanges([]), false);
	});

	it('src/routes-helper のような prefix mismatch は false', () => {
		assert.equal(hasRouteChanges(['src/routes-helper/foo.ts']), false);
	});
});

describe('hasDesignDocChanges', () => {
	it('docs/design/ 配下の変更を検出する', () => {
		assert.equal(hasDesignDocChanges(['docs/design/06-UI設計書.md']), true);
		assert.equal(hasDesignDocChanges(['docs/design/diagrams/foo.drawio']), true);
	});

	it('docs/decisions/ や docs/tickets/ は false', () => {
		assert.equal(hasDesignDocChanges(['docs/decisions/0003-issue-quality.md']), false);
		assert.equal(hasDesignDocChanges(['docs/tickets/old.md']), false);
	});
});

describe('isAllFilesExempt', () => {
	it('全ファイルが exempt パターンに合致すれば true', () => {
		assert.equal(isAllFilesExempt(['CLAUDE.md', 'scripts/foo.mjs', 'docs/design/x.md']), true);
		assert.equal(
			isAllFilesExempt(['.github/workflows/ci.yml', 'site/index.html', 'infra/cdk/app.ts']),
			true,
		);
	});

	it('1 件でも exempt でないファイルがあれば false', () => {
		assert.equal(isAllFilesExempt(['scripts/foo.mjs', 'src/routes/admin/+page.svelte']), false);
		assert.equal(isAllFilesExempt(['src/lib/foo.ts']), false);
	});

	it('入れ子の CLAUDE.md (e.g. src/routes/CLAUDE.md) も exempt', () => {
		assert.equal(isAllFilesExempt(['src/routes/CLAUDE.md', 'docs/CLAUDE.md']), true);
	});

	it('空配列は false (短絡前提なので CLI 側で先に hasRouteChanges() で弾かれる)', () => {
		assert.equal(isAllFilesExempt([]), false);
	});
});

describe('hasInternalRefactorLabel', () => {
	it('label に refactor:internal-no-doc-impact があれば true', () => {
		assert.equal(hasInternalRefactorLabel([INTERNAL_REFACTOR_LABEL]), true);
		assert.equal(
			hasInternalRefactorLabel(['type:refactor', INTERNAL_REFACTOR_LABEL, 'priority:high']),
			true,
		);
	});

	it('大文字小文字を区別しない', () => {
		assert.equal(hasInternalRefactorLabel(['Refactor:Internal-No-Doc-Impact']), true);
	});

	it('label が無ければ false', () => {
		assert.equal(hasInternalRefactorLabel([]), false);
		assert.equal(hasInternalRefactorLabel(['type:refactor', 'priority:high']), false);
	});

	it('部分一致では false (悪用防止)', () => {
		assert.equal(hasInternalRefactorLabel(['refactor']), false);
		assert.equal(hasInternalRefactorLabel(['internal-no-doc-impact']), false);
	});
});

// ---------------------------------------------------------------------------
// 判定本体 (checkDesignDocSync)
// ---------------------------------------------------------------------------

describe('checkDesignDocSync', () => {
	describe('Case 1: src/routes/ 変更なし → skip', () => {
		it('docs only PR は skip', () => {
			const r = checkDesignDocSync({
				files: ['docs/design/06-UI設計書.md'],
				labels: [],
			});
			assert.equal(r.status, 'skip');
			assert.match(r.reason, /src\/routes\/ への変更なし/);
		});

		it('scripts only PR は skip', () => {
			const r = checkDesignDocSync({
				files: ['scripts/foo.mjs', 'scripts/__tests__/foo.test.mjs'],
				labels: [],
			});
			assert.equal(r.status, 'skip');
		});

		it('空 PR (空 diff) も skip', () => {
			const r = checkDesignDocSync({ files: [], labels: [] });
			assert.equal(r.status, 'skip');
		});
	});

	describe('Case 2: src/routes/ 変更あり + docs/design/ 同期あり → pass', () => {
		it('UI 変更 + 06-UI 設計書同期', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/admin/+page.svelte', 'docs/design/06-UI設計書.md'],
				labels: [],
			});
			assert.equal(r.status, 'pass');
			assert.match(r.reason, /docs\/design\/ の同期更新あり/);
		});

		it('routes + design diagrams 同時更新', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/foo/+page.ts', 'docs/design/diagrams/system.drawio'],
				labels: [],
			});
			assert.equal(r.status, 'pass');
		});
	});

	describe('Case 3: src/routes/ 変更あり + 全ファイル exempt (file-pattern exempt) → skip', () => {
		it('CLAUDE.md のみ更新 (src/routes/ 変更ゼロ) は Case 1 で skip', () => {
			const r = checkDesignDocSync({ files: ['src/routes/CLAUDE.md'], labels: [] });
			// CLAUDE.md は src/routes/ 配下だが、hasRouteChanges() は startsWith 判定なので true
			// → docs/design/ 同期なし → file-pattern exempt 該当 → skip
			assert.equal(r.status, 'skip');
			assert.match(r.reason, /設計書更新不要なパターン/);
		});
	});

	describe('Case 4: src/routes/ 変更あり + label exempt → skip (#1985 NEW)', () => {
		it('PLAN リテラル refactor PR が label で exempt される', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/admin/+page.server.ts'],
				labels: [INTERNAL_REFACTOR_LABEL],
			});
			assert.equal(r.status, 'skip');
			assert.match(r.reason, /ラベル.*内部 refactor として exempt/);
		});

		it('複数 src/routes/ 変更でも label があれば skip', () => {
			const r = checkDesignDocSync({
				files: [
					'src/routes/admin/+page.server.ts',
					'src/routes/admin/dashboard/+page.server.ts',
					'src/lib/domain/labels.ts',
				],
				labels: ['type:refactor', INTERNAL_REFACTOR_LABEL],
			});
			assert.equal(r.status, 'skip');
		});

		it('label の大文字小文字無視', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/admin/+page.server.ts'],
				labels: ['Refactor:Internal-No-Doc-Impact'],
			});
			assert.equal(r.status, 'skip');
		});
	});

	describe('Case 5: src/routes/ 変更あり + 何も exempt せず → fail', () => {
		it('UI 変更 + design 同期なし + label なし → fail', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/admin/+page.svelte', 'src/lib/foo.ts'],
				labels: [],
			});
			assert.equal(r.status, 'fail');
			assert.match(r.reason, /docs\/design\/ の更新がありません/);
			assert.match(r.reason, /refactor:internal-no-doc-impact/);
		});

		it('label が別ラベルでは fail', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/admin/+page.svelte', 'src/lib/foo.ts'],
				labels: ['type:refactor', 'priority:high'],
			});
			assert.equal(r.status, 'fail');
		});

		it('src/routes/ + src/lib/ の混在で exempt 該当なし', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/admin/+page.ts', 'src/lib/server/foo.ts'],
				labels: [],
			});
			assert.equal(r.status, 'fail');
		});
	});

	describe('優先順位: docs/design/ 同期 > file-pattern exempt > label exempt', () => {
		it('docs/design/ 同期があれば label が無くても pass', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/admin/+page.ts', 'docs/design/06-UI設計書.md'],
				labels: [],
			});
			assert.equal(r.status, 'pass');
		});

		it('file-pattern exempt が成立すれば label 不要', () => {
			const r = checkDesignDocSync({
				files: ['src/routes/CLAUDE.md', 'scripts/foo.mjs'],
				labels: [],
			});
			assert.equal(r.status, 'skip');
		});

		it('label exempt は file-pattern exempt の fallback として機能', () => {
			// src/routes/ + src/lib/ 混在 (file-pattern exempt 不成立) でも label で skip
			const r = checkDesignDocSync({
				files: ['src/routes/admin/+page.server.ts', 'src/lib/domain/labels.ts'],
				labels: [INTERNAL_REFACTOR_LABEL],
			});
			assert.equal(r.status, 'skip');
		});
	});
});
