/**
 * tests/unit/scripts/check-ss-blob-sha-uniqueness.test.ts (#4084 / #2063)
 *
 * 検証対象: SS 偽装検知 gate が「検知できなかったとき」に黙らないこと。
 *
 * 実測 (#4084、PR #4080):
 *   - PR body に SS が 20 枚 embed されている (`ref=screenshots` の raw URL を 20 件抽出)
 *   - しかし file 名が `develop-*` / `pr4080-*` で `before-*` / `after-*` に一致しないため
 *     `pairBeforeAfter()` が 0 件を返し、gate は `[ss-blob-sha-uniqueness] SKIP` で終わっていた
 *   - **20 枚あって偽装検知が 1 ペアも実行されない**状態が silent に pass していた
 *   - さらに #4080 の Before / After 20 枚は sha256 完全一致だが、これは「JST 00:00〜09:00 の
 *     9 時間帯だけ日付がずれる」修正を差分窓の外 (JST 日中) に撮影したためで**同一が正しい**。
 *     命名を規約どおりに直すと今度は hard-fail する = 正直に撮った PR が落ちる経路しかなかった
 *
 * 本 test は (a) 0 ペア = fail、(b) 命名非依存のペアリング宣言、(c) 同一が正しい場合の
 * 理由必須宣言 の 3 点を固定し、既存の偽装検知 (#2063 PR-2054 sentinel) を弱めないことも固定する。
 */

import { describe, expect, it } from 'vitest';
import {
	checkSsBlobShaUniqueness,
	detectIdenticalPairs,
	PR_2054_SENTINEL_FIXTURE,
	pairBeforeAfter,
	pairScreenshots,
	parsePairDeclarations,
	parseReasonDeclaration,
} from '../../../scripts/check-ss-blob-sha-uniqueness.mjs';

const OWNER = 'Takenori-Kusaka';
const REPO = 'ganbari-quest';

/** #4080 の実 SS 命名 (develop-* / pr4080-*)。抜粋 3 組。 */
const PR_4080_KEYS = ['admin-points-mobile', 'admin-points-desktop', 'child-home-mobile'];

function rawUrl(path: string): string {
	return `https://raw.githubusercontent.com/${OWNER}/${REPO}/screenshots/${path}`;
}

/** #4080 と同じ命名で SS を embed した body を組み立てる。 */
function pr4080Body(extra = ''): string {
	const imgs = PR_4080_KEYS.flatMap((k) => [
		`![before](${rawUrl(`pr-4080/develop-${k}.png`)})`,
		`![after](${rawUrl(`pr-4080/pr4080-${k}.png`)})`,
	]).join('\n');
	return `## スクリーンショット\n\n${imgs}\n\n${extra}\n`;
}

/** 規約どおりの before-* / after-* 命名 body。 */
function canonicalBody(extra = ''): string {
	const imgs = PR_4080_KEYS.flatMap((k) => [
		`![before](${rawUrl(`pr-4090/before-${k}.png`)})`,
		`![after](${rawUrl(`pr-4090/after-${k}.png`)})`,
	]).join('\n');
	return `## スクリーンショット\n\n${imgs}\n\n${extra}\n`;
}

/** path → sha を返す fetch mock。 */
function shaFetcher(shaByPath: Record<string, string>): typeof fetch {
	return (async (url: string) => {
		const afterContents = String(url).split('/contents/')[1] ?? '';
		const path = decodeURIComponent(afterContents.split('?')[0] ?? '');
		const sha = shaByPath[path];
		if (!sha) throw new Error(`fixture に sha 未定義: ${path}`);
		return { ok: true, status: 200, statusText: 'OK', json: async () => ({ sha }) };
	}) as unknown as typeof fetch;
}

/** 全ペアが同一 SHA になる fetcher (#4080 の実状況)。 */
function identicalShaFetcher(beforePrefix: string, afterPrefix: string, dir: string): typeof fetch {
	const map: Record<string, string> = {};
	PR_4080_KEYS.forEach((k, i) => {
		const sha = `deadbeef${i}`.padEnd(40, '0');
		map[`${dir}/${beforePrefix}${k}.png`] = sha;
		map[`${dir}/${afterPrefix}${k}.png`] = sha;
	});
	return shaFetcher(map);
}

