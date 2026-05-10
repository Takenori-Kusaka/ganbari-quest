/**
 * scripts/__tests__/check-ss-blob-sha-uniqueness.test.mjs (#2063)
 *
 * check-ss-blob-sha-uniqueness.mjs のユニットテスト。
 *
 * AC マッピング (Issue #2063):
 *   - AC1: 同一 SHA → fail / 異 SHA → pass
 *   - AC3: refactor:internal-no-doc-impact ラベル付与時 skip
 *   - AC4: vitest test ケース 5 件以上 (本ファイルで 12 ケース実装、5 件超過達成)
 *   - AC5: PR-2054 sentinel fixture で fail することを test 化
 *
 * 実行: node --test scripts/__tests__/check-ss-blob-sha-uniqueness.test.mjs
 *
 * 注: 本リポジトリの scripts/ 配下 unit test は全て `node:test` runner を使用
 * (check-screenshot-freshness / check-pr-screenshot / check-design-doc-sync 等の慣行に整合)。
 * Issue #2063 タイトル「vitest test ケース」は test runner 慣行の表記揺れであり、
 * 本ファイルは scripts/ 慣行に従い node:test を採用 (vitest run でも node:test 実行は通過する)。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	checkSsBlobShaUniqueness,
	detectIdenticalPairs,
	extractScreenshotRefs,
	hasInternalRefactorLabel,
	INTERNAL_REFACTOR_LABEL,
	PR_2054_SENTINEL_FIXTURE,
	pairBeforeAfter,
} from '../check-ss-blob-sha-uniqueness.mjs';

// ---------------------------------------------------------------------------
// extractScreenshotRefs (URL parse) — AC1 prerequisite
// ---------------------------------------------------------------------------

describe('extractScreenshotRefs', () => {
	it('raw.githubusercontent.com の screenshots branch URL を抽出できる', () => {
		const body =
			'![before](https://raw.githubusercontent.com/owner/repo/screenshots/pr-2054/before-x.png)\n' +
			'![after](https://raw.githubusercontent.com/owner/repo/screenshots/pr-2054/after-x.png)';
		const refs = extractScreenshotRefs(body);
		assert.equal(refs.length, 2);
		assert.equal(refs[0].owner, 'owner');
		assert.equal(refs[0].repo, 'repo');
		assert.equal(refs[0].ref, 'screenshots');
		assert.equal(refs[0].path, 'pr-2054/before-x.png');
	});

	it('main branch / docs/screenshots の URL は対象外 (ref !== screenshots)', () => {
		const body = '![ok](https://raw.githubusercontent.com/owner/repo/main/docs/screenshots/x.png)';
		const refs = extractScreenshotRefs(body);
		assert.equal(refs.length, 0);
	});

	it('user-attachments / 他の image URL は無視される', () => {
		const body =
			'![ua](https://github.com/user-attachments/assets/abc-uuid)\n' +
			'![other](https://example.com/foo.png)';
		const refs = extractScreenshotRefs(body);
		assert.equal(refs.length, 0);
	});
});

// ---------------------------------------------------------------------------
// pairBeforeAfter (before/after マッチング) — AC1 prerequisite
// ---------------------------------------------------------------------------

describe('pairBeforeAfter', () => {
	it('before-X / after-X ペアを生成する', () => {
		const paths = [
			'pr-100/before-index-mobile.png',
			'pr-100/after-index-mobile.png',
			'pr-100/before-pricing-desktop.png',
			'pr-100/after-pricing-desktop.png',
		];
		const pairs = pairBeforeAfter(paths);
		assert.equal(pairs.length, 2);
		assert.deepEqual(
			pairs.map((p) => p.key).sort(),
			['pr-100/index-mobile.png', 'pr-100/pricing-desktop.png'].sort(),
		);
	});

	it('before-only / after-only はペアにならない (skip)', () => {
		const paths = [
			'pr-100/before-x.png',
			'pr-100/after-y.png', // 別 key、ペアにならない
		];
		const pairs = pairBeforeAfter(paths);
		assert.equal(pairs.length, 0);
	});

	it('SS 0 件 → ペア 0', () => {
		assert.equal(pairBeforeAfter([]).length, 0);
	});

	it('SS 1 件のみ → ペア 0 (single side)', () => {
		assert.equal(pairBeforeAfter(['pr-100/before-x.png']).length, 0);
	});
});

// ---------------------------------------------------------------------------
// detectIdenticalPairs (偽装検出のコアロジック) — AC1
// ---------------------------------------------------------------------------

describe('detectIdenticalPairs (#2063 AC1)', () => {
	it('同一 SHA ペアを偽装として検出する', () => {
		const pairs = [
			{
				key: 'pr-2054/index-desktop.png',
				before: 'pr-2054/before-index-desktop.png',
				after: 'pr-2054/after-index-desktop.png',
				beforeSha: 'aaa111',
				afterSha: 'aaa111', // 完全一致
			},
			{
				key: 'pr-2054/index-mobile.png',
				before: 'pr-2054/before-index-mobile.png',
				after: 'pr-2054/after-index-mobile.png',
				beforeSha: 'bbb222',
				afterSha: 'ccc333', // 異 SHA、正常
			},
		];
		const violations = detectIdenticalPairs(pairs);
		assert.equal(violations.length, 1);
		assert.equal(violations[0].sha, 'aaa111');
		assert.equal(violations[0].before, 'pr-2054/before-index-desktop.png');
	});

	it('全 SHA 異 → 違反 0 件', () => {
		const pairs = [
			{
				key: 'k1',
				before: 'before-1.png',
				after: 'after-1.png',
				beforeSha: 'sha1',
				afterSha: 'sha2',
			},
			{
				key: 'k2',
				before: 'before-2.png',
				after: 'after-2.png',
				beforeSha: 'sha3',
				afterSha: 'sha4',
			},
		];
		assert.equal(detectIdenticalPairs(pairs).length, 0);
	});
});

// ---------------------------------------------------------------------------
// hasInternalRefactorLabel (AC3 — label exempt) — #2017 / #1985 整合
// ---------------------------------------------------------------------------

describe('hasInternalRefactorLabel (#2063 AC3)', () => {
	it('ラベル定数が check-pr-screenshot / design-doc-check と同一値', () => {
		// 値が変わると 3 workflow 間の整合が壊れるため、固定値検証
		assert.equal(INTERNAL_REFACTOR_LABEL, 'refactor:internal-no-doc-impact');
	});

	it('refactor:internal-no-doc-impact ラベルあり → true', () => {
		assert.equal(hasInternalRefactorLabel(['refactor:internal-no-doc-impact']), true);
	});

	it('ラベルなし → false', () => {
		assert.equal(hasInternalRefactorLabel([]), false);
		assert.equal(hasInternalRefactorLabel(['priority:high', 'type:infra']), false);
	});

	it('case-insensitive: REFACTOR:INTERNAL-NO-DOC-IMPACT', () => {
		assert.equal(hasInternalRefactorLabel(['REFACTOR:INTERNAL-NO-DOC-IMPACT']), true);
	});

	it('部分一致は禁止 (悪用防止)', () => {
		assert.equal(hasInternalRefactorLabel(['refactor:internal-no-doc-impact-extra']), false);
		assert.equal(hasInternalRefactorLabel(['refactor:internal']), false);
	});
});

// ---------------------------------------------------------------------------
// PR_2054_SENTINEL_FIXTURE (AC5 — 回帰テスト fixture)
// ---------------------------------------------------------------------------

describe('PR_2054_SENTINEL_FIXTURE (#2063 AC5)', () => {
	it('PR-2054 偽装 fixture が 4 ペア (index/pricing × mobile/desktop) を含む', () => {
		assert.equal(PR_2054_SENTINEL_FIXTURE.prNumber, 2054);
		assert.equal(PR_2054_SENTINEL_FIXTURE.identicalPairs.length, 4);
	});

	it('fixture を detectIdenticalPairs に流すと全ペアが violation として返る (回帰検出)', () => {
		// fixture は実際に PR-2054 で起きた偽装の sha 組み合わせ。
		// detectIdenticalPairs が「beforeSha === afterSha」のロジックを保持していれば
		// この fixture を流したとき必ず 4 件全て violation 検出されるはず。
		const synthetic = PR_2054_SENTINEL_FIXTURE.identicalPairs.map((p) => ({
			key: p.key,
			before: p.before,
			after: p.after,
			beforeSha: p.sha, // 偽装のため same SHA
			afterSha: p.sha,
		}));
		const violations = detectIdenticalPairs(synthetic);
		assert.equal(violations.length, 4);
	});

	it('fixture の SHA 値が実 PR-2054 の値と一致 (回帰防止)', () => {
		// 取得元: gh api repos/Takenori-Kusaka/ganbari-quest/contents/pr-2054?ref=screenshots
		const expected = {
			'pr-2054/index-desktop.png': 'f4d9eebfca72e9efd30cf1c67621b3647357c0ba',
			'pr-2054/index-mobile.png': '82c0a8dfdbe4179c7f345308697b316b8a43e287',
			'pr-2054/pricing-desktop.png': '5706cee856a1b9fa0f4a55215fe62b66e1ba7d8b',
			'pr-2054/pricing-mobile.png': '910fcbf4b7395ad36334b3a506b2dff03933adb2',
		};
		for (const pair of PR_2054_SENTINEL_FIXTURE.identicalPairs) {
			assert.equal(pair.sha, expected[pair.key], `${pair.key} の SHA が想定値と異なる`);
		}
	});
});

// ---------------------------------------------------------------------------
// checkSsBlobShaUniqueness (E2E — fetch を mock injection)
// ---------------------------------------------------------------------------

/**
 * fetch を mock するヘルパー。path -> sha の map を返す疑似 API。
 *
 * @param {Record<string, string>} pathToSha
 */
