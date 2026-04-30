# スクリーンショット撮影 トラブルシューティング KB

> **目的**: `scripts/capture.mjs` を使った PR スクリーンショット撮影で頻発する問題の解決ナレッジベース。
> 新規エントリは末尾に追加し、エントリ ID は連番（SC-NNN）で採番する。
>
> **Grep 検索のヒント**: エラーメッセージ・症状をそのまま grep すると該当エントリが見つかる。
>
> **追記ルール**:
> 1. `## SC-NNN` セクションを末尾にコピーして連番を振る
> 2. 各フィールドを埋める（未知の場合は `不明` と記入）
> 3. 解決後に `status` を `resolved` に更新する

**関連ドキュメント**:
- `docs/sessions/dev-session.md` — Screenshot Agent 必須指示テンプレート
- `scripts/capture.mjs` — 撮影スクリプト本体
- `docs/CLAUDE.md` — Cognito モック認証環境
- `docs/troubleshoot/github_actions.md` — CI 失敗の KB

---

## エントリテンプレート

```markdown
## SC-NNN — <タイトル>

| フィールド | 値 |
|-----------|-----|
| **発生日** | YYYY-MM-DD |
| **PR 番号 / Issue 番号** | #NNNN |
| **環境** | Windows Git Bash / WSL / macOS / Linux |
| **ステータス** | resolved / ongoing |

### 症状（原文）

\```
<エラーメッセージや表示されない症状を原文で>
\```

### 根本原因

<なぜ起きたか>

### 解決手順

\```bash
<再現可能なコマンド>
\```

### 再発防止策

<どうすれば再発を防げるか>
```

---

## SC-001 — `MSYS_NO_PATHCONV=1` 不在で URL が Windows パスに変換される

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-03 〜 (継続的に発生) |
| **PR 番号** | 多数 |
| **環境** | Windows Git Bash |
| **ステータス** | resolved |

### 症状

`scripts/capture.mjs --url /admin/children` を実行すると 404 エラーになり、撮影に失敗する。
ログに `C:\Program Files\Git\admin\children` のような Windows パスが現れる。

### 根本原因

Git Bash (MSYS) は POSIX スタイルパス `/admin/children` を Windows パス `C:\Program Files\Git\admin\children` に自動変換する。
`scripts/capture.mjs` の `--url` 引数として渡される時点でパス変換が起こるため、内部で組み立てる URL が壊れる。

### 解決手順

**必ず `MSYS_NO_PATHCONV=1` を prefix する**:

```bash
MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url /admin/children --presets desktop,mobile --out tmp/screenshots/pr-XXXX
```

### 再発防止策

- `docs/sessions/dev-session.md` の Screenshot Agent 必須指示テンプレートに明記済
- `scripts/capture.mjs --help` 出力にも記載
- Windows ユーザーは shell alias / PowerShell function に組み込むのも可

---

## SC-002 — フル URL 指定で内部二重結合により 404

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-03 〜 |
| **PR 番号** | 多数 |
| **環境** | 全環境 |
| **ステータス** | resolved |

### 症状

`--url http://localhost:5173/admin/children` のようにフル URL を渡すと 404 になる。

### 根本原因

`scripts/capture.mjs` は内部で `BASE_URL + path` を組み立てる。`--url` にフル URL を渡すと
`http://localhost:5173/http://localhost:5173/admin/children` のような二重結合になる既知バグ。

### 解決手順

**`--url` には常にパスのみを渡す**:

```bash
# OK
MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url /admin/children ...

# NG
MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url http://localhost:5173/admin/children ...
```

### 再発防止策

- `docs/sessions/dev-session.md` 「コマンドの禁止事項」に明記済
- 将来的に `scripts/capture.mjs` 側でフル URL を検出してパスのみに切り出す改修も検討可能

---

## SC-003 — `/demo/*` の撮影は実アプリ検証証跡にならない

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-22 (顧客クレーム発覚) |
| **PR 番号** | 多数（特に #1026 関連） |
| **環境** | 全環境 |
| **ステータス** | resolved |

### 症状

PR template の「スクリーンショット / ビジュアルデモ」要件を満たすために `/demo/admin/...` 等のデモ画面を撮影して添付したが、QA レビューで「実アプリの検証証跡として不可」と差し戻された。

