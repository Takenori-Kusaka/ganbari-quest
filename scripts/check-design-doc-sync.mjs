#!/usr/bin/env node
/**
 * scripts/check-design-doc-sync.mjs
 *
 * #1985: design-doc-check 判定ロジック純粋関数 + CLI。
 *
 * **背景**: ADR-0003 (Issue 起票・クローズ品質) の「設計書同期はマージブロッカー」原則の運用層。
 * `src/routes/` 変更時に `docs/design/` 同期更新がない PR を hard-fail する。Wave 3 (#1980-1984) で
 * PLAN リテラル → PLAN_GATE_LABELS template 経由化のような **機能仕様変化なし** の内部 refactor が
 * 一律 fail し、各 PR で `docs/design/06-UI設計書.md §10.7` への形式的追記で乗り切る運用が発生。
 * Wave 4-7 (api/v1/admin / Phase 7 H1-H6 など 30+ PR) で再発する前に exempt パターンを構造化。
 *
 * **判定ロジック (新)**:
 * 1. `src/routes/` 変更なし → skip
 * 2. `docs/design/` 同期あり → pass
 * 3. (file-pattern exempt) 全変更ファイルが CLAUDE.md / scripts/ / docs/ / infra/ / .github/ / site/ → skip
 * 4. (label exempt #1985 NEW) PR ラベルに `refactor:internal-no-doc-impact` 含む → skip
 * 5. それ以外 → fail
 *
 * **label exempt の悪用防止**: ラベルは PO / QA / Dev で運用合意し、Issue / PR レビューで
 * 「機能仕様変化なし」を確認した PR にのみ付与する。ADR-0003 改訂で運用基準を明文化 (Issue #1986)。
 *
 * **CLI 引数**:
 *   --files <path>       改行区切りの変更ファイル一覧 (file)
 *   --labels <names>     カンマ区切りの PR ラベル一覧 (string、空文字可)
 *
 * **環境変数 (CLI 引数の代替)**:
 *   PR_FILES             改行区切りの変更ファイル一覧
 *   PR_LABELS            カンマ区切りの PR ラベル一覧
 *
 * **exit**:
 *   0 = OK (skip / pass)
 *   1 = fail (src/routes/ 変更ありで設計書同期なし、かつ exempt なし)
 *   2 = internal error
 *
 * **想定実行環境**: GitHub Actions (`pr-quality-gate.yml` の design-doc-check job)。
 *
 * **テスト**: `scripts/__tests__/check-design-doc-sync.test.mjs` (node --test)。
 */

const ROUTE_PREFIX = 'src/routes/';
const DESIGN_DOC_PREFIX = 'docs/design/';

/**
 * exempt 対象のファイルパスパターン。
 *
 * いずれかにマッチした変更ファイルは「設計書同期不要」とみなす。
 * 全変更ファイルが exempt パターンに合致する場合のみ skip 判定が成立する点に注意。
 */
const FILE_EXEMPT_MATCHERS = [
	/(?:^|\/|\\)CLAUDE\.md$/, // **/CLAUDE.md (任意の階層)
	/^scripts\//, // CI/CD スクリプト
	/^tests\//, // テスト (検証であって設計書同期不要、#3152)
	/^docs\//, // docs 自体が設計書
	/^infra\//, // インフラ設定
	/^\.github\//, // CI 設定
	/^site\//, // LP (設計書管轄外)
];

/**
 * label exempt のラベル名 (#1985)。
 *
 * 運用ルール (ADR-0003 改訂、Issue #1986):
 *   - 機能仕様変化なし (UI / API 変化なし)
 *   - リテラル置換 / atom-compound 階層化のみ
 *   - import 追加 + literal removal の diff パターン
 *
 * 上記を満たす PR にのみ Dev / QA が合意の上で付与する。悪用防止のためレビューでの確認必須。
 */
export const INTERNAL_REFACTOR_LABEL = 'refactor:internal-no-doc-impact';

/**
 * 変更ファイル一覧から、`src/routes/` 配下の変更があるかを判定。
 *
 * @param {string[]} files
 * @returns {boolean}
 */
export function hasRouteChanges(files) {
	return files.some((f) => f.startsWith(ROUTE_PREFIX));
}

/**
 * 変更ファイル一覧から、`docs/design/` 配下の変更があるかを判定。
 *
 * @param {string[]} files
 * @returns {boolean}
 */
export function hasDesignDocChanges(files) {
	return files.some((f) => f.startsWith(DESIGN_DOC_PREFIX));
}

/**
 * 全変更ファイルが exempt パターン (CLAUDE.md / scripts/ / docs/ / infra/ / .github/ / site/) に
 * 合致するかを判定 (file-pattern exempt)。
 *
 * @param {string[]} files
 * @returns {boolean} 全ファイルが exempt なら true。空配列 (= 変更なし) も true 扱いだが、
 *                    呼び出し側の hasRouteChanges() で先に短絡されるため実害なし。
 */
