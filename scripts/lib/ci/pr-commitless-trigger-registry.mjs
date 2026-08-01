/**
 * scripts/lib/ci/pr-commitless-trigger-registry.mjs (#4171)
 *
 * 「**新しい commit を伴わない PR イベント**でどの workflow が再実行されてよいか」の宣言 SSOT。
 *
 * # 背景 (実測)
 *
 * 第19回統合監査 (#4152 / release/2026-08-01) で「統合 PR の本文を直すたびに重量レーンが丸ごと
 * 回っている」と報告されたので実測したところ、**事実は逆**だった。
 *
 *   - PR 本文の編集は `pull_request` の `edited` を発火させる。`ci.yml` は `edited` を購読して
 *     いないため、**本文編集で CI は 1 度も再実行されていない**
 *     (head_sha `bb88fb36` に対する本文編集 5 回 = `edited` 起動 20 run。うち CI は 0 件)
 *   - `edited` を購読しているのは本文を入力に取る軽量 gate 4 本だけで、いずれも 10〜40 秒
 *     (`pr-quality-gate` / `pr-merge-gate` / `pr-template-gate` / `pr-ac-verification-check`)
 *   - 同 PR の CI 4 回はすべて **別 SHA への push**（cut + 監査による test 修正 3 回）であり、
 *     本文編集が原因ではない
 *
 * つまり守るべき性質は既に成立している。**問題は、それが `ci.yml` の `types:` 列挙という
 * 何にも守られていない偶然でしか成立していないこと**だった。`edited` を 1 語足すだけで、
 * 本文を直すたびに 20 分の重量レーンが回る状態へ静かに退行する。
 *
 * # 本 registry が固定すること
 *
 *   1. `bodyGate: false` の workflow は commit を伴わない活動 type を購読しない
 *      (= 本文 / label 編集で重量レーンが回らない)
 *   2. `bodyGate: true` の workflow は `edited` を**必ず**購読する
 *      (= 「速くする」名目で本文検査が黙って止まらない。#4119 と同 class の逆向き)
 *   3. `bodyGate: true` の workflow は静的に軽量である
 *      (= 重い workflow に `edited` を足して本 registry に `true` と書く逃げ道を塞ぐ)
 *   4. `on.pull_request` / `on.pull_request_target` を持つ workflow は全数が本 registry に
 *      現れる (no-silent-gap。新規 workflow 追加時に判断を必ず発生させる)
 *
 * 検査本体は `tests/unit/architecture/pr-commitless-trigger-guard.test.ts`。
 *
 * # `ready_for_review` を別枠にする理由
 *
 * `ready_for_review` も commit を伴わないが、**Draft 中に job を skip する workflow にとっては
 * 初回発火の唯一の機会**であり、外すと「Draft で出した PR は Ready 化しても一度も検査されない」
 * という取り返しのつかない穴になる。よって購読自体は禁止せず、
 * **重量 workflow が購読する場合は Draft skip 条件 (`pull_request.draft == false`) を持つこと**
 * だけを要求する (Draft skip がないなら同一 SHA の二度手間なので、#1218 の判断どおり外す)。
 */

/**
 * 新しい commit を伴わずに発火する `pull_request` / `pull_request_target` の活動 type。
 *
 * `ready_for_review` は上記のとおり別枠 (`REVIEW_READY_ACTIVITY_TYPE`) で扱う。
 * `synchronize` / `opened` / `reopened` は新しい HEAD を伴うので対象外。
 *
 * 出典: GitHub Docs "Events that trigger workflows" — pull_request activity types。
 */
export const COMMITLESS_PR_ACTIVITY_TYPES = Object.freeze([
	'edited',
	'labeled',
	'unlabeled',
	'assigned',
	'unassigned',
	'review_requested',
	'review_request_removed',
	'converted_to_draft',
	'auto_merge_enabled',
	'auto_merge_disabled',
	'locked',
	'unlocked',
	'milestoned',
	'demilestoned',
	'enqueued',
	'dequeued',
]);

/** Draft → Ready 遷移。commit を伴わないが Draft skip 系 workflow の初回発火に要る (上記参照)。 */
export const REVIEW_READY_ACTIVITY_TYPE = 'ready_for_review';

/**
 * `types:` 省略時に GitHub が適用する既定の活動 type。
 * いずれも新しい HEAD を伴うため commit-less ではない。
 */
export const DEFAULT_PR_ACTIVITY_TYPES = Object.freeze(['opened', 'synchronize', 'reopened']);

/**
 * 「重量」と静的に判定する step のマーカー。
 *
 * **workflow ファイルの全文 grep ではなく、YAML を parse した step の `run` / `uses` にだけ
 * 当てる**。コメントや通知メッセージ本文に "Playwright" と書いてあるだけの workflow
 * (`pr-quality-gate.yml` の SS 添付案内) を重量と誤判定しないため。
 */
export const HEAVY_STEP_RUN_PATTERNS = Object.freeze([
	/\bnpm\s+(ci|install)\b/,
	/\bnpm\s+run\s+build\b/,
	/\bplaywright\s+install\b/,
	/\bnpx\s+playwright\b/,
	/\bdocker\s+(build|buildx)\b/,
]);