/** 全ペアが別 SHA になる fetcher (正常に撮り直した PR)。 */
function distinctShaFetcher(beforePrefix: string, afterPrefix: string, dir: string): typeof fetch {
	const map: Record<string, string> = {};
	PR_4080_KEYS.forEach((k, i) => {
		map[`${dir}/${beforePrefix}${k}.png`] = `aaaa${i}`.padEnd(40, '0');
		map[`${dir}/${afterPrefix}${k}.png`] = `bbbb${i}`.padEnd(40, '0');
	});
	return shaFetcher(map);
}

const VALID_REASON =
	'JST 00:00〜09:00 の窓外 (日中) に撮影したため描画一致が正しい。差分は固定時刻注入の unit test で実証';

describe('#4084 (a) SS があるのにペア 0 件を silent skip しない', () => {
	it('[P1] SS 20 枚相当が embed されているのにペア 0 件なら fail する (現状は skip だった)', async () => {
		const r = await checkSsBlobShaUniqueness({
			body: pr4080Body(),
			labels: [],
			fetcher: shaFetcher({}),
		});
		expect(r.status).toBe('fail');
		expect(r.reason).toContain('0');
		// 「何枚あって何ペア検査できたか」が出力から読めること (検知できたか否かの可視化)
		expect(r.reason).toMatch(/6\s*件|SS 6/);
	});

	it('[P2] SS が 1 枚も無い body は従来どおり skip (対象なし)', async () => {
		const r = await checkSsBlobShaUniqueness({
			body: '## スクリーンショット\n\n該当なし (script / test のみ)\n',
			labels: [],
			fetcher: shaFetcher({}),
		});
		expect(r.status).toBe('skip');
	});

	it('[P3] refactor:internal-no-doc-impact label は従来どおり skip (#2063 AC3 を弱めない)', async () => {
		const r = await checkSsBlobShaUniqueness({
			body: pr4080Body(),
			labels: ['refactor:internal-no-doc-impact'],
			fetcher: shaFetcher({}),
		});
		expect(r.status).toBe('skip');
	});

	it('[P4] ペアが取れない正当理由は宣言で通す。理由が空なら fail (#3956 教訓)', async () => {
		const withReason = await checkSsBlobShaUniqueness({
			body: pr4080Body('<!-- ss-pair-none: 新規画面のため修正前の SS が原理的に存在しない -->'),
			labels: [],
			fetcher: shaFetcher({}),
		});
		expect(withReason.status).toBe('pass');
		expect(withReason.reason).toContain('新規画面');

		const emptyReason = await checkSsBlobShaUniqueness({
			body: pr4080Body('<!-- ss-pair-none: -->'),
			labels: [],
			fetcher: shaFetcher({}),
		});
		expect(emptyReason.status).toBe('fail');

		const stubReason = await checkSsBlobShaUniqueness({
			body: pr4080Body('<!-- ss-pair-none: TODO -->'),
			labels: [],
			fetcher: shaFetcher({}),
		});
		expect(stubReason.status).toBe('fail');
	});
});

describe('#4084 (b) ペアリングを命名依存から緩和する', () => {
	it('[P5] prefix 宣言で develop-* / pr4080-* をペアにできる (#4080 の実命名)', () => {
		const paths = PR_4080_KEYS.flatMap((k) => [
			`pr-4080/develop-${k}.png`,
			`pr-4080/pr4080-${k}.png`,
		]);
		const decls = parsePairDeclarations('<!-- ss-pair-prefix: before=develop- after=pr4080- -->');
		const pairs = pairScreenshots(paths, decls);
		expect(pairs).toHaveLength(3);
		expect(pairs.map((p) => p.before)).toContain('pr-4080/develop-admin-points-mobile.png');
		expect(pairs.map((p) => p.after)).toContain('pr-4080/pr4080-admin-points-mobile.png');
	});

	it('[P6] 個別ペア宣言 (ss-pair) でも対応関係を取れる', () => {
		const decls = parsePairDeclarations(
			`<!-- ss-pair: before=${rawUrl('x/old-1.png')} after=${rawUrl('x/new-1.png')} -->`,
		);
		const pairs = pairScreenshots(['x/old-1.png', 'x/new-1.png'], decls);
		expect(pairs).toEqual([
			{ key: 'x/old-1.png ⇄ x/new-1.png', before: 'x/old-1.png', after: 'x/new-1.png' },
		]);
	});

	it('[P7] 宣言が無ければ従来の before-* / after-* 命名で引き続きペアが取れる', () => {
		const paths = PR_4080_KEYS.flatMap((k) => [
			`pr-4090/before-${k}.png`,
			`pr-4090/after-${k}.png`,
		]);
		expect(pairScreenshots(paths, parsePairDeclarations(''))).toHaveLength(3);
		// 既存 export も従来どおり動く (#2063 回帰)
		expect(pairBeforeAfter(paths)).toHaveLength(3);
	});

	it('[P8] prefix 宣言で pair が取れれば SHA 比較まで進み、別 SHA なら pass', async () => {
		const r = await checkSsBlobShaUniqueness({
			body: pr4080Body('<!-- ss-pair-prefix: before=develop- after=pr4080- -->'),
			labels: [],
			fetcher: distinctShaFetcher('develop-', 'pr4080-', 'pr-4080'),
		});
		expect(r.status).toBe('pass');
		expect(r.reason).toContain('3');
	});
});

