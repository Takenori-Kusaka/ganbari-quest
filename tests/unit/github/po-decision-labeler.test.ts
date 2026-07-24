/**
 * po-decision:required labeler config 回帰固定 (#3862 Phase 1)
 *
 * `.github/labeler.yml` の `po-decision:required` エントリ (PO 決裁 triage の
 * パス判定マップ機械層 SSOT) に対し、高リスク・不可逆パスの代表ファイルが
 * 必ず label 付与対象になること (false negative 0) を回帰固定する。
 *
 * - matcher は actions/labeler@v6 と同じ minimatch (dot: true) を使用
 *   (https://github.com/actions/labeler — any-glob-to-any-file の実装準拠)
 * - 判断層 (glob で表現できない triage シグナル) は
 *   .claude/skills/pr-review/SKILL.md「Step 0: PO 決裁 triage」の checklist が SSOT
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { minimatch } from 'minimatch';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const LABEL = 'po-decision:required';

interface LabelerEntry {
	'changed-files'?: Array<{ 'any-glob-to-any-file'?: string[] }>;
}

const labelerPath = resolve(__dirname, '../../../.github/labeler.yml');
const config = parse(readFileSync(labelerPath, 'utf-8')) as Record<string, LabelerEntry[]>;

function extractGlobs(label: string): string[] {
	const entries = config[label];
	if (!entries) return [];
	return entries.flatMap((entry) =>
		(entry['changed-files'] ?? []).flatMap((cf) => cf['any-glob-to-any-file'] ?? []),
	);
}

/** actions/labeler v6 と同一挙動 (minimatch, dot: true) でいずれかの glob に一致するか */
function matchesAnyGlob(filePath: string, globs: string[]): boolean {
	return globs.some((glob) => minimatch(filePath, glob, { dot: true }));
}

/**
 * 高リスク・不可逆パスの代表ファイル (各領域 1 件以上)。
 * ここに列挙したパスが 1 件でも label 対象から外れたら triage の false negative =
 * PO 決裁を経ずに不可逆変更が merge され得るため、テストで hard-fail させる。
 */
const HIGH_RISK_REPRESENTATIVES: Array<{ area: string; file: string }> = [
	{ area: 'DB スキーマ (SQLite)', file: 'src/lib/server/db/schema.ts' },
	{ area: 'DB スキーマ (DSQL)', file: 'src/lib/server/db/dsql/schema.ts' },
	{ area: 'DB migration', file: 'drizzle/pglite/0000_pretty_wolfsbane.sql' },
	{ area: 'Stripe・billing (server)', file: 'src/lib/server/stripe/client.ts' },
	{ area: 'Stripe・billing (webhook route)', file: 'src/routes/api/stripe/webhook/+server.ts' },
	{ area: 'auth 認可境界 (hooks)', file: 'src/hooks.server.ts' },
	{ area: 'auth 認可境界 (policy)', file: 'src/lib/policy/capabilities.ts' },
	{ area: 'auth 認可境界 (server/auth)', file: 'src/lib/server/auth/authorization.ts' },
	{ area: 'infra (CDK)', file: 'infra/lib/compute-stack.ts' },
	{ area: 'deploy workflow', file: '.github/workflows/deploy.yml' },
	{ area: 'deploy workflow (NUC)', file: '.github/workflows/deploy-nuc.yml' },
	{ area: 'DSQL テナント分離 (強制点)', file: 'src/lib/server/db/dsql/connection.ts' },
	{
		area: 'DSQL テナント分離 (fitness)',
		file: 'tests/unit/architecture/dsql-tenant-predicate-fitness.test.ts',
	},
	{ area: 'retention', file: 'src/lib/server/services/retention-cleanup-service.ts' },
	{ area: 'PII (アカウント削除)', file: 'src/lib/server/services/account-deletion-service.ts' },
	{ area: 'PII (削除エクスポート)', file: 'src/lib/server/services/deletion-export-service.ts' },
	{ area: 'env', file: '.env.example' },
	{ area: 'env (runtime)', file: 'src/lib/runtime/env.ts' },
	{ area: '価格・プラン文字列 (atom)', file: 'src/lib/domain/terms.ts' },
	{ area: '価格・プラン文字列 (plan)', file: 'src/lib/domain/plan-features.ts' },
	{ area: '法務 (利用規約)', file: 'site/terms.html' },
	{ area: '法務 (プライバシー)', file: 'site/privacy.html' },
	{ area: '法務 (特商法)', file: 'site/tokushoho.html' },
	{ area: '法務 (SLA)', file: 'site/sla.html' },
	{ area: 'LP truth (価格ページ)', file: 'site/pricing.html' },
	{ area: 'LP truth (プライシング戦略)', file: 'docs/design/19-プライシング戦略書.md' },
];

/**
 * 低リスク代表 (label が付かないこと)。false positive を無制限に許すと
 * PO の判断キューが飽和し triage 自体が形骸化するため、日常変更の代表点で sanity 固定する。
 */
const LOW_RISK_REPRESENTATIVES: string[] = [
	'src/routes/(child)/[uiMode=uiMode]/home/+page.svelte',
	'src/lib/ui/primitives/Button.svelte',
	'src/lib/domain/labels.ts',
	'tests/e2e/admin-add-path-isomorphism.spec.ts',
	'docs/DESIGN.md',
	'site/index.html',
	'.github/workflows/ci.yml',
];

describe('po-decision:required labeler config (#3862)', () => {
	const globs = extractGlobs(LABEL);

	it(`labeler.yml に ${LABEL} エントリが存在し glob が 1 件以上定義されている`, () => {
		expect(config[LABEL], `${LABEL} エントリが .github/labeler.yml に存在すること`).toBeDefined();
		expect(globs.length).toBeGreaterThan(0);
	});

	describe('高リスク代表パスは必ず label 対象 (false negative 0)', () => {
		for (const { area, file } of HIGH_RISK_REPRESENTATIVES) {
			it(`${area}: ${file}`, () => {
				expect(
					matchesAnyGlob(file, globs),
					`${file} が ${LABEL} の glob に一致しない (false negative)。` +
						'.github/labeler.yml の該当領域 glob を修正すること',
				).toBe(true);
			});
		}
	});

	describe('低リスク代表パスは label 対象外 (triage 形骸化防止 sanity)', () => {
		for (const file of LOW_RISK_REPRESENTATIVES) {
			it(file, () => {
				expect(
					matchesAnyGlob(file, globs),
					`${file} が ${LABEL} に誤一致 (false positive)。glob が広すぎないか確認すること`,
				).toBe(false);
			});
		}
	});

	it('高リスク代表パスは実ファイルとして存在する (glob と repo 実体の drift 防止)', () => {
		for (const { file } of HIGH_RISK_REPRESENTATIVES) {
			// drizzle migration はファイル名が生成順で変わるため directory 存在で代替
			const target = file.startsWith('drizzle/') ? 'drizzle' : file;
			expect(
				existsSync(resolve(__dirname, '../../../', target)),
				`${target} が repo に存在すること`,
			).toBe(true);
		}
	});
});
