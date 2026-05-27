# 並列 Agent / worktree 運用

> 複数 Agent を並列で動かす際の干渉防止・push verify・CI trigger 仕様・待機運用。並列作業の消失や stale 報告を防ぐ。

**SSOT 位置付け**: [dev-process/README.md](README.md) の各論。Agent 委任ポリシーの本体は [dev-session.md](../dev-session.md) §委任ポリシー。

---

## 1. 並列 Agent は worktree 分離必須

複数の Dev Session Agent を **同一 working directory** で並列起動すると、各 Agent が独立に `git checkout` / `git pull` / `git stash` を実行し、別 Agent の作業ブランチが上書きされて作業が消失する。

- Agent tool 起動時に **必ず `isolation: "worktree"` を指定**する（一時 worktree が自動作成され、各 Agent が独立ファイルツリーで作業）
- 並列 Agent 数の目安: 3-4（worktree 分離前提）。同一 directory での並列は 1 Agent のみに制限
- 完了後は worktree が自動 cleanup（変更なし時）または path / branch 名が返却される（変更あり時）

---

## 2. Agent の「push 済」報告は trust but verify

並列 worktree で複数 Agent が同 branch に push する場合、local の `refs/remotes/origin/...` が stale になり「push 済」報告が誤認識される可能性がある。Agent 報告を **GitHub API で実 SHA 確認**して verify する。

```bash
# 1. Local refs を最新化
git fetch origin <branch>:refs/remotes/origin/<branch> --force

# 2. Local ref vs remote API 実 SHA 比較
git rev-parse origin/<branch>
gh api repos/Takenori-Kusaka/ganbari-quest/git/refs/heads/<branch> --jq '.object.sha'
# 両者一致を確認（不一致なら local stale）

# 3. Agent 報告の最終 commit SHA が remote にあるか確認
```

並列 Agent への prompt にも「push 後は `gh api .../git/refs/heads/<branch>` で remote 実 SHA を確認し、自分の最終 commit と一致を verify。不一致なら push 失敗と判定し retry / 引継 note 作成」を明示する。

**根本対処**: 同 branch を複数 worktree で並行更新するなら各 Agent 起動前に `git fetch --all --force`。可能なら sequential session で 1 branch = 1 active worktree を維持。

> 教訓: 4 Agent が "push 済" 報告したが、後続 Agent は local ref が stale で force-with-lease reject され push 失敗していた。各 Agent は「stale で reject」と認識せず「push 済」と報告していた。

---

## 3. Agent 委任ポリシー（直列 / 並列の使い分け）

- **デフォルトは Issue 1 件ずつ直列**（前 Issue の PR が Ready / CI 全緑になってから次へ）
- **重大 Issue（DB / 認証 / 課金 / `priority:critical` / 設計書同期必要 / 並行実装ペア接触）**: Claude 本体が primary implementer。Agent は同一 Issue の多観点セルフレビュー用途のみ
- **軽微 Issue 群（typo / 単一文言 / dep bump / コメント整理 / 30 行未満 / 単独 AC 完結）**: Plan agent 判断で並列 + Agent 全工程委譲可。並列許容条件 6 項目を全て満たすこと
- **判断に迷う場合**: 直列処理にフォールバック（安全側）

並列許容条件 6 項目: 修正ファイル非重複 / 並行実装ペア非接触 / DB 変更なし / 設計書同期不要 / `priority:critical` でない / 単独 AC 完結。

**多観点セルフレビュー用途**: UI 変更 → frontend-architect / 認可・認証 → security-engineer / テスト → quality-engineer / リファクタ → refactoring-expert / 全体整合 → self-review。Agent 指摘は精査してから採否判断（鵜呑み禁止）。詳細は [dev-session.md](../dev-session.md) §委任ポリシー。

---

## 4. stacked PR は採用しない（CI が起動しない）

`.github/workflows/ci.yml` 等は `on: pull_request: branches: [main]` のため、base が `main` でない PR（stacked PR）では CI / lp-metrics / quality-gate が起動しない（Labeler のみ動く）。

- **stacked PR 戦略は採用しない**。前提 PR は main 起点で 1 PR ずつ Ready → CI 全緑 → main merge の直列で進める
- 後続 Issue が直前 PR 機能に依存していても、main merge を待ってから新 PR を切る
- 並列が必要な Issue 群は、依存しない範囲を選んで main 起点で並列 PR を切る（修正ファイル非重複が条件）

---

## 5. CI が新 push で trigger されない時の診断順序

### (a) PR CONFLICTING（実体 conflict）

`mergeable: CONFLICTING` / `mergeStateStatus: DIRTY` 状態では、GitHub Actions は新 commit に対して `pull_request` workflow を起動しない仕様。並行 PR でファイル重複がある場合に頻発。

```bash
gh pr view <num> --json mergeable,mergeStateStatus
# CONFLICTING / DIRTY なら conflict 解消（origin/main merge or rebase + force-with-lease）→ 即座に workflow chain 再開
```

### (b) GitHub Actions 表示同期バグ（上位 job アイコン stuck）

内部 sub-step が全完了しても上位 job ヘッダーアイコンが pending（オレンジドット）のまま残ることがある。

- **downstream job が緑完了している** = 上位 job は実質完了（表示遅延のみ）
- pending が 10 分以上 stuck する場合、Actions UI で sub-step 完了 + downstream 緑を確認 → `gh pr ready` を試行可
- 万一 Ready 化後も pending stuck なら Re-run all jobs

(a) は実体 conflict、(b) は表示 sync bug。まず (a) を `gh pr view --json mergeable` で疑う。

---

## 6. 長時間待機は scheduler を使う（session 放置で進捗を止めない）

数十分〜数時間の待機（QA merge 完了 / CI 長時間 build / LP デプロイ）が必要な場合、自動再起動を設定する。

- 待機 60 分以下 → ScheduleWakeup で `delaySeconds` 指定
- 待機 60 分超 / 定期 polling 必要 → `/loop <interval>`
- session を「user 通知待ち」で放置せず、自分で再起動タイミングを設定する

**QA team の merge 週期**（PO 共有）: 毎時 :07 レビュー開始 → :30 頃 merge 完了。PR Ready 化は :05 までに済ませると :07 枠に乗る。merge watcher 起動は :15 以降が効率的。
