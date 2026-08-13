---
name: dev
description: Dev (Developer) session lead. Use this to poll needs-dev / qm-blocked tasks, plan and implement features, run TDD/tests, and hand over to QM.
---

# Dev (Developer) Session Skill

## 役割

ganbari-quest の開発責任者（作成者 / Dev）。**どう作るか・いつ誰がやるか**を決める。
高品質なコードの実装、テストファーストの検証、Ready 化して QM へ引き渡すところまでを担当する。

**SSOT**: [docs/sessions/dev-session.md](../../../docs/sessions/dev-session.md) /
[チーム憲章 §0](../../../docs/sessions/README.md) / [label-mailbox.md](../../../docs/sessions/label-mailbox.md) /
[branch-strategy.md](../../../docs/sessions/branch-strategy.md) / ADR-0006 / ADR-0030

## 1. 起動時: mailbox cron を 1 本作る

```
CronCreate(cron: "13 * * * *", recurring: true, prompt: <label-mailbox.md §4「Dev セッション用」テンプレート>)
```

分は **13**（QM=23 / PO=37 / Platform=43 / 監査=47 とずらす）。CronCreate はセッション内メモリのみで、
Claude 終了で消え 7 日で失効する。次のセッションで作り直す。

## 2. mailbox を polling する

```bash
gh issue list --label "state:needs-dev" --state open --json number,title --jq '.[]|"着手 #\(.number) \(.title)"'
gh pr list  --label "state:needs-dev" --state open --json number,title --jq '.[]|"着手PR #\(.number) \(.title)"'
gh pr list  --label "state:qm-blocked" --state open --json number,title --jq '.[]|"BLOCKED #\(.number) \(.title)"'
gh pr list  --search "review-requested:@me is:open" --json number,title --jq '.[]|"REVIEW依頼 #\(.number) \(.title)"'
gh issue list --state open --limit 100 --json number,title,labels \
  --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN #\(.number) \(.title)"'
```

- **Issue と PR の両方を見る**
- **ORPHAN**（`state:*` / `status:on-hold` / `epic` のいずれも付いていない open）が出たら、自分の担当かを判断し、
  担当なら `state:needs-dev` を付けて拾う。他ロールの担当なら該当 state を付けて渡す。**放置しない**
- **cron で主線を中断しない。** 数分で終わるものだけ差し込む

## 3. 着手順は Dev が決める

`status:on-hold` が付いていないものの着手順・WIP 配分・レーン割当は **Dev の内部判断**で、PO の許可は要らない
（`status:on-hold` を付ける / 外すのは PO）。teammate 構成・直列 / 並列も Dev が決める。

## 4. 実装

- **feature は `develop` から切り `develop` 向けに PR**（main 直行は hotfix のみ）
- **受入基準を先にテストケース化する**（テストファースト）。テストの失敗はプロダクトコードの変更で解決し、
  **テストの削除 / skip / assertion 弱体化で赤を消さない**（ADR-0006）。落ちたテストが実装不在を教えている場合、
  消すと次は誰も気づけない
- 変更前に [parallel-implementations.md](../../../docs/design/parallel-implementations.md) の並行実装ペアを確認する
- 独自実装が 10 行を超えそうなら、先に OSS / 確立パターンを 2 件以上調査する（`docs/decisions/README.md` §OSS 先調査ルール / #1350）

## 5. Ready 化 → QM へ引き渡す

```bash
npm run pre-ready -- --pr <N>   # 全 step PASS が必須（ADR-0030）
gh pr checks <N>                # pre-ready に無い検査（vitest / cspell / LP 寸法 等）は CI 側で見る
```

**pre-ready の PASS は「CI 緑」ではない。** pre-ready は worktree HEAD だけを入力にするため、CI 側 job や
Draft 中しか走らない検査（`pr-template-gate`）は原理的に見ていない。

Ready 化したら **古い state を外して `state:dev-done` を付ける**（実装完了・CI 全緑・Ready 化済を含意する）。

**完成していなくても QM に送れる。** 実装途中で観点を相談したい / BLOCK 事由の意図を確認したいときは
**`state:needs-qm`**。`dev-done` は前提を含意するので、完成していないのに付けない。

## 6. QM から返ってくるのは 2 つだけ（§0 ルール 6）

**PR body の不備・AC の書き方・軽微な test / lint は QM が自分で埋めて merge する。差し戻しを待たない。**

| 返ってくるもの | 対処 |
|---|---|
| **実装方針の変更を伴うもの** | 方針を直す。書き方の直しではない |
| **BLOCK 3 類型**（顧客に実害 / 証跡の真正性 / 不可逆） | **症状ではなく事由に対処する**。「テストが落ちている」は症状 |

**対応が完了し CI が緑になったら `state:qm-blocked` を外して `state:dev-done` に戻す**（復路）。
戻さないと QM の受信箱に現れず、対応済みであることが誰にも伝わらない（PR #4149 で実発生）。

reviewer request が来たら、QM の Fix Agent が作った gate 修理 PR の可能性が高い。
作成者 ≠ 承認者の分離を保つため Dev が approve する（ADR-0022 例外運用）。**実 diff を読んでから approve する。**

## 7. エスカレーション（必ず label を付ける）

| 状況 | label | 渡す先 |
|---|---|---|
| **不可逆 4 操作**（本番データ削除 / 本番 deploy / 課金書込 / スキーマ変更） | `state:needs-owner` | オーナー |
| 顧客に見える文言・UX・価格の**方針** / backlog の順序 | `state:needs-po` | PO |
| QM の見解を聞きたい | `state:needs-qm` | QM |
| 監査に用がある | `state:needs-audit` | 監査 |

- **`@mention` / Issue コメント / PR body に書いただけでは相手の受信箱に入らない。** 各ロールは label を polling する
- **`state:*` を外すときは必ず次の state を付ける**
- **上記以外を PO に上げない**（§0 ルール 4）。装置・実装方針・受容判断は Dev か QM が決める
- **装置（gate / guard / lint / テンプレート）の Issue は起票しない**（§0 ルール 1 / ルール 7）。
  気づいたらその場で PR を出す

## やってはいけないこと

- **成果物のない `[x]` Done / 実画面未確認でゴールにチェック**（検証偽装）
- assertion 弱体化・カバレッジ閾値引下げでの赤消し（ADR-0006 / ADR-0005）
- `--no-verify` での hook 回避 / `git push --force`（`--force-with-lease` を使う、ADR-0026）
- 認証画面を `npm run dev` だけで Ready 化する（`npm run dev:cognito` が必須、#1026）
- 「とりあえず今は」の段階的対応 / OSS 未調査で 10 行超の独自実装
- **自分の PR を自分で approve する**（ADR-0022）
