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
	'tests/unit/scripts/check-local-tz-date-getters.test.ts': {
		scope: 'repo',
		note: 'repo 直下 / infra 直下を depth 1 で readdir し、TZ guard の走査範囲 (SEARCH_ROOTS) と除外宣言 (EXCLUDED_ROOTS) の網羅を突き合わせる (#4120)。全 file walk はしないが静的判定は保守的に repo と見なすため、判定に合わせて明示 timeout を置く',
	},
	'tests/unit/ai-evaluation/axe-runner-inline.test.ts': {
		scope: 'repo',
		note: 'scripts/ai-evaluation 配下を走査して inline inject 経路の残存を検査する',
	},
	'tests/unit/architecture/retention-filter-opt-out-allowlist.test.ts': {
		scope: 'repo',
		note: 'src 配下を再帰 walk し、保持期間フィルタの opt-out (`NO_RETENTION_FILTER` の import) が allowlist と完全一致するかを検査する (#4818)。「履歴取得が保持期間 (ADR-0049) を通っていない」が達成タブ / 交換タブで 2 度起きたため、opt-out の増殖を PR での明示判断に縛る。走査範囲は src 全体でなければ新規 opt-out を捕まえられない',
	},
	'tests/unit/services/plan-limit-check-null-type-hole.test.ts': {
		scope: 'repo',
		note: 'src/routes 配下を再帰 walk し、プラン上限メッセージ本文が labels.ts SSOT を経由せず直書きに戻っていないかを検査する (#4622)。直書きに戻ると `max: number` の関門が消え、上限メッセージに null を埋められるようになるため、走査範囲は routes 全体でなければ意味を持たない',
	},
	'tests/unit/services/trial-status-null-type-hole.test.ts': {
		scope: 'repo',
		note: 'src/routes 配下を再帰 walk し、trial 状態 (flag + 期限 / ティア) を route で手で組み直していないかを検査する (#4628)。手組みすると discriminated union の相関が推論から消え、画面側の narrowing が効かなくなって期限表示に null を埋められるようになるため、走査範囲は routes 全体でなければ意味を持たない',
	},
	'tests/unit/arch/no-direct-db-access.test.ts': {
		scope: 'repo',
		note: 'src 配下を走査して直接 DB アクセスを検出する',
	},
	'tests/unit/architecture/pin-length-ssot-fitness.test.ts': {
		scope: 'repo',
		note: 'src 配下を走査しておやカギコード桁数 (PIN_LENGTH) の直書き (regex / PinInput length / ラベル / 5086 案内) を検出する (#4698)',
	},
	'tests/unit/architecture/idp-sub-not-used-as-app-user-id.test.ts': {
		scope: 'repo',
		note: 'src/routes と src/lib/server を走査し、IdP の sub (identity.userId) を アプリ DB の users.user_id として使っている file を検出する (#4643)',
	},
	'tests/unit/architecture/unreachable-script-export-fitness.test.ts': {
		scope: 'repo',
		note: 'scripts/**/*.mjs と .claude/hooks/*.mjs を TypeScript parser で AST 化し、entry / registry から到達しない export された判定関数を検出する (#4623)',
	},
	'tests/unit/architecture/setup-route-role-guard-fitness.test.ts': {
		scope: 'repo',
		note: 'src/routes/setup 直下の route dir を depth 1 で列挙し、全 step が child 拒否 / 未認証 → /auth/login で守られていることを突き合わせる (#4700)。単一 dir だが静的判定は保守的に repo と見なすため明示 timeout を置く',
	},
	'tests/unit/architecture/node-version-fitness.test.ts': {
		scope: 'bounded',
		note: 'Dockerfile* / infra/lib/**/*.ts / .github/workflows/*.yml の 3 系統に限定して Node major 宣言を突き合わせる (#4199 AC5)。glob は限定的だが `**/Dockerfile*` がツリーを歩くため、判定が bounded でも明示 timeout を置いている',
	},
	'tests/unit/architecture/plan-limits-field-enforcement.test.ts': {
		scope: 'bounded',
		note: 'src 配下の .ts / .svelte を glob し、PlanLimits の全フィールドが production code から実際に参照されているかを検査する (#4584)。参照ゼロ = 有料の根拠として売っている機能にゲートが掛かっていない状態',
	},
	'tests/unit/architecture/ai-suggest-gate-derivation.test.ts': {
		scope: 'repo',
		note: 'src/routes 配下の +page.svelte を走査し、AI 提案パネルの isFamily 導出が共有述語 isAiSuggestUnlocked() を経由しているかを検査する (#4506 AC5)',
	},
	'tests/unit/architecture/grace-period-dunning-only-writer.test.ts': {
		scope: 'repo',
		note: 'src 配下の .ts を再帰的に walk し、status に grace_period を書く関数が dunning 経路 2 件に収まっているかを TypeScript compiler API で検査する (#4507)。lifecycle-email-service の opt-out 迂回はこの一意性を根拠にしているため、走査範囲は src 全体でなければ意味を持たない',
	},
	'tests/unit/architecture/e2e-menu-trigger-click-guard.test.ts': {
		scope: 'repo',
		note: 'tests/e2e 配下の spec 全件を走査し、Ark UI Menu の trigger を裸の click() で押している箇所を検出する (#4609)。hydration 前 click が握り潰されて menu item が hidden のまま落ちる flake を、spec を書いた時点で止める',
	},
	'tests/unit/architecture/e2e-worker-db-fixture-ratchet.test.ts': {
		scope: 'repo',
		note: 'tests/e2e 配下の spec を走査し、worker 分離 fixture (./fixtures) を経由しない spec 数を ratchet する (#4489)',
	},
	'tests/unit/architecture/playwright-auth-fixture-spec-exclusion.test.ts': {
		scope: 'repo',
		note: 'tests/e2e 配下の spec を走査し、playwright/.auth/*.json を参照する spec が playwright.config.ts の BASE_TEST_IGNORE に載っているかを検査する (#4485)',
	},
	'tests/unit/architecture/qm-role-naming-consistency.test.ts': {
		scope: 'repo',
		note: 'docs / .claude / scripts / tests / src を走査し、ロールを指す QA 表記の再混入を検出する (#4177)',
	},
	'tests/unit/architecture/external-ai-client-boundary.test.ts': {
		scope: 'repo',
		note: 'src 配下を走査し、運営者の環境の外にある生成 AI SDK (@google/generative-ai) を import する file が allowlist と一致するか / アバター生成 prompt が残っていないかを検査する (#4397)',
	},
	'tests/unit/architecture/exclusion-reason-nonempty.test.ts': {
		scope: 'repo',
		note: 'scripts/orphan-baselines/*.json を走査して免除理由の非空 / 非 stub を検査する (#4030 AC5 / AC6)。走査自体は 1 dir で有界だが、判定は保守的に repo 扱いとし明示 timeout を置く',
	},
	'tests/unit/architecture/action-primary-white-text-contrast.test.ts': {
		scope: 'repo',
		note: 'src 配下の .svelte を走査して配色コントラスト違反を検出する',
	},
	'tests/unit/architecture/base-token-routes-ratchet.test.ts': {
		scope: 'repo',
		note: 'src/routes + src/lib を走査して Base トークン直接使用を数える (ratchet、#3152)',
	},
	'tests/unit/architecture/child-ui-display-integrity.test.ts': {
		scope: 'repo',
		note: 'src/routes/(child) と src/lib/features/child-home を再帰 walk し、①経験値の固定リテラル描画 ②内部 ID の表示名フォールバック ③ラベル値による年齢帯判定 の再発を検出する (#4509)',
	},
	'tests/unit/architecture/ci-unit-test-path-filter-closure.test.ts': {
		scope: 'repo',
		note: '#4085 実測 例4 (5533ms で timeout)。.github + scripts を走査する scanner の健全性検査 (#4007)',
	},
	'tests/unit/architecture/scripts-node-test-ci-coverage.test.ts': {
		scope: 'repo',
		note: 'scripts/__tests__ を再帰 readdir し、ci.yml の node --test 引数が全 file をカバーするか検査する。走査は 1 dir で有界だが静的判定は保守的に repo と見なすため、判定に合わせて明示 timeout を置く',
	},
	'tests/unit/architecture/cloudfront-s3-user-content-bypass-fitness.test.ts': {
		scope: 'repo',
		note: 'infra 配下の CDK 定義を走査して配信経路の bypass を検出する',
	},
	'tests/unit/architecture/db-access-boundary.test.ts': {
		scope: 'repo',
		note: 'src 配下の import 境界を走査する',
	},
	'tests/unit/architecture/db-facade-backend-parity.test.ts': {
		scope: 'bounded',
		note: '#4719 src/lib/server/db 直下 (単一 dir) の *-repo.ts facade と factory.ts だけを読み、backend 実装の直 import / 3 backend 実装 file の欠落を検出する',
	},
	'tests/unit/architecture/pr-body-partial-match-guard.test.ts': {
		scope: 'repo',
		note: '#4348 scripts 配下の .mjs を走査し、PR body の見出し / 宣言を部分一致で判定する新規コードを検出する',
	},
	'tests/unit/architecture/no-stray-control-chars.test.ts': {
		scope: 'repo',
		note: '#4119 docs / src / scripts / tests のテキスト資産を byte 単位で走査し C0 制御文字の紛れ込みを検出する',
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
	'tests/unit/architecture/cron-route-auth-fitness.test.ts': {
		scope: 'bounded',
		note: '走査は src/routes/api/cron 配下のみ (再帰だが単一 dir で有界)。全 cron route が verifyCronAuth を呼ぶことを検査する (#4206)',
	},
	'tests/unit/architecture/ops-route-auth-fitness.test.ts': {
		scope: 'repo',
		note: '実走査は src/routes/ops 配下のみだが、静的判定が repo と見なすため宣言を合わせ明示 timeout を置く。全 ops endpoint が requireOpsAccess を呼ぶことを検査する (#4309)',
	},
	'tests/unit/architecture/workflow-judgment-delegation-guard.test.ts': {
		scope: 'repo',
		note: '.github/workflows を走査し、合否判定が YAML でなく scripts/*.mjs に委譲されているかを検査する (#4158)',
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
	'tests/unit/domain/lp-claims-implementation-truth-4713.test.ts': {
		scope: 'bounded',
		note: 'src/lib/data/marketplace/activity-packs/ の 1 ディレクトリだけを読み、LP 訴求値と突合する (#4713)',
	},
	'tests/unit/domain/settings-backup-classification.test.ts': {
		scope: 'repo',
		note: 'src 配下の settings 定義を走査して backup 分類の網羅を検査する',
	},
	'tests/unit/features/admin-resource-model-registry.test.ts': {
		scope: 'repo',
		note: 'src/routes 配下の admin 画面を走査して registry の網羅漏れを検出する (#3134 no-silent-gap)',
	},
	'tests/unit/architecture/env-distribution-closure.test.ts': {
		scope: 'repo',
		note: 'src / scripts / infra / .github を走査し env・context の配布 closure を検査する (#4191、旧 aws-deploy-context-closure + nuc-deploy-env-closure を統合)',
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
	'tests/unit/architecture/sqlite-tenant-predicate-fitness.test.ts': {
		scope: 'bounded',
		note: 'src/lib/server/db/sqlite の 1 dir を非再帰 readdir し、tenant 引数を捨てているメソッドが tenant_id 列を持つ表を触っていないかを検査する (#4546)。ツリーは歩かない',
	},
	'tests/unit/architecture/ci-shell-fail-open-guard.test.ts': {
		scope: 'bounded',
		note: '.github/workflows の 1 dir と actions/*/action.yml (composite action は現状 1 本) のみを非再帰 glob で解決し、`$?` で分岐する run ブロックが `set +e` を明示しているかを検査する (#4518)。ツリーは歩かないため file 数に比例しない',
	},
	'tests/integration/db/legacy-schema-upgrade.test.ts': {
		scope: 'bounded',
		note: 'temp dir に作った DB ファイルのみを読む',
	},
	'tests/unit/architecture/churn-status-predicate-ssot.test.ts': {
		scope: 'bounded',
		note: 'src/lib/server/services のサブツリーのみを走査して churn 判定の直接比較を検出する (#3987)',
	},
	'tests/unit/architecture/svelte-lint-glob-covers-rune-modules.test.ts': {
		scope: 'bounded',
		note: 'src 配下の *.svelte.ts (数件) のみを glob で解決し、eslint の ignore / 適用ルールを問い合わせる',
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