describe('#4084 (c) Before/After が同一で正しいケースの明示経路', () => {
	it('[P9] 同一 SHA + 理由あり宣言なら pass (理由を出力に残す)', async () => {
		const r = await checkSsBlobShaUniqueness({
			body: pr4080Body(
				`<!-- ss-pair-prefix: before=develop- after=pr4080- -->\n<!-- ss-identical-ok: ${VALID_REASON} -->`,
			),
			labels: [],
			fetcher: identicalShaFetcher('develop-', 'pr4080-', 'pr-4080'),
		});
		expect(r.status).toBe('pass');
		expect(r.reason).toContain('JST');
		// 同一だった事実自体は握り潰さず列挙する
		expect(r.acknowledgedIdenticalPairs).toHaveLength(3);
	});

	it('[P10] 同一 SHA + 理由なし宣言は fail (理由の非強制を作らない、#3956)', async () => {
		const r = await checkSsBlobShaUniqueness({
			body: pr4080Body(
				'<!-- ss-pair-prefix: before=develop- after=pr4080- -->\n<!-- ss-identical-ok: -->',
			),
			labels: [],
			fetcher: identicalShaFetcher('develop-', 'pr4080-', 'pr-4080'),
		});
		expect(r.status).toBe('fail');
		expect(r.reason).toContain('理由');
	});

	it('[P11] 同一 SHA + 宣言なしは従来どおり fail (#2063 偽装検知を弱めない)', async () => {
		const r = await checkSsBlobShaUniqueness({
			body: canonicalBody(),
			labels: [],
			fetcher: identicalShaFetcher('before-', 'after-', 'pr-4090'),
		});
		expect(r.status).toBe('fail');
		expect(r.violations).toHaveLength(3);
	});

	it('[P12] PR-2054 偽装 sentinel は引き続き検出される (#2063 AC5 回帰)', () => {
		const pairsWithSha = PR_2054_SENTINEL_FIXTURE.identicalPairs.map((p) => ({
			key: p.key,
			before: p.before,
			after: p.after,
			beforeSha: p.sha,
			afterSha: p.sha,
		}));
		expect(detectIdenticalPairs(pairsWithSha)).toHaveLength(4);
		// 命名規則ペアリングも維持
		expect(
			pairBeforeAfter(PR_2054_SENTINEL_FIXTURE.identicalPairs.flatMap((p) => [p.before, p.after])),
		).toHaveLength(4);
	});

	it('[P13] parseReasonDeclaration が空 / 定型 stub を理由として認めない', () => {
		expect(parseReasonDeclaration('<!-- ss-identical-ok: -->', 'ss-identical-ok')).toEqual({
			present: true,
			reason: '',
			valid: false,
		});
		for (const stub of ['TODO', 'n/a', '-', 'なし', '後で書く']) {
			expect(
				parseReasonDeclaration(`<!-- ss-identical-ok: ${stub} -->`, 'ss-identical-ok').valid,
			).toBe(false);
		}
		expect(parseReasonDeclaration('', 'ss-identical-ok')).toEqual({
			present: false,
			reason: '',
			valid: false,
		});
		expect(
			parseReasonDeclaration(`<!-- ss-identical-ok: ${VALID_REASON} -->`, 'ss-identical-ok').valid,
		).toBe(true);
	});
});
