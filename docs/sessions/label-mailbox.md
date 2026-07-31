# Label Mailbox — セッション間の受け渡し SSOT

> **このファイルの位置づけ**: PO / Dev / QM / 監査の各セッションが、**人間の中継なしに「次に自分が動くもの」を GitHub から拾う**ための仕組みの SSOT。label の語彙・意味・誰が付けるか・各ロールが何を polling するか・cron の作り方を定める。
>
> **関連**: [po-session.md](po-session.md) / [dev-session.md](dev-session.md) / [qa-session.md](qa-session.md) / [audit-team.md](audit-team.md) / [branch-strategy.md](branch-strategy.md) ｜ **関連 ADR**: ADR-0022（作成者 ≠ 承認者）/ ADR-0056（役割分離）

---

## §1 設計背景

各ロールは**別クローン・別セッション**で動く（`ganbari-quest-po` / `-dev` / `-qa` / `-audit`）。セッション間の直接通信手段は存在しない（Claude Code のセッション間通信は 2026-07 時点で未サポート）。

そのため実運用では、**オーナーが各セッションの発言を手でコピーして中継**していた。1 日 8 往復の中継が発生し、以下が構造的に起きた。

- **決定がセッション上にしか無い** — PR body の「PO 承認条件 3 件」に GitHub 上の出典が無く、レビュアが検証できなかった（QM 指摘、2026-07-31）
- **次に誰が動くかが GitHub から読めない** — 各セッションは自分で仕事を拾えず、オーナーの中継待ちで停止する
- **報告の粒度で判断が歪む** — 「BLOCK 3 類型に非該当」を先に読んで CI 赤を見落とす等

**この仕組みがないと困ること**: オーナーが不在の間、全セッションが止まる。オーナー代行を縮小できない（[po-session.md](po-session.md) の引き渡し条件 1）。

**設計方針**: 新しい通信基盤を作らない。**GitHub が既にメッセージバスとして動いている**ので、足りない「次に誰が動くか」だけを label と GitHub 標準機能で機械可読にする。

---

## §2 設計原則

1. **GitHub が既にモデル化しているものに label を作らない** — approve の依頼は **reviewer request**（GitHub 標準）を使う。label は「状態」だけを表す
2. **label は状態であって指示ではない** — `state:ready-to-merge` が付いていても、**CI 緑は自分で確認する**。label は実測を代替しない（PO がラベルだけ見て merge 可と判断し、QM が赤を理由に拒否した実例あり）
3. **付けた側が意味に責任を持つ** — 自分のレーンから次のレーンへ渡すときに、渡す側が付ける
4. **不可逆 4 操作だけはオーナーへ上げる** — 削除（gate / guard / test の削除を含む）/ 本番 deploy / 課金書込 / スキーマ変更。それ以外はセッションが自分で判断して進む
5. **語彙を増やさない** — 4 種で足りている。増やす前に GitHub 標準機能で表せないかを確認する

---

## §3 仕様

### §3.1 label 語彙（4 種）

| label | 意味 | 付ける人 | 次に動く |
|---|---|---|---|
| `state:dev-done` | 実装完了・CI 全緑・Ready 化済 | Dev | **QM** |
| `state:qm-blocked` | BLOCK 3 類型に該当（顧客に実害 / 証跡の真正性 / 不可逆） | QM | **Dev** |
| `state:ready-to-merge` | QM approve 済 | QM | **QM**（merge を実行） |
| `state:needs-owner` | **不可逆 4 操作**を含み PO / オーナー判断が要る | 誰でも | **オーナー** |

`state:needs-owner` は**誰が気づいても付けてよい**。Dev が実装中に気づいた場合も付ける。

### §3.2 label で表さないもの（GitHub 標準を使う）

| 用途 | 使うもの | 理由 |
|---|---|---|
| **approve の依頼** | `gh pr edit <N> --add-reviewer <user>` | GitHub が reviewer request としてモデル化済。label で二重管理しない |
| release cut の依頼 | PO → 監査への明示依頼（[audit-team.md](audit-team.md) §3.8 step 6） | cut は監査 orchestrator の不可逆 action。label で自動起動させない |
| 統合監査の対象 | `base:main head:release/*` の open PR | branch 名で判別できる。label 不要 |