### 根本原因

`/demo/*` はマーケティング/プレビュー専用のデモ画面で、実アプリの routes (`src/routes/(parent)/admin/...`) とは別実装。
デモ画面で UI が正しく見えても、実アプリで同じことが保証されない。

### 解決手順

**実アプリの routes を撮影する**:

```bash
# OK — 実アプリ /admin/*
MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url /admin/children --presets desktop,mobile

# NG — デモ画面
MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url /demo/admin/children --presets desktop,mobile
```

`/admin/*` への撮影は `npm run dev`（AUTH_MODE=local, port 5173）で自動認証されるため Cognito ログイン不要。

### 再発防止策

- メモリ `feedback_screenshot_correct_procedure.md` に記載
- `docs/sessions/dev-session.md` Screenshot Agent テンプレートに明記
- PR template の「スクリーンショット」セクションに「`/demo/*` は使用禁止」を明記

---

## SC-004 — `npm run dev` と `npm run dev:cognito` の使い分け

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-19 (#1026) |
| **PR 番号** | #1026 |
| **環境** | 全環境 |
| **ステータス** | resolved |

### 症状

- `npm run dev` で `/auth/login` を撮影しようとすると、自動認証によって 302 redirect され、ログインフォーム自体が描画されない。
- `npm run dev:cognito` を起動せずに `/ops/*` を撮影しようとすると認可エラーで撮れない。

### 根本原因

2 種類の dev mode が存在し、それぞれ異なる用途:

| モード | コマンド | port | 認証 | 用途 |
|--------|---------|------|------|------|
| local | `npm run dev` | 5173 | 自動認証（Cognito 不要） | `/admin/*`, `/[uiMode]/*` の通常 UI |
| cognito-dev | `npm run dev:cognito` | 5174 | Cognito mock でログイン | ログインフォーム / プラン別 UI / `/ops/*` |

### 解決手順

撮影対象に応じてモードを選ぶ:

```bash
# 管理画面・子供画面の撮影 (auto-auth で OK)
npm run dev  # port 5173
MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url /admin/children ...

# ログインフォーム / プラン別 UI / /ops/* の撮影
npm run dev:cognito  # port 5174
# ブラウザで DEV_USERS のアカウントでログインしてから撮影
```

DEV_USERS 一覧は `docs/CLAUDE.md` §「ローカル Cognito 認証検証環境 (#1026)」を参照。

### 再発防止策

- `docs/sessions/dev-session.md` Screenshot Agent テンプレート / 「devサーバーモードと認証の整理」表に明記済
- `docs/CLAUDE.md` で DEV_USERS と各モードの SSOT 維持

---

## SC-005 — `/setup/children` への自動リダイレクトで撮影できない

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-29 |
| **PR 番号** | #1678 |
| **環境** | Windows Git Bash + worktree |
| **ステータス** | resolved |

### 症状

worktree 上で `npm run dev` を起動して `/[uiMode]/home` 等の子供画面を撮影しようとすると、`/setup/children` に redirect されてしまう。worktree の `data/ganbari-quest.db` には children が 0 件。

### 根本原因

worktree は `git worktree add` で main directory のコピーが作られるが、`data/ganbari-quest.db` は **worktree ごとに独立した空 DB** の状態で生成される。`npm run db:seed` は活動マスタ等を投入するが children は作らない仕様。

`/setup/children` への redirect は **child 未登録時の正しい onboarding flow 仕様**であり、bug ではない。

### 解決手順

撮影前に test child + activity_logs を手動投入する:

```bash
# better-sqlite3 経由で手動投入 (Node.js REPL or 専用 script)
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/ganbari-quest.db');
db.prepare('INSERT INTO children (id, name, ui_mode, created_at) VALUES (?, ?, ?, ?)').run(1, 'テスト', 'elementary', new Date(Date.now() - 14*24*3600*1000).toISOString());
// activity_logs も必要に応じて投入
db.close();
"
```

または **メイン作業ディレクトリの DB をコピー**:

```bash
cp ../../data/ganbari-quest.db tmp/wt-XXXX/data/
```

### 再発防止策

- 「child 不在 → /setup/children redirect は仕様」と認識する
- worktree の DB seed 自動化スクリプト追加を検討（follow-up Issue 候補）
- 撮影 Agent 起動時に「worktree DB は空かもしれない」を前提とした手順を明記

---

## SC-006 — `waitForTimeout` 使用で flaky な撮影タイミング

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1442 |
| **環境** | 全環境 |
| **ステータス** | resolved |

### 症状

`waitForTimeout(N)` で固定時間待機する撮影スクリプトが、CI 環境で SS が真っ黒 / レイアウト崩れの状態で撮影されることがある。

### 根本原因

`waitForTimeout` は固定時間待機で、ページの実際のレンダリング完了を保証しない。CI の貧弱な実行環境では描画が完了する前にタイムアウトが切れて撮影が走る。

### 解決手順

**`waitForStablePage` を使う**:

`scripts/capture.mjs` 内に実装されている `waitForStablePage` は DOM mutation observer + network idle で実際のレンダリング完了を検知する。

```javascript
// NG
await page.waitForTimeout(2000);
await page.screenshot(...);

// OK
await waitForStablePage(page);
await page.screenshot(...);
```

### 再発防止策

- `docs/CLAUDE.md` の禁忌事項に明記済（「`waitForTimeout` 新規使用禁止」）
- `scripts/capture-specs/flows/*.mjs` 既存実装を参考にすること

---

## SC-007 — screenshots ブランチ (orphan) の bundle 撮影運用

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-29 (運用パターン確立) |
| **PR 番号** | #1564, #1682 以降の bundle PR |
| **環境** | 全環境 |
| **ステータス** | resolved |

### 症状

bundle PR (#1670 / #1673 / #1682 等で 8〜18 Issue を 1 PR にまとめる場合) で大量のスクリーンショットを `docs/screenshots/` にコミットすると、main branch の git history が肥大化する。

### 根本原因

スクリーンショットは binary で履歴がほぼ不要だが、`docs/screenshots/` を main branch に直接コミットすると永続的に残る。

### 解決手順

**`screenshots` という orphan branch を別管理する運用**:

```bash
# 初回作成時のみ
git checkout --orphan screenshots
git rm -rf .
git commit --allow-empty -m "Initial empty screenshots branch"
git push -u origin screenshots

# bundle PR 撮影時
git checkout screenshots
mkdir -p pr-XXXX
cp tmp/screenshots/pr-XXXX/*.png pr-XXXX/
git add pr-XXXX/
git commit -m "screenshots: pr-XXXX (bundle)"
git push origin screenshots

# PR 本文に raw URL で貼付
# https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/screenshots/pr-XXXX/<file>.png
```

### 再発防止策

- bundle PR (3 Issue 以上) で SS が 5 枚超える場合に推奨
- 単体 PR は `docs/screenshots/` 直 commit で十分
- `screenshots` branch は protected branch にしない（force push が必要なため）

---

## SC-008 — `tmp/` 配置の SS は gitignore でコミット不可

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-03 〜 |
| **PR 番号** | 多数 |
| **環境** | 全環境 |
| **ステータス** | resolved |

### 症状

`scripts/capture.mjs --out tmp/screenshots/pr-XXXX` で撮影した画像をそのまま `git add` してもステージされない。`docs/screenshots/` 配下に移動しないと PR にスクリーンショットを添付できない。

### 根本原因

`tmp/` ディレクトリは `.gitignore` でリポジトリ全体を除外している（一時的な作業ディレクトリ用途）。

### 解決手順

**撮影後に `docs/screenshots/` (または screenshots branch) にコピーしてからコミット**:

```bash
# 撮影
MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url /admin/children --out tmp/screenshots/pr-XXXX --presets desktop,mobile

# 配置
mkdir -p docs/screenshots/pr-XXXX
cp tmp/screenshots/pr-XXXX/*.png docs/screenshots/pr-XXXX/

# コミット
git add docs/screenshots/pr-XXXX/
git commit -m "docs: pr-XXXX screenshots"
```

### 再発防止策

- `scripts/capture.mjs` の `--out` のデフォルトを `docs/screenshots/` 直書きに変更する案あり (#1564 で議論)
- 当面は撮影 → コピーの 2 ステップで対応

---

## SC-009 — port 5173 既使用で `npm run dev` が即 fail (#1168)

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-19 (#1168) |
| **PR 番号** | #1168 |
| **環境** | 全環境 |
| **ステータス** | resolved |

### 症状

`npm run dev` を実行すると即座に「Port 5173 is already in use」で fail する（`--strictPort` 指定済のため fallback しない）。

### 根本原因

過去の `npm run dev` プロセスが kill されずに残っていることが多い。`--strictPort` は `--port 5174` への fallback を禁止する設定で、port 5173 が常に確保される前提。これは Cognito-dev の `--port 5174` (`--strictPort`) との衝突を防ぐため必須。

### 解決手順

**port 5173 を使用しているプロセスを kill**:

```bash
# Windows (Git Bash)
netstat -ano | grep ":5173" | awk '{print $5}' | sort -u | xargs -I {} taskkill //PID {} //F

# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 5173 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# macOS / Linux
lsof -ti:5173 | xargs kill -9
```

### 再発防止策

- 開発セッション終了時に `Ctrl+C` で正常停止
- `npm run dev` を background で起動する場合は PID を記録して停止する
- VS Code / IDE のターミナルが node process を生かしている可能性をまず疑う

---

## SC-010 — SS が PR 本文で表示されない（ローカル相対パス添付）

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-29 |
| **PR 番号** | #1691（観察） / #1740 + #1741（再発防止策確立） |
| **環境** | 全環境 |
| **ステータス** | resolved |

### 症状

PR body にスクリーンショットを添付したつもりだが、GitHub Web 上で開くと画像が表示されず壊れたリンクのアイコンだけが見える。
PR body のソースを見ると `![before](tmp/screenshots/pr-XXXX/before.png)` のようなローカル相対パスが書かれている。

QM Re-Review 時に SS 視認不可で、QM 側で代替撮影することになる（PR #1691 で実発生）。

### 根本原因

- `tmp/` ディレクトリは `.gitignore` で除外されている（SC-008 参照）。リポジトリにコミットされていないファイルへの相対パスは、GitHub の renderer から解決できない。
- PR 作成時に `scripts/capture.mjs --out tmp/screenshots/pr-XXXX` で撮影したファイルパスをそのまま貼り付けると、GitHub では表示されない。
- ローカルの VS Code Markdown プレビュー等では「ファイルが手元にあるため」表示されてしまうため、本人の手元では問題に気付けない。

### 解決手順

PR body の SS 添付には **GitHub Web 上で表示できる URL のみ** を使う:

```bash
# 推奨 1: 撮影 → docs/screenshots/ にコピー → コミット → raw URL
MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url /admin/children --out tmp/screenshots/pr-XXXX --presets desktop,mobile
mkdir -p docs/screenshots/pr-XXXX
cp tmp/screenshots/pr-XXXX/*.png docs/screenshots/pr-XXXX/
git add docs/screenshots/pr-XXXX/
git commit -m "docs: pr-XXXX screenshots"
# PR body に貼る:
#   ![before-mobile](https://raw.githubusercontent.com/Takenori-Kusaka/ganbari-quest/<branch>/docs/screenshots/pr-XXXX/before-mobile.png)

# 推奨 2: GitHub Web の PR 編集画面に画像をドラッグ&ドロップ → user-attachments URL が自動生成される
#   ![after-pc](https://github.com/user-attachments/assets/<uuid>)

# 推奨 3: bundle PR (SS 大量) は SC-007 の screenshots orphan branch を使う
```

**提出前の必須確認**: PR 本文を保存後、GitHub Web 上のプレビューで画像が表示されていることを目視確認する。表示されていなければ URL を直す。

### 再発防止策

- `scripts/check-pr-screenshot.mjs` (#1740 + #1741) が PR body 内の `tmp/` / `.tmp-screenshots/` 参照を検出し、CI (`pr-quality-gate.yml::screenshot-quality-check`) で警告/失敗する
- 段階適用フラグ `SCREENSHOT_CHECK_MODE=warn|error` で運用。最初は warn-only で運用し、定着後に `error` に昇格する設計（ADR-0006 ratchet 原則）
- `docs/sessions/dev-session.md` Screenshot Agent テンプレート §「URL 形式の制約」に明記済
- `.github/PULL_REQUEST_TEMPLATE.md` の「添付ルール」「Ready for Review チェックリスト」にも記載

---
