// tests/unit/architecture/base-token-routes-ratchet.test.ts
// #3152 Phase 2 (ADR-0061 決定④ / item 5): 構造不変条件の fitness function 化 — Base token ratchet。
//
// DESIGN.md §2 / §9「Base トークンを routes / features で直接使用禁止 (var(--color-brand-500) 等を
// routes に書かない、Semantic トークン経由にする)」を機械強制する。ただし現状 routes/features の
// .svelte で **既存 221 occurrence (37 file)** が存在するため hard guard (0) は不可。
// lp-removal-residue / lp-inline-style と同じ **baseline ratchet** で「新規違反 0 (= 増やさない)」を
// 固定し、段階削減を促す (ADR-0061 = band-aid でなく class を lock、worsening を gate で止める)。
//
// 対象 Base token: --color-brand-* / --color-neutral-* / --color-premium-* の生スケール。
// --color-feedback-* は DESIGN.md §2 で Semantic 層 (routes 使用可) のため対象外。
//
// 削減したら BASELINE を下げる (ratchet-down)。増やすと CI が落ちる。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCAN_DIRS = [resolve(REPO_ROOT, 'src/routes'), resolve(REPO_ROOT, 'src/lib/features')];

// routes / features の .svelte で直接使用してはならない Base token (生スケール)。
const BASE_TOKEN_PATTERN = /var\(--color-(?:brand|neutral|premium)-[0-9]+\)/g;

// #3152 Phase 2 時点の既存違反数 (occurrence)。削減のたびに下げる。増加は CI fail。
const BASELINE_OCCURRENCES = 221;

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

function countBaseTokenOccurrences(): number {
	let total = 0;
	for (const dir of SCAN_DIRS) {
		for (const file of walkSvelteFiles(dir, [])) {
			const matches = readFileSync(file, 'utf-8').match(BASE_TOKEN_PATTERN);
			if (matches) total += matches.length;
		}
	}
	return total;
}

describe('#3152 Phase 2: routes/features の Base token 直接使用 ratchet (DESIGN.md §2/§9 / ADR-0061)', () => {
	it('Base token 直接使用は baseline を超えない (新規違反 0、増やさない)', () => {
		const actual = countBaseTokenOccurrences();
		expect(
			actual,
			`routes/features の Base token (--color-{brand,neutral,premium}-N) 直接使用が baseline ` +
				`(${BASELINE_OCCURRENCES}) を超えた (実測 ${actual})。Base トークンは Semantic トークン ` +
				'(--color-action-* / --color-surface-* / --color-text-* 等) 経由で参照する (DESIGN.md §2)。' +
				'削減した場合は本 BASELINE_OCCURRENCES を実測値まで下げる (ratchet-down)。',
		).toBeLessThanOrEqual(BASELINE_OCCURRENCES);
	});

	it('baseline は実測と乖離していない (stale baseline 検出、削減時は下げる)', () => {
		// 大きく下回った (= 削減済なのに baseline 据置) 場合に気付けるよう、20 occurrence 以上の
		// 余裕が出たら baseline 更新を促す (緩い下限。厳密一致は頻繁な更新を招くため避ける)。
		const actual = countBaseTokenOccurrences();
		expect(
			BASELINE_OCCURRENCES - actual,
			`Base token 使用が baseline より 20 以上少ない (実測 ${actual} / baseline ${BASELINE_OCCURRENCES})。` +
				'BASELINE_OCCURRENCES を実測値へ下げて ratchet を締める。',
		).toBeLessThan(20);
	});
});