> **例外運用**: gate 欠陥で Dev が PR を出せない場合に限り QM の Fix Agent が修理 PR を作る。その PR の approve は **Dev** が行う（ADR-0022 作成者 ≠ 承認者）。この受け渡しは **reviewer request** で行い、専用 label を作らない。

### §3.3 ロール別 polling 対象

各セッションは**起動時**と**定期**に、自分の mailbox を確認する。

| ロール | 拾うもの | コマンド |
|---|---|---|
| **Dev** | `state:qm-blocked` / 自分に来た reviewer request | `gh pr list --label "state:qm-blocked" --state open` / `gh pr list --search "review-requested:@me is:open"` |
| **QM** | `state:dev-done` / `state:ready-to-merge`（自分が merge） | `gh pr list --label "state:dev-done" --state open` |
| **PO / オーナー** | `state:needs-owner` | `gh issue list --label "state:needs-owner" --state open` + PR 側も |
| **監査** | `release/* → main` の open PR | `gh pr list --base main --state open` |

### §3.4 CronCreate の作り方（各セッション起動時に実行）

各ロールのセッションは、起動直後に **自分の mailbox を毎時チェックする cron を 1 本だけ**作る。

```
CronCreate(cron: "<ロールごとにずらした分>", recurring: true, prompt: "<§4 のテンプレート>")
```

**分をロールごとにずらす**（同時刻に集中させない、また :00 / :30 を避ける）:

| ロール | 推奨 cron | 
|---|---|
| Dev | `13 * * * *` |
| QM | `23 * * * *` |
| PO | `37 * * * *` |
| 監査 | `47 * * * *` |

#### CronCreate の制約（必ず理解して使う）

- **セッション内メモリのみ**。Claude を終了すると消える。ディスクに書かれない
- **7 日で自動失効**する
- **REPL が idle のときだけ発火**する（クエリ実行中は発火しない）
- したがって **「オーナー不在の間に動く」用途には使えない**。あくまで「セッションが生きている間、自分の仕事を自分で拾う」ための仕組み

**恒久化する場合**は GitHub 側に置く（`on: issues/pull_request types: [labeled]` → Discord webhook）。ただし既存の Discord 通知経路（`src/lib/server/discord-alert.ts` / `infra/gcp/`）に相乗りし、**同目的の機構を 2 つ作らない**。実際に見落としが発生してから作る。

---

## §4 cron プロンプト テンプレート

### Dev セッション用

```
Dev mailbox チェック。以下を実行して結果を簡潔に報告する（何も無ければ「mailbox 空」の 1 行でよい）:

gh pr list --label "state:qm-blocked" --state open --json number,title --jq '.[]|"BLOCKED #\(.number) \(.title)"'
gh pr list --search "review-requested:@me is:open" --json number,title --jq '.[]|"REVIEW依頼 #\(.number) \(.title)"'
gh issue list --label "state:needs-owner" --state open --json number,title --jq '.[]|"OWNER待ち #\(.number) \(.title)"'

- state:qm-blocked があれば、BLOCK 事由（顧客に実害 / 証跡の真正性 / 不可逆 のどれか）を PR コメントから読み、
  症状ではなく事由に対処する。テストの赤は症状であって事由ではない。
  テストの削除 / skip / assertion 弱体化で赤を消さない（ADR-0006）
- reviewer request は QM の Fix Agent が作った gate 修理 PR の可能性が高い（ADR-0022 例外運用）。
  作成者 ≠ 承認者の分離を保つため Dev が approve する。実 diff を読んでから approve する
- state:needs-owner は自分では進めない。オーナーに提示する材料（実 diff / 影響範囲）だけ用意する
- 現在の主線タスクを中断してまで割り込ませない。主線が E3 等の最優先なら、approve だけ差し込んで戻る
```

### QM セッション用

