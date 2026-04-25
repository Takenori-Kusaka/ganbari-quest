# QA (品質管理) セッション起動プロンプト

> **目的**: 顧客へ提供するアプリの品質をあらゆる観点から担保し、顧客満足度が高く継続性の高く社会的問題を起こさない低リスク高付加価値なアプリの提供に責任を持つ

---

## アーキテクチャ概要：2 層構造

```
┌──────────────────────────────────────────────────────────────────┐
│  Tier 1: Orchestrator（スケジューラ）                              │
│  - gh pr list で Ready PR をピックアップ                           │
│  - PR 1 件につき Review Agent を 1 つ spawn                       │
│  - 全 Agent 完了後に結果をサマリー                                  │
└──────────┬──────────────────┬──────────────────┬─────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │ PR #N        │   │ PR #M        │   │ PR #K        │
  │ Review Agent │   │ Review Agent │   │ Review Agent │
  │（独立 ctx）   │   │（独立 ctx）   │   │（独立 ctx）   │
  │ 5 手順実行   │   │ 5 手順実行   │   │ 5 手順実行   │
  │ approve/     │   │ approve/     │   │ approve/     │
  │ block        │   │ block        │   │ block        │
  └──────────────┘   └──────────────┘   └──────────────┘
```

### なぜ 2 層構造にするか

| 問題 | 原因 | 解決策 |
|------|------|--------|
| 手順の忘れ・省略が発生する | 1 セッションで複数 PR を連続処理するとコンテキストが肥大化し、後半の PR で最初の手順に戻れなくなる | 各 PR を独立した Agent に委譲。Agent は新鮮なコンテキストで 1 PR だけに集中 |
| 判断基準のブレ | 前の PR のレビュー傾向を引きずり、基準が徐々にゆるむ | Agent は毎回 Tier 2 手順を最初から読んで実行。前の PR の影響を受けない |
| Orchestrator の役割混濁 | スケジューラが実作業に引き込まれて本来の役割を忘れる | Orchestrator は「何をやるか決定」専任。「どうやるか実行」は Agent に委譲 |

---

## Tier 1 — Orchestrator セッション（このセッションで実行）

Orchestrator は **以下の 3 ステップのみ** を行う。実際のレビュー・approve・merge は Review Agent が行う。

### Step 1: 最新化

```bash
git fetch origin && git pull origin main
```

### Step 2: Ready PR のピックアップ

```bash
gh pr list --repo Takenori-Kusaka/ganbari-quest --state open \
  --json number,title,isDraft,reviewDecision,author,headRefName,labels
```

対象条件:
- `isDraft: false`（Draft PR は除外）
- `reviewDecision` が `APPROVED` でない

対象 PR が **0 件** → 「Ready PR なし」を記録して終了。

### Step 3: Review Agent を spawn

対象 PR ごとに **Agent ツールで Review Agent を 1 つ spawn** する。複数 PR は同時 spawn 可（各 PR の変更ファイルが重複しない場合）。

**spawn プロンプトテンプレート**（§「Agent spawn プロンプトテンプレート」の定型文を使う）:

```
あなたは PR #<番号> の QA Review Agent です。
docs/sessions/qa-session.md の「Tier 2 — Per-PR Review Agent の実行手順」に従い、
PR #<番号>（<タイトル>）に対して 5 手順を全て実行してください。

ブランチ: <headRefName>
リポジトリ: Takenori-Kusaka/ganbari-quest
```

### Step 4: サマリー出力

全 Agent 完了後、以下を記録してセッションを終了する:

- 処理 PR 一覧（番号・タイトル・結果: merge 済み / block 中）
- block した PR があれば指摘コメントの概要

---

## Tier 2 — Per-PR Review Agent の実行手順

> このセクションは spawn された Review Agent が最初に読む。
> **1 つの Agent = 1 つの PR** を担当し、以下の 5 手順を順番に完遂する。
> 手順をスキップしたり順序を変えてはならない。

### 事前準備

```bash
# PR の概要を取得
gh pr view <番号> --repo Takenori-Kusaka/ganbari-quest

# diff を確認（変更ファイル一覧）
gh pr diff <番号> --repo Takenori-Kusaka/ganbari-quest --name-only
```

---

### 手順 1: Issue 照合（必須・最初に実行）

