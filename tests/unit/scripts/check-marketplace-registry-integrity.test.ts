/**
 * check-marketplace-registry-integrity.mjs unit test — Issue #2374
 *
 * `scripts/check-marketplace-registry-integrity.mjs` CLI の動作検証:
 *  - 5 type 全件 register 済の現状で PASS (exit 0)
 *  - index.ts side-effect import 1 件欠落で FAIL (exit 1)
 *  - types module 1 件欠落で FAIL (exit 1)
 *  - MARKETPLACE_TYPE_CODES に新 type 追加 + 残実装欠落で FAIL (exit 1)
 *
 * #2389 fixture 隔離化 (Copilot AC1 [must]):
 *   旧実装は実 `src/lib/marketplace/*.ts` を書換えて `git checkout --` で復元していたが、
 *   ローカル dev で未コミット変更を巻き戻すリスクがあった。本リファクタで script 側に
 *   `--root <path>` 引数を追加し、各テストで `os.tmpdir()` 配下に
 *   `tests/fixtures/marketplace-registry-integrity/passing/` をコピー → 必要箇所のみ
 *   破壊 → `--root <tmp>` で subprocess 検証 → afterEach で tmp 削除、の流れに統一した。
 *   実コードベースを 1 度も書換えない (副作用 0)。
 *
 * 関連:
 *  - ADR-0052 (MarketplaceTypeRegistry + ImportStrategy)
 *  - Issue #2374 (Registry 完整性 CI + Round-trip E2E 必須化)
 *  - Issue #2389 (本 PR — fixture isolation 化)
 *  - scripts/check-marketplace-registry-integrity.mjs (--root 引数追加)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-marketplace-registry-integrity.mjs');
const FIXTURE_PASSING = path.join(
	REPO_ROOT,
	'tests/fixtures/marketplace-registry-integrity/passing',
);

/** subprocess で script を `--root <dir>` 付きで実行し exit code + stdout/stderr を取得 */
function runScript(rootDir: string): { status: number; stdout: string; stderr: string } {
	const result = spawnSync('node', [SCRIPT, '--root', rootDir], {
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

/**
 * fixture passing tree を新しい tmpdir にコピーし、コピー先 path を返す。
 *
 * 副作用ゼロを担保するため、各テストは固有 tmpdir を所有する (Vitest 並列 thread でも
 * 衝突しない、`fs.mkdtempSync` が unique suffix を返す)。
 */
function prepareFixture(): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-mrp-integrity-'));
	fs.cpSync(FIXTURE_PASSING, tmp, { recursive: true });
	return tmp;
}

function inFixture(root: string, rel: string): string {
	return path.join(root, 'src/lib/marketplace', rel);
}

describe('check-marketplace-registry-integrity.mjs (#2374 / #2389 fixture isolation)', () => {
	const tmpdirs: string[] = [];

	beforeEach(() => {
		// noop
	});

	afterEach(() => {
		// 作成した tmpdir を全て削除 (副作用 0 を担保)
		for (const dir of tmpdirs) {
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				// 削除失敗時は無視 (OS 都合で残った場合も次回 mkdtemp は別 path)
			}
		}
		tmpdirs.length = 0;
	});

	describe('PASS ケース', () => {
		it('5 type 全件 register 済の fixture で exit 0', () => {
			const root = prepareFixture();
			tmpdirs.push(root);
			const result = runScript(root);
			expect(result.status).toBe(0);
			expect(result.stdout).toMatch(/Registry 完整性 OK/);
			expect(result.stdout).toMatch(/全 5 type/);
		});

		it('MARKETPLACE_TYPE_CODES 5 値を正しく抽出している', () => {
			const root = prepareFixture();
			tmpdirs.push(root);
			const result = runScript(root);
			expect(result.stdout).toMatch(/activity-pack/);
			expect(result.stdout).toMatch(/reward-set/);
			expect(result.stdout).toMatch(/checklist/);
			expect(result.stdout).toMatch(/rule-preset/);
			expect(result.stdout).toMatch(/challenge-set/);
		});
	});

	describe('FAIL ケース (構造欠落検知)', () => {
		it('index.ts の side-effect import 1 件欠落で exit 1', () => {
			const root = prepareFixture();
			tmpdirs.push(root);
			const indexPath = inFixture(root, 'index.ts');
			const original = fs.readFileSync(indexPath, 'utf8');
			// challenge-set の side-effect import 行のみ削除
			const modified = original
				.split(/\r?\n/)
				.filter((line) => !line.includes("import './types/challenge-set.js'"))
				.join('\n');
			fs.writeFileSync(indexPath, modified);

			const result = runScript(root);
			expect(result.status).toBe(1);
			expect(result.stderr).toMatch(/challenge-set/);
			expect(result.stderr).toMatch(/missing-side-effect-import|完整性違反/);
		});

		it('types module 1 件欠落で exit 1 (challenge-set.ts 削除シミュレーション)', () => {
			const root = prepareFixture();
			tmpdirs.push(root);
			const challengeSetPath = inFixture(root, 'types/challenge-set.ts');
			fs.rmSync(challengeSetPath);

			const result = runScript(root);
			expect(result.status).toBe(1);
			expect(result.stderr).toMatch(/challenge-set/);
			expect(result.stderr).toMatch(/missing-type-module/);
		});

		it('MARKETPLACE_TYPE_CODES に新 type 追加 + 残実装欠落で exit 1 + 4 件以上の違反列挙', () => {
			const root = prepareFixture();
			tmpdirs.push(root);
			const typesPath = inFixture(root, 'types.ts');
			const original = fs.readFileSync(typesPath, 'utf8');
			// 'new-future-type' を追加 (schema / strategy / types module 全欠落想定)
			const modified = original.replace(
				/'challenge-set',(\s*)\]/m,
				"'challenge-set',$1\t'new-future-type',$1]",
			);
			expect(modified).not.toBe(original);
			fs.writeFileSync(typesPath, modified);

			const result = runScript(root);
			expect(result.status).toBe(1);
			expect(result.stderr).toMatch(/new-future-type/);
			// 4 つの違反種別: missing-side-effect-import / missing-type-module /
			// missing-strategy-file / missing-schema-file
			expect(result.stderr).toMatch(/4 件の完整性違反/);
		});

		it('error メッセージに fix 手順が明示されている (構造的再発防止)', () => {
			const root = prepareFixture();
			tmpdirs.push(root);
			const indexPath = inFixture(root, 'index.ts');
			const original = fs.readFileSync(indexPath, 'utf8');
			const modified = original
				.split(/\r?\n/)
				.filter((line) => !line.includes("import './types/reward-set.js'"))
				.join('\n');
			fs.writeFileSync(indexPath, modified);

			const result = runScript(root);
			expect(result.status).toBe(1);
			// fix セクションが含まれていること (AN-5 #2180 補強 7 構造的再発防止メッセージ)
			expect(result.stderr).toMatch(/fix/);
			expect(result.stderr).toMatch(/構造的再発防止/);
			expect(result.stderr).toMatch(/import '\.\/types\/reward-set\.js'/);
		});
	});

	describe('副作用ゼロ確認 (#2389)', () => {
		it('実 src/lib/marketplace/index.ts はテスト後も無変更', () => {
			// 本テスト実行時点で実コードベースの index.ts hash を取得
			const realIndex = path.join(REPO_ROOT, 'src/lib/marketplace/index.ts');
			const before = fs.readFileSync(realIndex, 'utf8');
			// fixture root でテストを動かす
			const root = prepareFixture();
			tmpdirs.push(root);
			const indexPath = inFixture(root, 'index.ts');
			fs.writeFileSync(indexPath, '/* mutated in fixture */\n');
			runScript(root);
			// 実コードベースは無変更
			const after = fs.readFileSync(realIndex, 'utf8');
			expect(after).toBe(before);
		});
	});
});
