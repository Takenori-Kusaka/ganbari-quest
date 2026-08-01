/**
 * scripts/lib/ci/repo-scan-test-registry.mjs (#4085)
 *
 * 「repo 走査 test」の区分宣言 SSOT。
 *
 * # なぜ宣言を要求するか
 *
 * repo 全体の file を実読する test は **実行時間が入力サイズに比例する**。それを既定 timeout
 * (5s、vite.config.ts) のまま unit lane に置くと、他 worker との CPU / FS 競合次第で落ちる。
 * 落ちても壊れてはいないので、開発者は毎回「本物か負荷か」を切り分けることになり、切り分けを
 * 間違えれば無い回帰を追うか、本物の回帰を「また負荷だろう」と見逃す。
 *
 * 同 class が 4 例に達したため (#3972/#4000 → PR #4067 / #3978 → PR #4066 /
 * `page-guide-coverage` 6240ms / `ci-unit-test-path-filter-closure` 5533ms)、instance 修正を
 * やめて機械 gate 化した (ADR-0061 same-class-N→guard)。#4048 の `costClass` 宣言 (未登録なら
 * throw) と同型で、**追加時に区分の判断を必ず発生させる**のが目的。
 *
 * # 区分
 *
 * | scope | 意味 | 要求 |
 * |---|---|---|
 * | `repo` | repo のディレクトリツリーを走査する (`src` / `scripts` / `tests` ...) | 明示 timeout (≥ `MIN_REPO_SCAN_TIMEOUT_MS`) 必須 |
 * | `bounded` | 走査 API を使うが入力が fixture / temp dir / 単一 dir で有界 | 追加要求なし |
 *
 * `scope` は gate 側が静的に判定した値と**一致していなければ fail** する。`bounded` と自己申告
 * するだけで timeout 要求を回避することはできない (宣言が検査を無効化しないようにする)。
 *
 * # 追加手順
 *
 * 1. test を追加する
 * 2. `node scripts/check-repo-scan-test-declaration.mjs` を実行する (未宣言なら fail し、
 *    判定した scope と貼り付け用のエントリを出力する)
 * 3. 出力どおりに本 registry へ 1 行足す。`scope: 'repo'` なら当該 test に明示 timeout を付ける
 */

/** `scope: 'repo'` の test が unit lane に残る場合に要求する最小 timeout (ms)。 */
export const MIN_REPO_SCAN_TIMEOUT_MS = 20_000;

/**
 * repo 走査 test の区分宣言。
 *
 * key は repo root からの POSIX 相対パス。
 *
 * @type {Record<string, { scope: 'repo' | 'bounded'; note: string }>}
 */
