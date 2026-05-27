# dev-process/ — 開発プロセス運用知 SSOT

> **AI エージェント・人間貢献者へ**: このディレクトリは、開発プロセスで蓄積した「思い出すべき運用知」を git 管理の参照可能な知識として集約する。
> セッション / AI / 担当者を跨いで再利用するための SSOT。会話の暗黙知や個人の memory に閉じない。

**関連 Issue**: #2516 (本ディレクトリ起票) / #2518 (KPT umbrella) / **関連 ADR**: ADR-0001 (設計書 SSOT)

---

## 位置付け（ADR・設計書・rationale との使い分け）

`docs/CLAUDE.md` の使い分け原則に 1 層追加する。

| 層 | 置き場所 | 内容 |
|---|---|---|
| 横断ポリシー（機械強制できない判断原則） | `docs/decisions/` (ADR) | Pre-PMF scope / assertion 禁止 / 設計書 SSOT 等 |
| 機能仕様の結論 | `docs/design/` (設計書) | API / DB / UI の正仕様 |
| 機能設計の経緯・理由 | `docs/rationale/` | なぜそう決めたか narrative |
| **開発プロセスの運用知** | **`docs/sessions/dev-process/`（本ディレクトリ）** | **完遂原則 / アンチパターン / QA fix パターン / 並列 Agent 運用 / 調査規律 等、繰り返し思い出すべき「動き方」** |
| ユーザーローカル作業メモ | Claude Code memory | 当該マシン固有 / transient state（チーム共有不可） |

**dev-session.md との関係**: [dev-session.md](../dev-session.md) が開発プロセス全体像（overall map）。本ディレクトリは各論。dev-session.md §「開発プロセス各論（dev-process/）」から本 README へ入る。

---

## 各論ファイル

| ファイル | 内容 | いつ読むか |
|---|---|---|
| [completion-principles.md](completion-principles.md) | 完遂原則（やりきり / 全 AC 完遂 / fix-forward / はりぼて禁止 / Done 基準） | Issue 着手前 / 困難遭遇時 / Done 判定時 |
| [anti-patterns.md](anti-patterns.md) | アンチパターン集（scope 外言い訳 / 越境 / assertion 弱体化 / ラバースタンプ / CI 前 Ready / 段階リリース禁止 等） | PR 着手前 / レビュー前 / 「逃げたく」なった時 |
| [qa-fix-patterns.md](qa-fix-patterns.md) | QA team が merge 前に加えた fix の頻出パターン集 | PR 着手前 / merge 通知受領後 |
| [parallel-agent-ops.md](parallel-agent-ops.md) | 並列 Agent / worktree 運用（分離必須 / push verify / stacked PR 不可 / CI trigger 仕様 / 待機運用） | 並列 Agent 起動前 / push 報告受領後 / CI が動かない時 |
| [research-discipline.md](research-discipline.md) | 調査規律（正しい問い → 仮説中立 framing → 反証確認） | deep research / 技術調査の着手前 |
| [feature-change-lateral-spread.md](feature-change-lateral-spread.md) | 機能変更時の横展開確認（用語 grep 全件 / LP・pricing・faq 波及 / SSOT 群同期） | 機能変更 Issue 起票時 / 用語・ラベル変更時 |

関連: [../../operations/self-review-agent.md](../../operations/self-review-agent.md)（Dev Self-Review、Self-Review HONESTY 学びを統合）

---

## 更新ルール

- 新しい dev-process 運用知が得られたら、該当する各論ファイルに追記する（履歴メタは混入させず「現状の正解」のみ — docs SSOT 原則 #2440）
- 横断ポリシー化すべきもの（機械強制不能な判断原則）は ADR 起票を検討（`docs/decisions/README.md` 10 枠 + 1-in-1-out）
- 機械強制できるもの（CI / lint / workflow / script）は `scripts/` / `.github/workflows/` へ実装し、本ディレクトリには「なぜそうするか」のみ残す
- KPT 会で得た Problem / Try は本ディレクトリへ反映する（散逸防止）
