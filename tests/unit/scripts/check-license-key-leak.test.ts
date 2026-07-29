/**
 * tests/unit/scripts/check-license-key-leak.test.ts (#2836 PR-L4 / #2860 PR-L5)
 *
 * scripts/check-license-key-leak.mjs の純関数 (副作用なし) を検証する。
 * PR-L5 (#2860) で DB 層 / enum / service 層を物理削除し、allowlist は LEGACY_URL_MAP のみに縮小
 * (完全ゼロ化)。
 * - isFileAllowlisted: LEGACY_URL_MAP file のみ allowlist (旧 DB 層 allowlist は撤去済)
 * - isCommentLine: 履歴コメント行を許容
 * - findViolationsInContent: allowlist 外のコード行 license key 参照を検出
 * - findAllViolations: 実 repo (src/ + site/) で再導入ゼロを保証
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
	findAllViolations,
	findViolationsInContent,
	isCommentLine,
	isFileAllowlisted,
	parseBudgetMs,
} from '../../../scripts/check-license-key-leak.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('check-license-key-leak (#2836)', () => {
	describe('isFileAllowlisted', () => {
		it.each([
			'src/lib/server/routing/legacy-url-map.ts',
		])('LEGACY_URL_MAP file のみ allowlist: %s', (rel) => {
			expect(isFileAllowlisted(rel)).toBe(true);
		});

		it.each([
			// PR-L5 (#2860) で DB 層を物理削除したため、旧 allowlist file は scan 対象 (= false) に戻った
			'src/lib/server/db/dsql/auth-repo.ts',
			'src/lib/server/db/sqlite/auth-repo.ts',
			'src/lib/domain/validation/auth.ts',
			'src/lib/server/auth/entities.ts',
			'src/lib/server/services/license-service.ts',
			'src/lib/runtime/env.ts',
			// LP / ラベル / UI file は元から allowlist 対象外
			'src/lib/domain/labels.ts',
			'src/lib/features/admin/components/SaasLicensePanel.svelte',
			'src/routes/(parent)/admin/subscription/+page.server.ts',
			'site/pricing.html',
		])('DB 層 (撤去後) / LP / ラベル / UI file は allowlist 対象外: %s', (rel) => {
			expect(isFileAllowlisted(rel)).toBe(false);
		});

		it('Windows path 区切り (\\) でも判定できる', () => {
			expect(isFileAllowlisted('src\\lib\\server\\routing\\legacy-url-map.ts')).toBe(true);
		});
	});

	describe('isCommentLine', () => {
		it.each([
			'// license key 撤去済 (#2818)',
			'  // ライセンスキー適用 UI は撤去済',
			' * licenseKey 因子を撤廃 (#2813)',
			'/* LICENSE_KEY block comment */',
			'<!-- 旧 license-key.html は削除済 -->',
			'# license-key reference in shell/yaml',
		])('コメント行は true: %s', (line) => {
			expect(isCommentLine(line)).toBe(true);
		});

		it.each([
			"const x = 'ライセンスキー';",
			'subject: ライセンスキーをお届け',
			'<a href="/help/license-key">',
		])('コード行は false: %s', (line) => {
			expect(isCommentLine(line)).toBe(false);
		});
	});

	describe('findViolationsInContent', () => {
		it('allowlist 外 file のコード行 license key 参照を検出する', () => {
			const content = ['const a = 1;', "const msg = 'ライセンスキーを入力';", 'const b = 2;'].join(
				'\n',
			);
			const result = findViolationsInContent('site/some-new-page.html', content);
			expect(result).toHaveLength(1);
			expect(result[0]?.line).toBe(2);
			expect(result[0]?.file).toBe('site/some-new-page.html');
		});

		it('コメント行の license key 参照は許容する (検出ゼロ)', () => {
			const content = ['// 旧 licenseKey は撤去済 (#2818)', 'const ok = true;'].join('\n');
			expect(findViolationsInContent('src/lib/features/foo.svelte', content)).toHaveLength(0);
		});

		it('allowlist file (legacy-url-map) 内のコード行 license key 参照は許容する', () => {
			const content = ["{ from: '/help/license-key', to: '/admin/subscription' },"].join('\n');
			expect(
				findViolationsInContent('src/lib/server/routing/legacy-url-map.ts', content),
			).toHaveLength(0);
		});

		it('license key 参照のないコード行は検出しない', () => {
			const content = ['const a = 1;', 'const b = 2;'].join('\n');
			expect(findViolationsInContent('site/index.html', content)).toHaveLength(0);
		});

		// PR-L5 #2879: SUBSCRIPTION_PLAN rename 後の license-plan 系識別子の再導入防止
		it.each([
			"import { LICENSE_PLAN } from '$lib/domain/constants/license-plan';",
			'const plan: LicensePlan = ...;',
			"import x from '$lib/domain/constants/license-plan';",
		])('rename 後の license-plan 系識別子をコード行で検出する: %s', (line) => {
			const content = ['const ok = true;', line, 'const done = false;'].join('\n');
			const result = findViolationsInContent('src/lib/features/foo.svelte', content);
			expect(result).toHaveLength(1);
			expect(result[0]?.line).toBe(2);
		});

		it('license-plan 系のコメント行は許容する (検出ゼロ)', () => {
			const content = [
				'// 旧 LICENSE_PLAN は SUBSCRIPTION_PLAN へ rename 済 (#2879)',
				'const ok = true;',
			].join('\n');
			expect(findViolationsInContent('src/lib/features/foo.svelte', content)).toHaveLength(0);
		});
	});

	// #4000: 「実 repo 全走査」を unit lane から外し、gate が両 lane に配線されていることの
	// 検証に置き換える。
	//
	// ## なぜ外すか (計測結果)
	//
	// `findAllViolations()` は src/ + site/ の **986 file / 6.5MB を実際に開いて読む**。
	// 素の node プロセス (vitest harness なし) での実測は:
	//
	//   - cold FS cache (その日の初回 / fresh clone): **18,756ms**
	//   - warm (同一 file を再走査):                  **~285ms**
	//
	// 66x の差が harness の外側、走査そのものの中に出る (Windows Defender 下で初回 open が
	// ~19ms/file)。**#4000 の起票時仮説「harness コストが実処理の 100x」は誤りで、cold の
	// コストは走査自身の file open が支配する。** よって timeout をいくら上げても、
	// 走査 file 数 × 初回 open 遅延が per-test timeout を超えうる構造は残る (30s は cold 実測
	// 18.8s の 1.6x しかなく、より遅い環境では超える)。
	//
	// ## 外しても検査は失われない (ADR-0006 弱体化ではない)
	//
	// 同一の `findAllViolations()` による実 repo 検査は、per-test timeout を持たない専用 lane
	// で **2 箇所** 走る:
	//   - `npm run pre-ready` Step 7b (`node scripts/check-license-key-leak.mjs`)
	//   - CI `.github/workflows/ci.yml` の License key re-introduction guard step
	//
	// unit lane が担うのは「その配線が消えていないこと」= 下の 2 test。gate が片方の lane から
	// 落ちれば unit test が落ちる (「検査していない」が緑に見える状態を作らせない)。
	describe('実 repo gate の配線 (#4000)', () => {
		const repoRoot = resolve(__dirname, '../../..');
		const readRepoFile = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

		it('pre-ready が check-license-key-leak.mjs を実行する', () => {
			expect(readRepoFile('scripts/pre-ready.mjs')).toContain(
				"['node', 'scripts/check-license-key-leak.mjs']",
			);
		});

		it('CI が check-license-key-leak.mjs を実行する', () => {
			expect(readRepoFile('.github/workflows/ci.yml')).toContain(
				'node scripts/check-license-key-leak.mjs',
			);
		});

		it('CI は cold 実行の所要を budget で機械検知する', () => {
			// CI runner は fresh clone = 常に cold FS cache。そこで budget を課すこと自体が
			// 「cold 条件の回帰検知」になる (専用の cold 再現 job を別に持たない)。
			expect(readRepoFile('.github/workflows/ci.yml')).toMatch(
				/check-license-key-leak\.mjs --budget-ms \d+/,
			);
		});
	});

	// 走査関数そのものの検証は、実 repo ではなく **固定 fixture ツリー**に対して行う。
	// 走査 (再帰 / 拡張子 filter / allowlist / コメント行) の振る舞いを、file 数に依存しない
	// 一定コストで固定する。
	describe('findAllViolations (fixture ツリー)', () => {
		let dir: string;

		beforeAll(() => {
			dir = mkdtempSync(join(tmpdir(), 'license-key-leak-'));
			mkdirSync(join(dir, 'src', 'lib', 'server', 'routing'), { recursive: true });
			mkdirSync(join(dir, 'site'), { recursive: true });
			writeFileSync(join(dir, 'src', 'clean.ts'), 'const ok = true;\n');
			writeFileSync(join(dir, 'src', 'commented.ts'), '// 旧 licenseKey は撤去済 (#2818)\n');
			writeFileSync(join(dir, 'src', 'violating.ts'), "const msg = 'ライセンスキー';\n");
			writeFileSync(
				join(dir, 'src', 'lib', 'server', 'routing', 'legacy-url-map.ts'),
				"{ from: '/help/license-key', to: '/admin/subscription' },\n",
			);
			writeFileSync(join(dir, 'site', 'page.html'), '<p>LICENSE_KEY</p>\n');
			// 対象外拡張子は走査しない
			writeFileSync(join(dir, 'site', 'notes.md'), 'licenseKey\n');
		});

		afterAll(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		it('コード行の違反のみを、再帰走査した対象拡張子から検出する', () => {
			const violations = findAllViolations(dir).map((v: { file: string }) =>
				v.file.replace(/\\/g, '/'),
			);
			expect(violations.sort()).toEqual(['site/page.html', 'src/violating.ts']);
		});

		it('allowlist file / コメント行 / 対象外拡張子は検出しない', () => {
			const files = findAllViolations(dir).map((v: { file: string }) => v.file.replace(/\\/g, '/'));
			expect(files).not.toContain('src/lib/server/routing/legacy-url-map.ts');
			expect(files).not.toContain('src/commented.ts');
			expect(files).not.toContain('site/notes.md');
		});
	});

	describe('parseBudgetMs (#4000)', () => {
		it('--budget-ms の値を読む / 未指定は null', () => {
			expect(parseBudgetMs(['--budget-ms', '60000'])).toBe(60000);
			expect(parseBudgetMs([])).toBe(null);
		});

		it('不正値は例外にする (silent に検査を無効化しない)', () => {
			expect(() => parseBudgetMs(['--budget-ms', 'abc'])).toThrow();
			expect(() => parseBudgetMs(['--budget-ms'])).toThrow();
			expect(() => parseBudgetMs(['--budget-ms', '0'])).toThrow();
		});
	});
});
