// tests/unit/architecture/list-limit-not-reused-fitness.test.ts
// #4682 AC5 (ADR-0061 same-class-N→guard): 「一覧の limit を存在確認 / 集計に流用する」class の
// 再発を機械的に止める fitness function。
//
// 実害 (#4682):
//   - 承認 / 却下が `findRedemptionRequestsByTenant(tenantId)` (一覧 limit 50) から `find` していたため、
//     申請総数が 50 件を超えると古い承認待ちを親が処理できず、子供側は「うけとりまち」で固定した
//   - `/admin/points` の変換履歴・累計が `getPointHistory({ limit: 50 })` を filter / reduce していたため、
//     活動が多い子ではセクションごと消えた (渡し忘れ / 二重払いの原因)
//   - 承認履歴が「直近 30 申請の中の処理済み」だったため、承認待ちが 30 件あると履歴が 0 件になった
//
// 対処は「limit のある一覧 API を、単件取得 / 集計 / 種別抽出に使わない」こと:
//   単件取得 → findRedemptionRequestById / 件数 → countRedemptionRequestsByTenant
//   種別抽出 → findPointHistoryByType     / 合計 → sumPointsByType
//
// 本 test は **service / routes 層のソースを静的検査**する (repo 層は limit 付き一覧の実装本体なので対象外)。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// repo 走査 test (区分 SSOT: scripts/lib/ci/repo-scan-test-registry.mjs)。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** 検査対象 (呼び出し側)。repo 実装本体 (src/lib/server/db/) は対象外。 */
const SCAN_DIRS = ['src/lib/server/services', 'src/routes'];

/** limit を持つ「一覧」API。これらの戻り値を単件取得 / 集計に使ってはならない。 */
const LIMITED_LIST_APIS = ['findRedemptionRequestsByTenant', 'findPointHistory'] as const;

/**
 * 一覧の戻り値に対する「流用」の兆候。
 * `.find(` = 単件取得 / `.filter(` = 種別抽出 / `.reduce(` = 集計 / `.length` = 件数。
 */
const MISUSE_CHAINS = ['.find(', '.filter(', '.reduce(', '.length'] as const;

/**
 * 正当な例外。export は「取れるだけ取って足りなければ警告する」設計で、
 * 上限超過は `warnIfTruncated` で必ず可視化される (silent な過少集計ではない)。
 */
const ALLOWLIST: ReadonlyArray<{ file: string; reason: string }> = [
	{
		file: 'src/lib/server/services/export-service.ts',
		reason:
			'backup export は MAX_EXPORT_ROWS を明示上限とし、超過を warnIfTruncated で必ず報告する (silent な過少ではない)',
	},
];

/**
 * ソース文字列から「limit 付き一覧 API の戻り値をそのまま find / filter / reduce / length している」
 * 箇所を検出する。`await findX(...)` の直後に misuse chain が続く直結形を pin する
 * (変数に受けてから使う形まで静的に追うのは過剰なので、実害が出た形を確実に落とす)。
 */
function detectMisuse(src: string): string[] {
	const found: string[] = [];
	const chains = MISUSE_CHAINS.map((c) => c.replace(/[.(]/g, (m) => `\\${m}`)).join('|');
	for (const api of LIMITED_LIST_APIS) {
		const re = new RegExp(
			`${api}\\([^;]*\\)\\s*\\)?\\s*(?:\\.then\\([^;]*\\))?\\s*(${chains})`,
			's',
		);
		if (re.test(src)) found.push(`${api} の結果を直接 find/filter/reduce/length している`);
	}
	return found;
}

function listFiles(dir: string): string[] {
	const abs = path.join(REPO_ROOT, dir);
	if (!fs.existsSync(abs)) return [];
	const out: string[] = [];
	for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
		const rel = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...listFiles(rel));
		else if (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) out.push(rel);
	}
	return out;
}

describe('#4682 fitness: 一覧の limit を存在確認 / 集計に流用しない', () => {
	it('service / routes 層で「limit 付き一覧 → find / filter / reduce / length」を書かない', () => {
		const allowed = new Set(ALLOWLIST.map((a) => a.file.replaceAll('\\', '/')));
		const violations: string[] = [];

		for (const dir of SCAN_DIRS) {
			for (const rel of listFiles(dir)) {
				const normalized = rel.replaceAll('\\', '/');
				if (allowed.has(normalized)) continue;
				const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
				violations.push(...detectMisuse(src).map((m) => `${normalized}: ${m}`));
			}
		}

		expect(
			violations,
			[
				'一覧 API (limit 付き) の戻り値を単件取得 / 抽出 / 集計に使っています。',
				'  単件取得 → findRedemptionRequestById',
				'  件数     → countRedemptionRequestsByTenant',
				'  種別抽出 → findPointHistoryByType',
				'  合計     → sumPointsByType',
				violations.join('\n'),
			].join('\n'),
		).toEqual([]);
	});

	// 検出器が本当に効くことを固定する (guard 自身が空振りしていないことの証明)。
	it('#4682 で実際に壊れていた 3 形を検出できる (検出器の falsifiability)', () => {
		const approveMisuse =
			'const req = (await findRedemptionRequestsByTenant(tenantId)).find((r) => r.id === id);';
		const convertMisuse =
			"const h = (await findPointHistory(childId, { limit: 50, offset: 0 }, t)).filter((x) => x.type === 'convert');";
		const totalMisuse =
			'const total = (await findPointHistory(childId, { limit: 50, offset: 0 }, t)).reduce((a, b) => a + b.amount, 0);';
		expect(detectMisuse(approveMisuse).length).toBeGreaterThan(0);
		expect(detectMisuse(convertMisuse).length).toBeGreaterThan(0);
		expect(detectMisuse(totalMisuse).length).toBeGreaterThan(0);
	});

	it('正しい形 (単件取得 / 種別抽出 / SUM) は検出しない (誤検出しない)', () => {
		expect(detectMisuse('const r = await findRedemptionRequestById(id, tenantId);')).toEqual([]);
		expect(
			detectMisuse(
				"const h = await findPointHistoryByType(c, { type: 'convert', limit: 100 }, t);",
			),
		).toEqual([]);
		expect(detectMisuse("const s = await sumPointsByType(c, { type: 'convert' }, t);")).toEqual([]);
	});

	it('allowlist は理由付きで、対象 file が実在する (死んだ除外を残さない)', () => {
		for (const entry of ALLOWLIST) {
			expect(entry.reason.length, `${entry.file} の除外理由が空`).toBeGreaterThan(10);
			expect(
				fs.existsSync(path.join(REPO_ROOT, entry.file)),
				`allowlist の ${entry.file} が存在しない (stale)`,
			).toBe(true);
		}
	});
});
