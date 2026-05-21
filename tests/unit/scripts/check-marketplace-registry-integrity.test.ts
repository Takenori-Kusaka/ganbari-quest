/**
 * check-marketplace-registry-integrity.mjs unit test — Issue #2374
 *
 * `scripts/check-marketplace-registry-integrity.mjs` CLI の動作検証:
 *  - 5 type 全件 register 済の現状で PASS (exit 0)
 *  - index.ts side-effect import 1 件欠落で FAIL (exit 1)
 *  - types module 1 件欠落で FAIL (exit 1)
 *  - MARKETPLACE_TYPE_CODES に新 type 追加 + 残実装欠落で FAIL (exit 1)
 *
 * CLI subprocess test 方式 (Node spawn) で実 CI 挙動と一致させる。
 * 副作用 (ファイル変更) は git checkout で復元する。
 *
 * 関連:
 *  - ADR-0052 (MarketplaceTypeRegistry + ImportStrategy)
 *  - Issue #2374 (Registry 完整性 CI + Round-trip E2E 必須化)
 *  - scripts/check-marketplace-registry-integrity.mjs
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const SCRIPT = path.join(REPO_ROOT, 'scripts/check-marketplace-registry-integrity.mjs');
const INDEX_TS = path.join(REPO_ROOT, 'src/lib/marketplace/index.ts');
const TYPES_TS = path.join(REPO_ROOT, 'src/lib/marketplace/types.ts');
const CHALLENGE_SET_TYPE_MODULE = path.join(
	REPO_ROOT,
	'src/lib/marketplace/types/challenge-set.ts',
);

/** subprocess で script を実行し exit code + stdout/stderr を取得 */
function runScript(): { status: number; stdout: string; stderr: string } {
	const result = spawnSync('node', [SCRIPT], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		shell: false,
	});
	return {
		status: result.status ?? -1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

/** git checkout で対象ファイルを HEAD 状態に復元 */
function gitRestore(file: string): void {
	const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
	execSync(`git checkout -- "${rel}"`, { cwd: REPO_ROOT });
}

describe('check-marketplace-registry-integrity.mjs (#2374)', () => {
	const modifiedFiles: string[] = [];

	afterEach(() => {
		// 各テスト後に変更したファイルを HEAD に復元 (副作用打消)
		for (const file of modifiedFiles) {
			if (fs.existsSync(file) || file === CHALLENGE_SET_TYPE_MODULE) {
				try {
					gitRestore(file);
				} catch {
					// 復元失敗時は無視 (新規作成ファイル等)
				}
			}
		}
		modifiedFiles.length = 0;
	});

	describe('PASS ケース', () => {
		it('5 type 全件 register 済の現状で exit 0', () => {
			const result = runScript();
			expect(result.status).toBe(0);
			expect(result.stdout).toMatch(/Registry 完整性 OK/);
			expect(result.stdout).toMatch(/全 5 type/);
		});

		it('MARKETPLACE_TYPE_CODES 5 値を正しく抽出している', () => {
			const result = runScript();
			expect(result.stdout).toMatch(/activity-pack/);
			expect(result.stdout).toMatch(/reward-set/);
			expect(result.stdout).toMatch(/checklist/);
			expect(result.stdout).toMatch(/rule-preset/);
			expect(result.stdout).toMatch(/challenge-set/);
		});
	});

	describe('FAIL ケース (構造欠落検知)', () => {
		it('index.ts の side-effect import 1 件欠落で exit 1', () => {
			const original = fs.readFileSync(INDEX_TS, 'utf8');
			// challenge-set の side-effect import 行のみ削除 (block comment 内の参照は残す)
			const modified = original
				.split(/\r?\n/)
				.filter((line) => !line.includes("import './types/challenge-set.js'"))
				.join('\n');
			fs.writeFileSync(INDEX_TS, modified);
			modifiedFiles.push(INDEX_TS);

			const result = runScript();
			expect(result.status).toBe(1);
			expect(result.stderr).toMatch(/challenge-set/);
			expect(result.stderr).toMatch(/missing-side-effect-import|完整性違反/);
		});

		it('types module 1 件欠落で exit 1 (challenge-set.ts 削除シミュレーション)', () => {
			// challenge-set.ts を rename で一時的に隠す
			const tempPath = `${CHALLENGE_SET_TYPE_MODULE}.bak`;
			fs.renameSync(CHALLENGE_SET_TYPE_MODULE, tempPath);
			try {
				const result = runScript();
				expect(result.status).toBe(1);
				expect(result.stderr).toMatch(/challenge-set/);
				expect(result.stderr).toMatch(/missing-type-module/);
			} finally {
				// 復元
				fs.renameSync(tempPath, CHALLENGE_SET_TYPE_MODULE);
			}
		});

		it('MARKETPLACE_TYPE_CODES に新 type 追加 + 残実装欠落で exit 1 + 4 件以上の違反列挙', () => {
			const original = fs.readFileSync(TYPES_TS, 'utf8');
			// 'new-future-type' を追加 (schema / strategy / types module 全欠落想定)
			const modified = original.replace(
				/'challenge-set',(\s*)\]/m,
				"'challenge-set',$1\t'new-future-type',$1]",
			);
			expect(modified).not.toBe(original);
			fs.writeFileSync(TYPES_TS, modified);
			modifiedFiles.push(TYPES_TS);

			const result = runScript();
			expect(result.status).toBe(1);
			expect(result.stderr).toMatch(/new-future-type/);
			// 4 つの違反種別: missing-side-effect-import / missing-type-module /
			// missing-strategy-file / missing-schema-file
			expect(result.stderr).toMatch(/4 件の完整性違反/);
		});

		it('error メッセージに fix 手順が明示されている (構造的再発防止)', () => {
			const original = fs.readFileSync(INDEX_TS, 'utf8');
			const modified = original
				.split(/\r?\n/)
				.filter((line) => !line.includes("import './types/reward-set.js'"))
				.join('\n');
			fs.writeFileSync(INDEX_TS, modified);
			modifiedFiles.push(INDEX_TS);

			const result = runScript();
			expect(result.status).toBe(1);
			// fix セクションが含まれていること (AN-5 #2180 補強 7 構造的再発防止メッセージ)
			expect(result.stderr).toMatch(/fix/);
			expect(result.stderr).toMatch(/構造的再発防止/);
			expect(result.stderr).toMatch(/import '\.\/types\/reward-set\.js'/);
		});
	});
});