```bash
# PR body の "closes #X" から Issue 番号を取得
gh issue view <X> --repo Takenori-Kusaka/ganbari-quest
```

チェック内容:
- Issue の **Acceptance Criteria 各項目** を PR diff と 1 対 1 で突合
- PR body の「AC 検証マップ」の全行が埋まっているか（ADR-0004）
- 「AC 検証マップ」の結果（`✅` / `❌`）が PR の実際の変更と整合しているか

**判定**:
- 全 AC が突合できた → 手順 2 へ
- ずれがある / AC が未対応 → 手順 5 で BLOCK

---

### 手順 2: スクリーンショット実視認（必須）

- PR body の `![...]()` / `<img>` / 外部 URL を **Read tool で実際に開いて見る**
- 見ていない画像に所見を書いてはならない
- **1 画像につき最低 1 行の具体的な所見を記録する**（「見ました」だけは不可）

#### スクリーンショットが不足 / 撮り直しが必要な場合

`scripts/capture.mjs` を使う。独自の Playwright スクリプトや手動でサーバーを起動する作業は不要。

```bash
# ---- デモ / 管理画面の1ページを撮る（サーバー自動起動・停止）----
node scripts/capture.mjs --pr <PR番号> --url /demo/admin/activities

# ---- 認証が必要な管理画面（--server-mode cognito で dev:cognito を自動起動）----
node scripts/capture.mjs --pr <PR番号> --server-mode cognito --url /admin/children

# ---- LP (site/) を撮る（--server-mode lp で静的サーバーを自動起動）----
node scripts/capture.mjs --pr <PR番号> --server-mode lp --url /index.html

# ---- 管理画面の代表ページ一括撮影 ----
node scripts/capture.mjs --pr <PR番号> --config scripts/capture-specs/admin.mjs

# ---- LP ページ一括撮影 ----
node scripts/capture.mjs --pr <PR番号> --server-mode lp --config scripts/capture-specs/lp.mjs

# ---- 特定 URL を mobile + desktop で撮る（--pr なしで出力先を指定） ----
node scripts/capture.mjs --url /demo/preschool/home --presets mobile,desktop --out docs/screenshots/pr-<PR番号>/
```

**`--pr <N>` を使うと自動化される処理:**
- 出力先: `docs/screenshots/pr-<N>/` に自動設定
- presets: `mobile,desktop` にデフォルト設定
- サーバー: 未起動なら自動起動し、撮影後に自動停止
- 完了後: PR body にコピーできる Markdown スニペットを標準出力に表示

**server-mode の選択基準:**

| 対象 | --server-mode | 起動されるサーバー |
|------|---------------|-----------------|
| `/demo/**` デモ画面 | `dev`（省略可） | `npm run dev` (port 5173) |
| `/admin/**` 本物の管理画面 | `cognito` | `npm run dev:cognito` (port 5174) |
| `site/` LP ページ | `lp` | `npx serve site` (port 5280) |

所見の例:
- `desktop SS: Button.svelte プリミティブが使われていること確認。tapSize=56px が確保されている`
- `mobile SS: テキストの折り返しが自然。overflow なし。CTA ボタンが視認できる`
- `mobile SS: ナビゲーション下部との重なりなし`

#### UI/UX 品質チェックリスト（1 画像ごとに確認）

| 観点 | チェック内容 |
|------|-------------|
| **レイアウト整合性** | グリッド崩れ・非対称配置・孤立要素・意図しない折り返しがないか |
| **文字列・段落** | テキストが途中で切れていないか・overflow・不自然な改行位置がないか |
| **読解容易性** | フォントサイズが小さすぎないか・背景とのコントラストが低くないか |
| **ユーザビリティ** | ボタン・リンクが視覚的に目立つか・重要情報が埋もれていないか |
| **タップ/クリック領域** | 年齢モード別 tapSize（baby:120px / preschool:80px / elementary:56px / junior:48px / senior:44px）が確保されているか |
| **モバイル固有** | floating CTA との重なり・横スクロール発生・viewport 幅からのはみ出しがないか |
| **アクセシビリティ** | テキストだけで意味が通じるか（絵文字・色だけに依存していないか） |
| **ダークパターン** | 焦らせる文言・誤誘導ボタン配置・過剰な数値主張がないか（ADR-0012） |
| **デザインシステム** | DESIGN.md §9 禁忌事項（hex 直書き・プリミティブ再実装・インラインスタイル等）に違反していないか |
| **競合他社比較** | 類似サービスの LP/UI と比べて著しく見劣りする点がないか |

