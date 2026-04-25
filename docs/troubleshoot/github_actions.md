# GitHub Actions CI トラブルシューティング KB

> **目的**: CI Agent が参照・追記する「生きたナレッジベース」。
> 新規エントリは末尾に追加し、エントリ ID は連番（TA-NNN）で採番する。
>
> **Grep 検索のヒント**: エラーメッセージ文字列をそのまま grep すると該当エントリが見つかる。
>
> **追記ルール**:
> 1. `## TA-NNN` セクションを末尾にコピーして連番を振る
> 2. 各フィールドを埋める（未知の場合は `不明` と記入）
> 3. 解決後に `status` を `resolved` に更新する

---

## エントリテンプレート

```markdown
## TA-NNN — <タイトル>

| フィールド | 値 |
|-----------|-----|
| **発生日** | YYYY-MM-DD |
| **PR 番号** | #NNNN |
| **ワークフロー** | CI / Labeler / pr-quality-gate / lp-metrics 等 |
| **ジョブ名** | lp-sync-check / biome / svelte-check 等 |
| **ステップ名** | Run check / Install dependencies 等 |
| **ステータス** | resolved / ongoing |

### エラーメッセージ（原文）

\```
<ここにエラーログをそのまま貼る — Grep で引っかかるよう原文必須>
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

## TA-001 — generate-lp-labels.mjs 変更後に site/shared-labels.js の再生成漏れ

| フィールド | 値 |
|-----------|-----|
| **発生日** | 2026-04-25 |
| **PR 番号** | #1490 |
| **ワークフロー** | CI |
| **ジョブ名** | lp-sync-check |
| **ステップ名** | Check LP labels sync |
| **ステータス** | resolved |

### エラーメッセージ（原文）

```
✗ site/shared-labels.js が labels.ts と同期されていません。
node scripts/generate-lp-labels.mjs を実行して再生成してください。
```

### 根本原因

`scripts/generate-lp-labels.mjs` を修正（biome `noUnusedVariables` 対応で変数参照を調整）した際、
`site/shared-labels.js`（同スクリプトが生成する成果物）を再生成しないままコミット・プッシュしたため。

CI の `lp-sync-check` ジョブが `--check` フラグ付きで同スクリプトを実行し、
生成物とソースの差分を検知してエラーを返す仕組みになっている。

**失敗した CI run**: `24922966286`（2026-04-25T04:51:35Z）

### 解決手順

```bash
# 1. 同期状態を確認
node scripts/generate-lp-labels.mjs --check

# 2. 同期されていない場合は再生成
node scripts/generate-lp-labels.mjs

# 3. 生成物をコミット
git add site/shared-labels.js
git commit -m "chore: site/shared-labels.js を再生成（generate-lp-labels.mjs 修正後）"
git push

# 4. CI が再トリガーされるか確認（pull_request イベントの CI が走ること）
gh run list --branch <ブランチ名> --workflow ci.yml --limit 3
```

### 再発防止策

- `scripts/generate-lp-labels.mjs` を変更した PR では、**必ず** `node scripts/generate-lp-labels.mjs` を実行して `site/shared-labels.js` をコミットに含める
- コミット前チェックとして `node scripts/generate-lp-labels.mjs --check` を実行する習慣をつける
- `CLAUDE.md` の「新規 label 追加時」注記（§必ず守ること §デザインシステム）に「`generate-lp-labels.mjs` 自体を変更した場合も再生成必須」と明記済み（#1490 対応）

---
