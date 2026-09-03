// tests/unit/infra/dependency-review-workflow.test.ts
//
// `.github/workflows/dependency-review.yml` (Dependency Review gate) の汎用契約。
// #4017 の brace-expansion waiver (旧 dependency-review-waiver.test.ts) は aws-cdk-lib 2.268.0 で
// 撤去条件に到達し同 test ごと消したが、その test が併せて固定していた **waiver 固有でない 2 契約**
// (旧 [W3] / [W4]) は gate の検査範囲そのものなので残す:
// - `fail-on-scopes: runtime` の固定 — root の devDependencies を検査対象外にしている前提。既定が
//   変わる / 誰かが development を足すと検査範囲が黙って変わる
// - `allow-ghsas` の不在 — waiver は GHSA ID 単位でしか書けず経路 (dev / bundled / runtime) を
//   区別できないため、1 件足すとその advisory はどの経路で入っても gate が黙る。足すなら
//   本 test を「根拠付きの 1 件だけ許す」形に戻し、根拠を workflow のコメントに書く
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const WORKFLOW_PATH = '.github/workflows/dependency-review.yml';

function readWorkflow(): string {
	return readFileSync(resolve(repoRoot, WORKFLOW_PATH), 'utf8');
}

/** `allow-ghsas:` 行から GHSA ID を取り出す (行が無ければ `null`)。コメント行は無視する。 */
export function parseAllowGhsas(workflow: string): string[] | null {
	const line = workflow
		.split('\n')
		.map((l) => l.trimStart())
		.find((l) => l.startsWith('allow-ghsas:'));
	if (line === undefined) return null;
	return line
		.split(':')
		.slice(1)
		.join(':')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

describe('dependency-review.yml の検査範囲の固定', () => {
	it('fail-on-scopes が runtime に固定されている (root devDependencies は対象外、という前提の明示)', () => {
		expect(readWorkflow()).toMatch(/^\s*fail-on-scopes:\s*runtime\s*$/m);
	});

	it('allow-ghsas は存在しない (waiver を足すなら根拠付きで本 test を「1 件だけ許す」形に戻す)', () => {
		const ids = parseAllowGhsas(readWorkflow());
		expect(
			ids,
			`${WORKFLOW_PATH} に allow-ghsas があります: ${JSON.stringify(ids)}。` +
				' GHSA 単位の waiver は経路を区別できず、その advisory がどの経路で入っても gate が黙ります。' +
				' 足す場合は根拠 (影響経路 / 撤去条件) を workflow のコメントに書き、本 test を根拠付き 1 件許容に更新してください',
		).toBeNull();
	});

	it('parseAllowGhsas はコメント行を waiver と誤認しない', () => {
		expect(parseAllowGhsas('      # allow-ghsas: GHSA-xxxx-xxxx-xxxx (コメント)\n')).toBeNull();
		expect(
			parseAllowGhsas('          allow-ghsas: GHSA-aaaa-bbbb-cccc, GHSA-dddd-eeee-ffff\n'),
		).toEqual(['GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff']);
	});
});