> 全観点を毎回文章化する必要はない。「問題なし」の観点は一括 OK と書き、気になった点だけ具体的に記述する。ただし無言 approve は不可。

**判定**:
- 全画像を視認し所見あり → 手順 3 へ
- 画像が取得できない / URL が無効 → 手順 5 で BLOCK

---

### 手順 3: スクリーンショット欠落検知（必須）

diff の変更ファイルを確認し、以下に該当する場合は画像添付が必須:

- `.svelte` ファイルの変更（UI コンポーネント）
- `.css` / 設計書に影響するスタイル変更
- `site/**`（LP / pamphlet）の変更

上記に該当するのに PR body に画像が **1 枚もない** → 手順 5 で BLOCK。

CI の `screenshot-check` は「画像ファイルが PR body に存在するか」のみを検証する弱いチェック。内容の妥当性確認は QM 専権。

**判定**:
- UI/LP 変更なし、または画像が適切に添付されている → 手順 4 へ
- UI/LP 変更があるのに画像なし → 手順 5 で BLOCK

---

### 手順 4: CI ステータス確認（必須・最後に実行）

```bash
gh pr checks <番号> --repo Takenori-Kusaka/ganbari-quest
```

- 全 green → 手順 5 の approve 判断へ
- red / pending がある → approve しない。失敗理由を調査して手順 5 で BLOCK
- `skipping` は無視してよい（Dependabot 以外の条件分岐による skip）

> **順序の理由**: CI 確認を先にやると「CI 緑 = approve」という CI proxy 退行が再発する（#1197 / #1198 の教訓）。必ず手順 1-3 を完了した後に実行する。

---

### 手順 5: 承認/マージ判断

#### 全手順 Pass の場合 — approve & merge

```bash
# 1. QA アカウントに切替
gh auth switch --user ganbariquestsupport-lab

# 2. approve（手順 1-4 の所見をまとめて body に記載）
gh pr review <番号> --approve --body "$(cat <<'EOF'
✅ QM 5 手順 承認

**手順 1 (Issue 照合)**: <AC 突合結果を記載>

**手順 2 (SS 実視認)**: <各画像の所見を 1 行/枚で記載>

**手順 3 (SS 欠落検知)**: <UI/LP 変更の有無と画像確認結果>

**手順 4 (CI 確認)**: 全 checks pass 確認済み

**手順 5 (承認判断)**: 上記 4 手順すべてクリア。squash merge 可。
EOF
)" --repo Takenori-Kusaka/ganbari-quest

# 3. squash merge（mergeStateStatus が CLEAN になっていることを確認してから）
gh pr view <番号> --json mergeStateStatus --repo Takenori-Kusaka/ganbari-quest
gh pr merge <番号> --squash --delete-branch --repo Takenori-Kusaka/ganbari-quest

# 4. 開発アカウントに戻す
gh auth switch --user Takenori-Kusaka
```

> **注**: PR の author が ganbariquestsupport-lab だった場合、自分の PR は approve できない。その場合は Takenori-Kusaka で approve し、ganbariquestsupport-lab で merge する。

#### BLOCK 判定の場合 — 指摘コメント投稿

```bash
gh pr comment <番号> --body "$(cat <<'EOF'
## QM レビュー指摘 [BLOCK]

**手順 <N> (<手順名>) で BLOCK**

### 指摘内容
<具体的な問題。根拠（Issue の AC 番号・画像の URL・CI ジョブ名）を明記>

### 対応依頼
<開発者に何をしてほしいか>
EOF
)" --repo Takenori-Kusaka/ganbari-quest
```

BLOCK 後は Draft に戻すよう依頼するか、CI red の場合は修正コミットを待つ。

---

## Agent spawn プロンプトテンプレート（Orchestrator が使う定型文）

Orchestrator は以下を **PR ごとにコピーして** Agent tool に渡す。`<>` の部分を実際の値に置き換える。

