/**
 * tests/unit/scripts/check-repo-scan-test-declaration.test.ts (#4085)
 *
 * 検証対象: repo 走査 test の「区分宣言」gate。
 *
 * repo 全体の file を実読する test は実行時間が入力サイズに比例するため、既定 timeout (5s) の
 * まま unit lane に置くと並列実行の負荷で落ちる。同 class が 4 例に達した (#3972/#4000 →
 * PR #4067 / #3978 → PR #4066 / `page-guide-coverage` 6240ms /
 * `ci-unit-test-path-filter-closure` 5533ms) ため、instance 修正ではなく機械 gate 化した
 * (ADR-0061 same-class-N→guard)。
 *
 * 本 test は fixture 注入で gate の判定だけを固定する (実 repo は走査しないので bounded)。
 * 実 repo に対する検査は pre-ready Step 7f / CI job が担う。
 */

import { describe, expect, it, vi } from 'vitest';

// #4085: 本 file は実走査をしないが、fixture 文字列に走査 API と repo root リテラルを含むため
// gate の静的判定は保守的に scope='repo' になる。誤検出のコストは明示 timeout 1 行なので、
// 判定を緩めるのではなくこちらを合わせる (宣言で検査を無効化しない原則を自分にも適用する)。
vi.setConfig({ testTimeout: 60_000 });

import {
	analyzeTestSource,
	checkRepoScanTestDeclarations,
} from '../../../scripts/check-repo-scan-test-declaration.mjs';
import {
	MIN_REPO_SCAN_TIMEOUT_MS,
	REPO_SCAN_TEST_REGISTRY,
} from '../../../scripts/lib/ci/repo-scan-test-registry.mjs';

/** repo ツリーを走査する test の骨格 (timeout の有無を切り替えられる)。 */
function repoScanSource(withTimeout: boolean): string {
	return `import { readdirSync } from 'node:fs';
import { describe, expect, it${withTimeout ? ', vi' : ''} } from 'vitest';
${withTimeout ? 'vi.setConfig({ testTimeout: 60_000 });' : ''}
const SCAN_ROOTS = ['src', 'scripts'];
describe('x', () => { it('y', () => { expect(readdirSync(SCAN_ROOTS[0]).length).toBeGreaterThan(0); }); });
`;
}

/** fixture dir だけを読む有界 test。 */
const BOUNDED_SOURCE = `import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('x', () => { it('y', () => { expect(readdirSync(tmpDir).length).toBe(0); }); });
`;

/** 走査 API を使わない普通の test。 */
const PLAIN_SOURCE = `import { describe, expect, it } from 'vitest';
describe('x', () => { it('y', () => { expect(1).toBe(1); }); });
`;

function runGate(
	files: Record<string, string>,
	registry: Record<string, { scope: 'repo' | 'bounded'; note: string }>,
) {
	return checkRepoScanTestDeclarations({
		files: Object.keys(files),
		readFile: (p) => files[p] ?? '',
		registry,
	});
}