function makeMockFetcher(pathToSha) {
	return async (url) => {
		// API URL 形式: https://api.github.com/repos/.../contents/<path>?ref=screenshots
		const m = url.match(/contents\/([^?]+)\?/);
		if (!m) {
			return { ok: false, status: 400, statusText: 'Bad Request', json: async () => ({}) };
		}
		const path = decodeURIComponent(m[1]);
		const sha = pathToSha[path];
		if (!sha) {
			return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
		}
		return { ok: true, status: 200, statusText: 'OK', json: async () => ({ sha }) };
	};
}

describe('checkSsBlobShaUniqueness (E2E)', () => {
	it('同一 SHA ペアあり → fail (AC1 偽装検出)', async () => {
		const body =
			'![before](https://raw.githubusercontent.com/o/r/screenshots/pr-1/before-x.png)\n' +
			'![after](https://raw.githubusercontent.com/o/r/screenshots/pr-1/after-x.png)';
		const fetcher = makeMockFetcher({
			'pr-1/before-x.png': 'samesha111',
			'pr-1/after-x.png': 'samesha111', // 偽装
		});
		const result = await checkSsBlobShaUniqueness({ body, labels: [], fetcher });
		assert.equal(result.status, 'fail');
		assert.equal(result.violations.length, 1);
		assert.equal(result.violations[0].sha, 'samesha111');
	});

	it('全 SHA 異 → pass (AC1 正常系)', async () => {
		const body =
			'![before](https://raw.githubusercontent.com/o/r/screenshots/pr-1/before-x.png)\n' +
			'![after](https://raw.githubusercontent.com/o/r/screenshots/pr-1/after-x.png)';
		const fetcher = makeMockFetcher({
			'pr-1/before-x.png': 'sha-A',
			'pr-1/after-x.png': 'sha-B', // 異なる
		});
		const result = await checkSsBlobShaUniqueness({ body, labels: [], fetcher });
		assert.equal(result.status, 'pass');
	});

	it('refactor:internal-no-doc-impact ラベル付与 → skip (AC3)', async () => {
		const body =
			'![before](https://raw.githubusercontent.com/o/r/screenshots/pr-1/before-x.png)\n' +
			'![after](https://raw.githubusercontent.com/o/r/screenshots/pr-1/after-x.png)';
		const fetcher = makeMockFetcher({
			'pr-1/before-x.png': 'same',
			'pr-1/after-x.png': 'same', // 偽装だが label exempt なので評価しない
		});
		const result = await checkSsBlobShaUniqueness({
			body,
			labels: ['refactor:internal-no-doc-impact'],
			fetcher,
		});
		assert.equal(result.status, 'skip');
		assert.match(result.reason, /refactor:internal-no-doc-impact/);
	});

	it('SS 0 件 → skip (AC4: 比較対象なし)', async () => {
		const body = '本文のみ、SS 添付なし';
		const result = await checkSsBlobShaUniqueness({
			body,
			labels: [],
			fetcher: makeMockFetcher({}),
		});
		assert.equal(result.status, 'skip');
	});

	it('before-only (single side) → skip (AC4: ペアなし)', async () => {
		const body = '![before](https://raw.githubusercontent.com/o/r/screenshots/pr-1/before-x.png)';
		const result = await checkSsBlobShaUniqueness({
			body,
			labels: [],
			fetcher: makeMockFetcher({ 'pr-1/before-x.png': 'sha1' }),
		});
		assert.equal(result.status, 'skip');
	});

	it('複数ペアで一部のみ偽装 → fail (該当ペアのみ violation)', async () => {
		const body = [
			'![b1](https://raw.githubusercontent.com/o/r/screenshots/pr-1/before-a.png)',
			'![a1](https://raw.githubusercontent.com/o/r/screenshots/pr-1/after-a.png)',
			'![b2](https://raw.githubusercontent.com/o/r/screenshots/pr-1/before-b.png)',
			'![a2](https://raw.githubusercontent.com/o/r/screenshots/pr-1/after-b.png)',
		].join('\n');
		const fetcher = makeMockFetcher({
			'pr-1/before-a.png': 'sha-AA',
			'pr-1/after-a.png': 'sha-AA', // 偽装
			'pr-1/before-b.png': 'sha-BB',
			'pr-1/after-b.png': 'sha-CC', // 正常
		});
		const result = await checkSsBlobShaUniqueness({ body, labels: [], fetcher });
		assert.equal(result.status, 'fail');
		assert.equal(result.violations.length, 1);
		assert.equal(result.violations[0].before, 'pr-1/before-a.png');
	});
});