export const REPO_SCAN_TEST_REGISTRY = {
	// --- scope: repo (repo ツリーを走査。明示 timeout 必須) ---
	'tests/unit/ai-evaluation/axe-runner-inline.test.ts': {
		scope: 'repo',
		note: 'scripts/ai-evaluation 配下を走査して inline inject 経路の残存を検査する',
	},
	'tests/unit/arch/no-direct-db-access.test.ts': {
		scope: 'repo',
		note: 'src 配下を走査して直接 DB アクセスを検出する',
	},
	'tests/unit/architecture/action-primary-white-text-contrast.test.ts': {
		scope: 'repo',
		note: 'src 配下の .svelte を走査して配色コントラスト違反を検出する',
	},
	'tests/unit/architecture/base-token-routes-ratchet.test.ts': {
		scope: 'repo',
		note: 'src/routes + src/lib を走査して Base トークン直接使用を数える (ratchet、#3152)',
	},
	'tests/unit/architecture/ci-unit-test-path-filter-closure.test.ts': {
		scope: 'repo',
		note: '#4085 実測 例4 (5533ms で timeout)。.github + scripts を走査する scanner の健全性検査 (#4007)',
	},
	'tests/unit/architecture/cloudfront-s3-user-content-bypass-fitness.test.ts': {
		scope: 'repo',
		note: 'infra 配下の CDK 定義を走査して配信経路の bypass を検出する',
	},
	'tests/unit/architecture/db-access-boundary.test.ts': {
		scope: 'repo',
		note: 'src 配下の import 境界を走査する',
	},
	'tests/unit/architecture/dsql-txn-work-allowlist.test.ts': {
		scope: 'repo',
		note: 'src 配下の txn 内 work を走査する (ADR-0065)',
	},
	'tests/unit/architecture/dsql-uuid-guard-ssot-fitness.test.ts': {
		scope: 'repo',
		note: 'src 配下の uuid guard 利用を走査する',
	},
	'tests/unit/architecture/fetch-error-handling-ratchet.test.ts': {
		scope: 'repo',
		note: 'src 配下の fetch 呼び出しを走査する (ratchet)',
	},
	'tests/unit/architecture/pr-trigger-lane-guard.test.ts': {
		scope: 'repo',
		note: '.github/workflows 全 file を parse して commit-less 発火 type の宣言整合を検査する (#4171)',
	},
	'tests/unit/architecture/page-guide-coverage.test.ts': {
		scope: 'repo',
		note: '#4085 実測 例3 (6240ms で timeout)。REGISTERED ガイドの anchor を src から走査する',
	},
	'tests/unit/architecture/route-db-boundary.test.ts': {
		scope: 'repo',
		note: 'src/routes 配下の server route から禁止 import を走査する (#3152 / ADR-0061)',
	},
	'tests/unit/architecture/stripe-webhook-single-entrypoint.test.ts': {
		scope: 'repo',
		note: 'src / infra / .github を走査し Stripe webhook 受信口が 1 本かを検査する (#4128)',
	},
	'tests/unit/architecture/user-content-delivery-headers-fitness.test.ts': {
		scope: 'repo',
		note: 'infra + src を走査して配信ヘッダを検査する',
	},
	'tests/unit/cron/schedule-consistency.test.ts': {
		scope: 'repo',
		note: 'src + .github/workflows を走査して cron schedule の整合を検査する',
	},
	'tests/unit/docs/stripe-webhook-subscribed-events-ssot.test.ts': {
		scope: 'repo',
		note: 'docs 配下を走査して Stripe 購読 event 集合を宣言する doc を洗い出し、実装の case 一覧と突合する (#3990)',
	},
	'tests/unit/domain/settings-backup-classification.test.ts': {
		scope: 'repo',
		note: 'src 配下の settings 定義を走査して backup 分類の網羅を検査する',
	},
	'tests/unit/features/admin-resource-model-registry.test.ts': {
		scope: 'repo',
		note: 'src/routes 配下の admin 画面を走査して registry の網羅漏れを検出する (#3134 no-silent-gap)',
	},
	'tests/unit/hooks/agent-lock.test.ts': {
		scope: 'repo',
		note: 'repo ツリーは走査しない (temp git fixture + lock dir のみ) が、hook を子プロセスで起動するため静的判定が repo になる。git init / worktree add の分だけ既定 timeout を超え得るので明示 timeout を置く',
	},
	'tests/unit/scripts/check-orphan-repos-population.test.ts': {
		scope: 'repo',
		note: 'src 配下の repo 実装を走査して orphan を検出する',
	},
	'tests/unit/scripts/check-readdir-rotation-guard.test.ts': {
		scope: 'repo',
		note: '#4085 実測 例2 (PR #4066 で明示 60s 付与済)。src + scripts の 900+ file を実読する',
	},
	'tests/unit/scripts/check-repo-scan-test-declaration.test.ts': {
		scope: 'repo',
		note: '実走査はしないが fixture 文字列に走査 API と repo root を含むため静的判定が repo になる (保守的判定を受け入れ明示 timeout を置く)',
	},

	// --- scope: bounded (走査 API を使うが入力が有界。追加要求なし) ---
	'tests/integration/db/legacy-schema-upgrade.test.ts': {
		scope: 'bounded',
		note: 'temp dir に作った DB ファイルのみを読む',
	},
	'tests/unit/architecture/churn-status-predicate-ssot.test.ts': {
		scope: 'bounded',
		note: 'src/lib/server/services のサブツリーのみを走査して churn 判定の直接比較を検出する (#3987)',
	},
	'tests/unit/architecture/dsql-append-only-mutation-allowlist.test.ts': {
		scope: 'bounded',
		note: 'DSQL repo の単一 dir のみを走査する',
	},
	'tests/unit/architecture/dsql-append-only-update-fitness.test.ts': {
		scope: 'bounded',
		note: 'DSQL repo の単一 dir のみを走査する',
	},
	'tests/unit/architecture/dsql-loop-sequential-write-fitness.test.ts': {
		scope: 'bounded',
		note: 'DSQL repo の単一 dir のみを走査する',
	},
	'tests/unit/architecture/dsql-mutation-count-cte-fitness.test.ts': {
		scope: 'bounded',
		note: 'DSQL repo の単一 dir のみを走査する',
	},
	'tests/unit/architecture/dsql-tenant-predicate-fitness.test.ts': {
		scope: 'bounded',
		note: 'DSQL repo の単一 dir のみを走査する (ADR-0063)',
	},
	'tests/unit/architecture/dsql-write-path-db-import-ban.test.ts': {
		scope: 'bounded',
		note: 'DSQL write path の単一 dir のみを走査する',
	},
	'tests/unit/architecture/ledger-grant-atomicity-fitness.test.ts': {
		scope: 'bounded',
		note: 'ledger service の単一 dir のみを走査する',
	},
	'tests/unit/db/pglite-backup-3950.test.ts': {
		scope: 'bounded',
		note: 'temp の backup dir のみを読む',
	},
	'tests/unit/db/restore-idempotency-registry.test.ts': {
		scope: 'bounded',
		note: 'restore registry と単一 dir のみを読む',
	},
	'tests/unit/infra/cdk-hook-timeout-guard.test.ts': {
		scope: 'bounded',
		note: 'CDK hook の単一 dir のみを走査する',
	},
	'tests/unit/routes/export-authz-symmetry-3246.test.ts': {
		scope: 'bounded',
		note: 'export route の単一 dir のみを走査する (#3972 同 class 3 例目、#4005 で明示 timeout 済)',
	},
	'tests/unit/routes/settings-hub-coverage.test.ts': {
		scope: 'bounded',
		note: 'admin/settings サブツリーのみを走査する (#3954)',
	},
	'tests/unit/scripts/backup-db.test.ts': {
		scope: 'bounded',
		note: 'temp の backup dir を rotate するだけ',
	},
};