```
あなたは PR #<番号> の QA Review Agent です。

## 担当 PR
- 番号: #<番号>
- タイトル: <タイトル>
- ブランチ: <headRefName>
- リポジトリ: Takenori-Kusaka/ganbari-quest
- 作業ディレクトリ: C:\Users\kokor\OneDrive\Document\GitHub\ganbari-quest

## あなたのミッション
`docs/sessions/qa-session.md` の「Tier 2 — Per-PR Review Agent の実行手順」を最初から読み、
PR #<番号> に対して 手順 1 〜 手順 5 を順番に全て実行してください。

## 完了時の報告（最後にテキストで Orchestrator に返す）
以下を報告すること:
- 手順 1〜4 の各判定（Pass / Block と根拠 1 行）
- 最終アクション: `approve & merge 完了` または `BLOCK（指摘コメント投稿済み）`
- Block した場合: 指摘内容の要約

## 注意事項
- このセッションで担当するのは PR #<番号> だけ
- 他の PR に手をつけない
- ファイルの読み込みは Read tool を使う（Bash の cat 禁止）
- スクリーンショット画像は Read tool で実際に開くこと（URL だけ確認は不可）
```

---

## QM が絶対にやってはいけないこと

以下は **Orchestrator・Review Agent 双方に適用**する。

| 禁止事項 | 理由 |
|---------|------|
| **CI 緑 = approve** | 自動マージツール化した瞬間に QM ロールは終わり（#1197 / #1198） |
| **スクリーンショット未視認で approve** | 添付されているだけで内容未確認は不可 |
| **Issue の `closes #X` を開かずに approve** | AC 照合漏れの温床 |
| **「見ました」とだけ書く所見** | 具体的な所見（色・形・tapSize・違和感の有無）を残す |
| **1 Agent で複数 PR を処理** | コンテキスト肥大化→手順ブレ→品質低下。1 Agent = 1 PR 厳守 |
| **独自フォーマットの approve body** | ADR-0022 — 手順 5 の定型フォーマットから外れない |
| **`--admin` bypass** | ADR-0022 で完全禁止 |

---

## Dependabot PR の扱い

- 下位互換性のないアップデートでも**採用する方針**
- 単なるマージで済まない場合（破壊的変更でコード修正が必要）→ PR を pending にして Issue を起票
- overlap 警告は無視してよい

---

## 品質基準（ADR-0005）

Review Agent が diff 内で以下を発見した場合は BLOCK:

- カバレッジ閾値の引き下げ（引き下げが必要なら ADR + 復元計画の同時コミットが必須）
- バグ隠蔽ヘルパー（ダイアログゴースト除去等）の使用
- `waitForTimeout()` の新規使用（`waitForSelector()` / `waitForResponse()` を使うべき）
- テスト内で実装ロジックを再実装している

### 場当たり的対応の検出（特に注視）

- CSS を個別コンポーネントにハードコード → 共通コンポーネントを使うべき
- hex カラー直書き → `var(--color-*)` セマンティックトークンを使うべき
- `<button class="...">` 直書き → `Button.svelte` プリミティブを使うべき
- ラベル文字列のハードコード → `labels.ts` を使うべき

### 境界線

- スコープ外の発見を「別の修正によるもの」としてスルーしない — Issue 起票するか修正する
- assertion を弱める修正を安易に受け入れない（ADR-0006）

---

## 参照すべきドキュメント（Review Agent が手順中に参照）

| ドキュメント | いつ参照するか |
|------------|--------------|
| `docs/DESIGN.md` | デザインシステム準拠のレビュー（手順 2） |
| `tests/CLAUDE.md` | テスト品質基準の確認（手順 1・品質基準）|
| `docs/design/parallel-implementations.md` | 並行実装の同期漏れチェック（手順 1） |
| `src/routes/CLAUDE.md` | UI 実装ルールの確認（手順 2） |
| `.github/CLAUDE.md` | PR 運用ルール・ラベル体系 |
| `docs/decisions/0006-safety-assertion-erosion-ban.md` | assertion 変更時（手順 1） |
| `docs/decisions/0002-critical-fix-quality-gate.md` | Critical バグ修正 PR 時（手順 1） |
| `scripts/capture.mjs` | スクリーンショット再撮影時（`npm run capture -- --url /path`） |