export function isAllFilesExempt(files) {
	if (files.length === 0) return false;
	return files.every((f) => FILE_EXEMPT_MATCHERS.some((re) => re.test(f)));
}

/**
 * PR ラベル一覧に `refactor:internal-no-doc-impact` が含まれるかを判定 (label exempt #1985)。
 *
 * @param {string[]} labels
 * @returns {boolean}
 */
export function hasInternalRefactorLabel(labels) {
	return labels.some((l) => l.trim().toLowerCase() === INTERNAL_REFACTOR_LABEL);
}

/**
 * @typedef {Object} CheckResult
 * @property {'skip' | 'pass' | 'fail'} status
 * @property {string} reason
 */

/**
 * design-doc-check の判定本体。GitHub Actions / CLI / unit test から呼び出す。
 *
 * @param {Object} input
 * @param {string[]} input.files - 変更ファイル一覧
 * @param {string[]} [input.labels] - PR ラベル一覧 (label exempt 判定用、省略時は空配列)
 * @returns {CheckResult}
 */
export function checkDesignDocSync({ files, labels = [] }) {
	if (!hasRouteChanges(files)) {
		return {
			status: 'skip',
			reason: 'src/routes/ への変更なし',
		};
	}

	if (hasDesignDocChanges(files)) {
		return {
			status: 'pass',
			reason: 'docs/design/ の同期更新あり',
		};
	}

	// src/routes/ 変更あり、かつ docs/design/ 同期なし → exempt 判定へ
	if (isAllFilesExempt(files)) {
		return {
			status: 'skip',
			reason:
				'変更ファイルが全て設計書更新不要なパターン (CLAUDE.md / scripts/ / docs/ / infra/ / .github/ / site/) のみ (ADR-0003)',
		};
	}

	if (hasInternalRefactorLabel(labels)) {
		return {
			status: 'skip',
			reason: `PR ラベル '${INTERNAL_REFACTOR_LABEL}' により内部 refactor として exempt (#1985 / ADR-0003 改訂)`,
		};
	}

	return {
		status: 'fail',
		reason:
			'src/routes/ に変更がありますが、docs/design/ の更新がありません (ADR-0003)。\n' +
			'設計書同期が必要な場合は同一 PR 内で更新してください。\n' +
			'機能仕様変化なし (内部 refactor) の場合は PR ラベル ' +
			`'${INTERNAL_REFACTOR_LABEL}' を付与してください (#1985)。`,
	};
}

// ---------------------------------------------------------------------------
// CLI エントリポイント (node scripts/check-design-doc-sync.mjs から呼ばれる場合)
// ---------------------------------------------------------------------------

/** @param {string[]} argv @returns {{ filesPath: string | null, labelsArg: string | null }} */
function parseCliArgs(argv) {
	/** @type {{ filesPath: string | null, labelsArg: string | null }} */
	const args = { filesPath: null, labelsArg: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--files' && i + 1 < argv.length) {
			args.filesPath = argv[++i] ?? null;
		} else if (arg === '--labels' && i + 1 < argv.length) {
			args.labelsArg = argv[++i] ?? null;
		}
	}
	return args;
}

/** @param {string | null} filePath @returns {Promise<string[]>} */
async function readFiles(filePath) {
	if (!filePath) {
		const env = process.env.PR_FILES || '';
		return env
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
	}
	const fs = await import('node:fs/promises');
	const content = await fs.readFile(filePath, 'utf8');
	return content
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** @param {string | null} labelsArg @returns {string[]} */
function readLabels(labelsArg) {
	const raw = labelsArg ?? process.env.PR_LABELS ?? '';
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

async function main() {
	try {
		const cliArgs = parseCliArgs(process.argv.slice(2));
		const files = await readFiles(cliArgs.filesPath);
		const labels = readLabels(cliArgs.labelsArg);

		const result = checkDesignDocSync({ files, labels });

		if (result.status === 'skip') {
			console.log(`[skip] ${result.reason}`);
			process.exit(0);
		}
		if (result.status === 'pass') {
			console.log(`[pass] ${result.reason}`);
			process.exit(0);
		}
		console.error(`[fail] ${result.reason}`);
		process.exit(1);
	} catch (err) {
		console.error(`[error] internal: ${err instanceof Error ? err.stack : String(err)}`);
		process.exit(2);
	}
}

// import.meta.url が CLI エントリの場合のみ main 実行 (test では import 経由)
const argv1 = process.argv[1] ?? '';
const isCliInvocation =
	argv1 !== '' &&
	(import.meta.url === `file://${argv1}` || import.meta.url.endsWith(argv1.replace(/\\/g, '/')));

if (isCliInvocation) {
	main();
}