/** 重量と判定する `uses:` (action)。 */
export const HEAVY_STEP_USES_PREFIXES = Object.freeze([
	'github/codeql-action',
	'docker/build-push-action',
	'docker/setup-buildx-action',
]);

/**
 * PR 起動 workflow の commit-less 発火宣言。
 *
 * key は repo root からの POSIX 相対パス。
 *
 *   - `bodyGate: true`  — PR 本文 / label を入力に取る軽量 gate。`edited` 購読が**必須**
 *   - `bodyGate: false` — commit を伴わない活動 type を購読して**はならない**
 *
 * @type {Record<string, { bodyGate: boolean; note: string }>}
 */
export const PR_COMMITLESS_TRIGGER_REGISTRY = {
	// --- bodyGate: true (本文が入力。edited 購読必須 + 軽量必須) ---
	'.github/workflows/pr-quality-gate.yml': {
		bodyGate: true,
		note: 'PR 本文の SS / AC / 禁止語などを検査する。本文を直したら再判定が要る (実測 21〜37 秒)',
	},
	'.github/workflows/pr-merge-gate.yml': {
		bodyGate: true,
		note: 'check-pr-body.mjs で本文の必須セクションを検査する (実測 12〜26 秒)',
	},
	'.github/workflows/pr-template-gate.yml': {
		bodyGate: true,
		note: 'PR テンプレート必須セクションを本文から検査する (実測 17〜30 秒)',
	},
	'.github/workflows/pr-ac-verification-check.yml': {
		bodyGate: true,
		note: 'ADR-0038 AC 検証マップを本文から検査する (実測 9〜13 秒)',
	},

	// --- bodyGate: false (commit-less 活動 type を購読しない) ---
	'.github/workflows/ci.yml': {
		bodyGate: false,
		note: '重量レーン本体 (統合 PR で実測 16〜20 分)。本文編集で回してはならない — 本 registry の主目的',
	},
	'.github/workflows/codeql.yml': {
		bodyGate: false,
		note: 'CodeQL 解析。commit した差分に対してのみ意味がある',
	},
	'.github/workflows/app-visual-regression.yml': {
		bodyGate: false,
		note: 'pixelmatch baseline 比較 (重量)。ready_for_review は Draft skip の初回発火に要る',
	},
	'.github/workflows/child-home-visual-regression.yml': {
		bodyGate: false,
		note: 'pixelmatch baseline 比較 (重量)。ready_for_review は Draft skip の初回発火に要る',
	},
	'.github/workflows/lp-visual-regression.yml': {
		bodyGate: false,
		note: 'LP pixelmatch baseline 比較 (統合 PR で実測 7.5 分)。ready_for_review は Draft skip 初回発火に要る',
	},
	'.github/workflows/lp-metrics.yml': {
		bodyGate: false,
		note: 'LP 実寸計測 (ブラウザ実測)。ready_for_review は Draft skip の初回発火に要る',
	},
	'.github/workflows/lp-fallback-check.yml': {
		bodyGate: false,
		note: 'labels.ts ↔ site fallback 照合。ready_for_review は Draft skip の初回発火に要る',
	},
	'.github/workflows/dependency-review.yml': {
		bodyGate: false,
		note: '依存差分の脆弱性 review。差分が入力なので commit 単位で足りる',
	},
	'.github/workflows/deploy-aws-staging.yml': {
		bodyGate: false,
		note: '統合 PR の AWS staging 実デプロイ (重量)。本文編集で再デプロイしてはならない',
	},
	'.github/workflows/deploy-nuc-staging.yml': {
		bodyGate: false,
		note: '統合 PR の NUC staging 実デプロイ (重量)。本文編集で再デプロイしてはならない',
	},
	'.github/workflows/zenn-lint.yml': {
		bodyGate: false,
		note: 'docs/zenn/** の lint。paths filter 付きで差分が入力',
	},
	'.github/workflows/orphan-check.yml': {
		bodyGate: false,
		note: 'src 差分から orphan resource を検出する。差分が入力',
	},
	'.github/workflows/check-pr-template-sections-sync.yml': {
		bodyGate: false,
		note: 'テンプレート file 同士の同期検査。PR 本文ではなく repo の file が入力',
	},
	'.github/workflows/pr-info.yml': {
		bodyGate: false,
		note: 'diff 規模の comment / label 付与。差分が入力',
	},
	'.github/workflows/pr-lane-smoke.yml': {
		bodyGate: false,
		note: 'lane 判定の smoke。base/head ref が入力',
	},
	'.github/workflows/pr-author-guard.yml': {
		bodyGate: false,
		note: 'PR 作成者の検査 (pull_request_target)。作成時点で確定するので再判定不要',
	},
	'.github/workflows/labeler.yml': {
		bodyGate: false,
		note: '変更 path から label 付与 (pull_request_target)。差分が入力',
	},
	'.github/workflows/dependabot-auto-merge.yml': {
		bodyGate: false,
		note: 'dependabot PR の auto-merge 有効化。既定 types のみ',
	},
};