describe('#4085 repo 走査 test の区分宣言 gate', () => {
	it('[R1] 未宣言の repo 走査 test を fail させる (AC2 の核)', () => {
		const { violations } = runGate(
			{ 'tests/unit/x/new-scan.test.ts': repoScanSource(true) },
			{ 'tests/unit/x/other.test.ts': { scope: 'repo', note: 'n' } },
		);
		const undeclared = violations.filter((v) => v.id === 'undeclared');
		expect(undeclared).toHaveLength(1);
		expect(undeclared[0]?.path).toBe('tests/unit/x/new-scan.test.ts');
		// 貼り付け用のエントリを出して「どう直すか」を示す
		expect(undeclared[0]?.message).toContain("scope: 'repo'");
	});

	it('[R2] scope=repo で明示 timeout が無ければ fail (例3 / 例4 の再発を止める)', () => {
		const { violations } = runGate(
			{ 'tests/unit/architecture/page-guide-coverage.test.ts': repoScanSource(false) },
			{
				'tests/unit/architecture/page-guide-coverage.test.ts': { scope: 'repo', note: 'n' },
			},
		);
		expect(violations.map((v) => v.id)).toContain('missing-timeout');
		expect(violations[0]?.message).toContain(String(MIN_REPO_SCAN_TIMEOUT_MS));
	});

	it('[R3] scope=repo + 明示 timeout なら pass', () => {
		const { violations } = runGate(
			{ 'tests/unit/x/scan.test.ts': repoScanSource(true) },
			{ 'tests/unit/x/scan.test.ts': { scope: 'repo', note: 'n' } },
		);
		expect(violations).toEqual([]);
	});

	it('[R4] bounded と自己申告して timeout 要求を回避できない (宣言が検査を無効化しない)', () => {
		const { violations } = runGate(
			{ 'tests/unit/x/scan.test.ts': repoScanSource(false) },
			{ 'tests/unit/x/scan.test.ts': { scope: 'bounded', note: '嘘の申告' } },
		);
		expect(violations.map((v) => v.id)).toContain('scope-mismatch');
	});

	it('[R5] 有界 test は bounded 宣言のみで pass / 走査しない test は対象外', () => {
		const { violations, candidates } = runGate(
			{
				'tests/unit/x/bounded.test.ts': BOUNDED_SOURCE,
				'tests/unit/x/plain.test.ts': PLAIN_SOURCE,
			},
			{ 'tests/unit/x/bounded.test.ts': { scope: 'bounded', note: 'temp dir のみ' } },
		);
		expect(violations).toEqual([]);
		expect(candidates.map((c) => c.path)).toEqual(['tests/unit/x/bounded.test.ts']);
	});

	it('[R6] stale なエントリ (file 消滅 / 走査をやめた) を fail させる', () => {
		const { violations } = runGate(
			{
				'tests/unit/x/plain.test.ts': PLAIN_SOURCE,
				'tests/unit/x/scan.test.ts': repoScanSource(true),
			},
			{
				'tests/unit/x/scan.test.ts': { scope: 'repo', note: 'n' },
				'tests/unit/x/plain.test.ts': { scope: 'bounded', note: 'もう走査していない' },
				'tests/unit/x/deleted.test.ts': { scope: 'repo', note: '消えた file' },
			},
		);
		expect(
			violations
				.filter((v) => v.id === 'stale-entry')
				.map((v) => v.path)
				.sort(),
		).toEqual(['tests/unit/x/deleted.test.ts', 'tests/unit/x/plain.test.ts']);
	});

	it('[R7] 候補 0 件は「違反なし」ではなく fail (検出 pattern の腐りを silent に通さない)', () => {
		const { violations } = runGate({ 'tests/unit/x/plain.test.ts': PLAIN_SOURCE }, {});
		expect(violations.map((v) => v.id)).toEqual(['no-candidates']);
	});

	it('[R8] analyzeTestSource が timeout 宣言 3 形式を拾う', () => {
		expect(analyzeTestSource(repoScanSource(true)).maxTimeoutMs).toBe(60_000);
		expect(
			analyzeTestSource(`import { readdirSync } from 'node:fs';
const roots = ['src'];
it('x', () => { readdirSync(roots[0]); }, 60_000);`).maxTimeoutMs,
		).toBe(60_000);
		expect(
			analyzeTestSource(`import { readdirSync } from 'node:fs';
const roots = ['scripts'];
describe('x', { timeout: 30000 }, () => { readdirSync(roots[0]); });`).maxTimeoutMs,
		).toBe(30_000);
	});

	it('[R9] 実 registry の 4 実測例が scope=repo で宣言されている (AC3)', () => {
		// 例1 (#3972/#4000) は PR #4067 で unit lane から外れたため候補ではない。
		// 例2 (#3978)・例3 (page-guide)・例4 (path-filter-closure) は unit lane に残る repo 走査。
		for (const p of [
			'tests/unit/scripts/check-readdir-rotation-guard.test.ts',
			'tests/unit/architecture/page-guide-coverage.test.ts',
			'tests/unit/architecture/ci-unit-test-path-filter-closure.test.ts',
		]) {
			expect(REPO_SCAN_TEST_REGISTRY[p]?.scope).toBe('repo');
		}
	});
});