```
QM mailbox チェック。以下を実行して結果を簡潔に報告する（何も無ければ「mailbox 空」の 1 行でよい）:

gh pr list --label "state:dev-done" --state open --json number,title --jq '.[]|"レビュー待ち #\(.number) \(.title)"'
gh pr list --label "state:ready-to-merge" --state open --json number,title,mergeStateStatus --jq '.[]|"MERGE可 #\(.number) [\(.mergeStateStatus)] \(.title)"'

- 報告は必ず「CI 個別行の実測（非 pass 行の有無）」を先に書き、結論はその後に置く。
  「BLOCK 3 類型に非該当」は CI 緑を含意しない
- state:ready-to-merge でも、gh pr checks で緑を確認してから merge する。赤を跨いだ merge は
  理由が正当でも外形が admin bypass と区別できない
- BLOCK できるのは 3 類型のみ（顧客に実害 / 証跡の真正性を弱める / 不可逆）。
  gate の削除は PO 承認事項であって BLOCK 事由にしない。懸念は approve + コメントに降格する
- follow-up は PR コメント止まり。Issue にしない
```

### PO セッション用

```
PO mailbox チェック。以下を実行して結果を簡潔に報告する（何も無ければ「mailbox 空」の 1 行でよい）:

gh issue list --label "state:needs-owner" --state open --json number,title --jq '.[]|"ISSUE #\(.number) \(.title)"'
gh pr list --label "state:needs-owner" --state open --json number,title --jq '.[]|"PR #\(.number) \(.title)"'
gh pr list --label "state:ready-to-merge" --state open --json number,title,mergeStateStatus --jq '.[]|"READY #\(.number) [\(.mergeStateStatus)] \(.title)"'

- state:needs-owner は、不可逆 4 操作（削除 / 本番 deploy / 課金書込 / スキーマ変更）のどれに
  該当するかを 1 行で示し、判断材料（実 diff / 影響範囲）を添えてオーナーに提示する
- state:ready-to-merge は CI が実際に緑かを gh pr view で確認してから報告する。ラベルは実測を代替しない
- PO の決定は、指示を出した時点で該当 Issue / PR にコメントとして残す。セッション上の発言は証跡にならない
```

### 監査セッション用

```
監査 mailbox チェック。以下を実行して結果を簡潔に報告する（何も無ければ「統合対象なし」の 1 行でよい）:

gh pr list --base main --state open --json number,title,headRefName --jq '.[]|"統合PR #\(.number) [\(.headRefName)] \(.title)"'
git fetch origin develop main -q && git rev-list --count origin/main..origin/develop

- base:main の open PR があれば audit-team.md §3.8 の 9 ステップに入る
- main..develop が 50 commits を超えていたら、バッチが育ちすぎている。PO に release cut を提案する
  （#3995 は凍結できないまま 4 日で実査不能になり棄却された）
- per-PR の AC は再判定しない（QM の領域、§3.4 二重判定回避）
```

---

## §5 運用上の注意

| 注意 | 理由 |
|---|---|
| **label を付け替えるときは古い state を外す** | 2 つ付いていると「次に誰が動くか」が読めなくなる |
| **label は状態であって承認ではない** | `state:ready-to-merge` は「QM が approve した」記録であって、CI 緑の保証ではない |
| **cron の結果が空でも報告する** | 「mailbox 空」が出ないと、cron が動いているのか死んでいるのか分からない |
| **cron を主線の割り込みにしない** | 拾ったものが数分で終わるなら差し込む。そうでなければ現在の主線を優先し、拾ったことだけ報告する |
| **セッション終了で cron は消える** | 次のセッション起動時にもう一度作る。§3.4 の制約を参照 |

## §6 現状（2026-07-31 時点）

- label 4 種は作成済み（QM が作成）
- 運用開始: `#4134` = `state:qm-blocked` / `#4138` = `state:dev-done`
- PO セッションの cron は作成済み（`37 * * * *`）
- **恒久化（GitHub workflow → Discord）は未実施。** 実際に見落としが発生してから作る
