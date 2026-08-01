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
5. **語彙を増やさない** — 増やす前に GitHub 標準機能で表せないかを確認する。ただし**渡す経路が存在しない**なら語彙不足であり、増やすのが正しい（§6）

---

## §3 仕様

### §3.1 label 語彙（8 種）

| label | 意味 | 付ける人 | 次に動く |
|---|---|---|---|
| `state:needs-dev` | PO / QM が Dev に**着手を渡した** | PO / QM | **Dev** |
| `state:dev-done` | 実装完了・CI 全緑・Ready 化済 | Dev | **QM** |
| `state:qm-blocked` | BLOCK 3 類型に該当（顧客に実害 / 証跡の真正性 / 不可逆） | QM | **Dev** |
| `state:ready-to-merge` | QM approve 済 | QM | **QM**（merge を実行） |
| `state:needs-audit` | 統合監査 / release cut を監査チームに渡した | PO | **監査** |
| `state:needs-platform` | **装置の削減 / 統合 / 自動生成**をプラットフォームに渡した（[README.md §3.4](README.md#34-プラットフォーム開発基盤--新設ロール)） | PO / Dev / QM | **Platform** |
| `state:needs-po` | **不可逆 4 操作ではない PO 判断**が要る（方針 / 優先度 / repo 設定 / 受容判断 / 語彙・ルールの改訂） | 誰でも | **PO** |
| `state:needs-owner` | **不可逆 4 操作**（削除 / 本番 deploy / 課金書込 / スキーマ変更）を含む | 誰でも | **オーナー** |

- `state:needs-po` / `state:needs-owner` は**誰が気づいても付けてよい**。Dev が実装中に気づいた場合も付ける
- **判断を仰ぐときは必ずどちらかを付ける。** 「不可逆 4 操作に当たらないから `needs-owner` は付けない」で終わらせない — それは判断が要らないという意味ではない。**`needs-po` がその受け皿**

> **§3.1 の欠落で実際に起きたこと（2026-07-31）**: Dev が「ruleset 変更」「node バージョン EBADENGINE」の 2 件を PO 判断待ちとして Issue コメント / PR body に書いたが、**不可逆 4 操作に当たらないため label を付けなかった**。PO はコメントを polling していないため、**どちらも PO の mailbox に入らなかった**。`#4144` の Q1/Q2 が PO に届いたのは、QM が「`po-decision:required` の決裁が GitHub 上に存在しない」として merge を保留したからで、通知経路が機能した結果ではない。

### §3.1.1 遷移表 — **復路を含む全経路**（2026-07-31 追加）

§3.1 は「誰が付けるか / 次に誰が動くか」だけを定めており、**受け取った側が対応を終えたときに何に移すか（復路）が未定義だった**。その結果、Dev が `state:qm-blocked` の差し戻しに対応しても label が `qm-blocked` のまま残り、**QM の受信箱に戻らず、オーナーが手で伝えるまで停止した**（PR #4149 で実発生）。

**受け取った側は、対応を終えたら必ず次の state に移す。** 移し先は以下で固定する。

| 現在の state | 誰が | いつ | **次の state** |
|---|---|---|---|
| `state:needs-dev` | Dev | 実装完了・CI 全緑・Ready 化 | **`state:dev-done`** |
| `state:needs-dev` | Dev | 判断が要ると分かった | `state:needs-po` / `state:needs-owner` |
| `state:dev-done` | QM | レビューで BLOCK 3 類型に該当 | **`state:qm-blocked`** |
| `state:dev-done` | QM | approve | **`state:ready-to-merge`** |
| **`state:qm-blocked`** | **Dev** | **差し戻し対応が完了し CI 全緑** | **`state:dev-done`**（**復路。これが未定義だった**） |
| `state:ready-to-merge` | QM | merge 実行 | （close / label は残してよい） |
| `state:needs-po` | PO | 決裁をコメントとして残した | **次の担当の state**（`needs-dev` / `needs-audit` / `dev-done` 等） |
| `state:needs-owner` | オーナー / PO | 決裁をコメントとして残した | 同上 |
| `state:needs-audit` | 監査 | release cut 実施 or 見送り判断 | **`state:needs-po`**（見送りなら理由を添えて PO へ戻す） |
| `state:needs-platform` | Platform | 装置の削減 / 生成が完了し CI 全緑 | **`state:dev-done`**（QM レビューへ。**自分の PR を自分で approve しない** — ADR-0022） |
| `state:needs-platform` | Platform | **削除**（gate / guard / test）が必要と分かった | **`state:needs-owner`**（不可逆 4 操作） |
| `state:needs-platform` | Platform | gate を**残すか消すか**の方針判断が要る | **`state:needs-po`**（[README.md §4.5](README.md#45-装置開発基盤に関する決定)） |

**原則**: `state:*` は「**次に動く人**」を指す。自分が動き終わったら、その label は自分を指したままにしない。

> **判断待ちが 2 件以上ある場合**: 1 件目を解決して label を移すと、**2 件目が受信箱から消える**（#4145 の QM approve コメントで報告された orphan と同 class）。**未解決の判断が残っているなら label を移さない。** 移すのは「その受信箱に残る用件がゼロになったとき」だけ。

> **class-lock を今回は作らない理由**: 「label が状態を持つが遷移の網羅性が保証されていない」は同 class 2 回目（orphan / 復路未定義）であり、ADR-0061 原則 2 なら機械 guard の対象になる。ただし **ADR-0061 の適用対象限定**（検証装置・運用装置自身の不具合には適用しない — 装置の class-lock は「装置を守る装置」を生み無限後退する、#4123）に該当するため、**遷移表という定義で塞ぐ**。定義が安定して以降も同 class が再発するなら、そのとき guard 化を判断する。

### §3.1.2 mention とコメントは通知経路ではない

**`@mention` / Issue コメント / PR body に書いただけでは、相手の mailbox に入らない。** 各ロールは label を polling しており、本文を読みに行かない。

> **§2 原則 3「付けた側が意味に責任を持つ」の適用**: 自分のレーンから次のレーンへ渡すとき、**渡す側が label を付ける**。書いたかどうかではなく、**相手の polling クエリに出るかどうか**が伝達の成否を決める。

### §3.2 label で表さないもの（GitHub 標準を使う）

| 用途 | 使うもの | 理由 |
|---|---|---|
| **approve の依頼** | `gh pr edit <N> --add-reviewer <user>` | GitHub が reviewer request としてモデル化済。label で二重管理しない |
| 統合監査の**対象 PR** | `base:main head:release/*` の open PR | branch 名で判別できる。label 不要 |

> **release cut の依頼は `state:needs-audit` を使う（2026-07-31 改訂）**。当初は「PO → 監査への明示依頼」で label 不要としていたが、**mention / コメントは通知経路ではない**（§3.1.2）ため、Dev で起きたのと同じ取りこぼしが監査レーンでも成立する。cut を label で**自動起動させない**方針は維持する — `state:needs-audit` は「PO が cut を依頼した」という状態を表すだけで、cut の実行判断と不可逆 action は引き続き audit-manager 専権（[audit-team.md](audit-team.md) §3.3 / §3.8 step 6）。

> **例外運用**: gate 欠陥で Dev が PR を出せない場合に限り QM の Fix Agent が修理 PR を作る。その PR の approve は **Dev** が行う（ADR-0022 作成者 ≠ 承認者）。この受け渡しは **reviewer request** で行い、専用 label を作らない。

### §3.3 ロール別 polling 対象

各セッションは**起動時**と**定期**に、自分の mailbox を確認する。

| ロール | 拾うもの | コマンド |
|---|---|---|
| **Dev** | `state:needs-dev` / `state:qm-blocked` / 自分に来た reviewer request | `gh issue list --label "state:needs-dev" --state open` / `gh pr list --label "state:qm-blocked" --state open` / `gh pr list --search "review-requested:@me is:open"` |
| **QM** | `state:dev-done` / `state:ready-to-merge`（自分が merge） | `gh pr list --label "state:dev-done" --state open` |
| **PO** | `state:needs-po` / `state:needs-owner` | `gh issue list --label "state:needs-po" --state open` + `state:needs-owner` + PR 側も |
| **オーナー** | `state:needs-owner` | 同上 |
| **監査** | `state:needs-audit` / `release/* → main` の open PR | `gh issue list --label "state:needs-audit" --state open` / `gh pr list --base main --state open` |
| **Platform** | `state:needs-platform` | `gh issue list --label "state:needs-platform" --state open` / `gh pr list --label "state:needs-platform" --state open` |

**Issue と PR の両方を見る。** `gh pr list --label` は Issue を返さず、`gh issue list --label` は PR を返さない。片方だけ叩くと取りこぼす。

### §3.3.1 orphan 検出（どの mailbox にも入っていないものを見つける）

> **orphan の定義（2026-07-31 初回運用で精緻化）**: `state:*` が 1 つも付いていない open のうち、
> **`status:on-hold` も `epic` label も付いていないもの**。Draft PR は対象外（まだ誰にも渡していない状態）。
>
> **backlog を orphan にしない。** 着手順に入っていないものには `status:on-hold` を付ける
> （凍結・再開トリガー待ち・EPIC 傘下で着手順待ち を同一に扱う）。これをやらないと、
> **backlog 全件が orphan として毎回報告され、本当に浮いているものが埋もれる**（初回運用で
> orphan 16 件が出たが、実際に配るべきだったのは 2 件だけだった）。
>
> **EPIC 本体は orphan にしない。** EPIC は「傘」であって着手単位ではないため `epic` label で除外する。

label 運用の最大の失敗モードは「**誰の受信箱にも入っていない open 項目**」である。報告上は全員「mailbox 空」になり、**実際は複数件が止まっている**状態と区別がつかない。

各ロールの cron に以下を含める（PO は必須）。

```bash
# state:* が 1 つも付いていない open Issue / PR
gh issue list --state open --limit 100 --json number,title,labels \
  --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN ISSUE #\(.number) \(.title)"'
gh pr list --state open --limit 50 --json number,title,labels \
  --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN PR #\(.number) \(.title)"'
```

> **2026-07-31 の実例**: Dev / QM とも「対応事項なし」と報告した時点で、着手すべき Issue が 5 件（`#3950` / `#4087` / `#3970` / `#4117` / `#4139`）滞留していた。全件 `state:*` 未付与だったため、どの mailbox にも現れなかった。

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

gh issue list --label "state:needs-dev" --state open --json number,title --jq '.[]|"着手 #\(.number) \(.title)"'
gh pr list --label "state:needs-dev" --state open --json number,title --jq '.[]|"着手PR #\(.number) \(.title)"'
gh pr list --label "state:qm-blocked" --state open --json number,title --jq '.[]|"BLOCKED #\(.number) \(.title)"'
gh pr list --search "review-requested:@me is:open" --json number,title --jq '.[]|"REVIEW依頼 #\(.number) \(.title)"'
gh issue list --state open --limit 100 --json number,title,labels --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN #\(.number) \(.title)"'

- **判断を仰ぐときは `state:needs-po`（不可逆 4 操作以外）か `state:needs-owner`（4 操作）を必ず付ける。**
  mention / Issue コメント / PR body に書いただけでは PO の受信箱に入らない（§3.1.2）
- ORPHAN（state:* / status:on-hold / epic のいずれも付いていない open）が出たら、自分の担当かを判断し、担当なら state:needs-dev を
  付けて拾う。他ロールの担当なら該当 state を付けて渡す。**放置しない**

- state:qm-blocked があれば、BLOCK 事由（顧客に実害 / 証跡の真正性 / 不可逆 のどれか）を PR コメントから読み、
  症状ではなく事由に対処する。テストの赤は症状であって事由ではない。
  **対応が完了し CI が緑になったら state:qm-blocked を外して state:dev-done に戻す**（§3.1.1 復路）。
  戻さないと QM の受信箱に現れず、対応済みであることが誰にも伝わらない（PR #4149 で実発生）。
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

gh issue list --label "state:needs-po" --state open --json number,title --jq '.[]|"PO判断 #\(.number) \(.title)"'
gh pr list --label "state:needs-po" --state open --json number,title --jq '.[]|"PO判断PR #\(.number) \(.title)"'
gh issue list --label "state:needs-owner" --state open --json number,title --jq '.[]|"OWNER #\(.number) \(.title)"'
gh pr list --label "state:needs-owner" --state open --json number,title --jq '.[]|"OWNER PR #\(.number) \(.title)"'
gh pr list --label "state:ready-to-merge" --state open --json number,title,mergeStateStatus --jq '.[]|"READY #\(.number) [\(.mergeStateStatus)] \(.title)"'
gh issue list --state open --limit 100 --json number,title,labels --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN #\(.number) \(.title)"'
gh pr list --state open --limit 50 --json number,title,labels --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN PR #\(.number) \(.title)"'

- state:needs-owner は、不可逆 4 操作（削除 / 本番 deploy / 課金書込 / スキーマ変更）のどれに
  該当するかを 1 行で示し、判断材料（実 diff / 影響範囲）を添えてオーナーに提示する
- state:ready-to-merge は CI が実際に緑かを gh pr view で確認してから報告する。ラベルは実測を代替しない
- PO の決定は、指示を出した時点で該当 Issue / PR にコメントとして残す。セッション上の発言は証跡にならない
```

### 監査セッション用

```
監査 mailbox チェック。以下を実行して結果を簡潔に報告する（何も無ければ「統合対象なし」の 1 行でよい）:

gh issue list --label "state:needs-audit" --state open --json number,title --jq '.[]|"CUT依頼 #\(.number) \(.title)"'
gh pr list --label "state:needs-audit" --state open --json number,title --jq '.[]|"CUT依頼PR #\(.number) \(.title)"'
gh pr list --base main --state open --json number,title,headRefName --jq '.[]|"統合PR #\(.number) [\(.headRefName)] \(.title)"'
git fetch origin develop main -q && git rev-list --count origin/main..origin/develop

- base:main の open PR があれば audit-team.md §3.8 の 9 ステップに入る
- main..develop が 50 commits を超えていたら、バッチが育ちすぎている。PO に release cut を提案する
  （#3995 は凍結できないまま 4 日で実査不能になり棄却された）
- per-PR の AC は再判定しない（QM の領域、§3.4 二重判定回避）
```

### Platform セッション用

```
Platform mailbox チェック。以下を実行して結果を簡潔に報告する（何も無ければ「mailbox 空」の 1 行でよい）:

gh issue list --label "state:needs-platform" --state open --json number,title --jq '.[]|"着手 #\(.number) \(.title)"'
gh pr list --label "state:needs-platform" --state open --json number,title --jq '.[]|"着手PR #\(.number) \(.title)"'
gh pr list --label "state:qm-blocked" --state open --search "author:@me" --json number,title --jq '.[]|"BLOCKED #\(.number) \(.title)"'

- **顧客は Dev。成功指標は装置の本数でも CI の緑でもなく、Dev の手戻り**
  （QM の差し戻し件数 / pre-ready の落ち回数 / PR の往復回数）。README.md §3.4
- **新しい検査を足すときは、同じ PR で既存を 1 本以上減らす**（装置総数の ratchet）。
  「直す」より先に「消す」「生成する」が選べないかを検討する
- 完了して CI が緑になったら state:needs-platform を外して **state:dev-done** に付け替える
  （自分の PR を自分で approve しない、ADR-0022。§3.1.1 復路）
- **gate / guard / test の削除は自分で実行しない** → state:needs-owner（不可逆 4 操作）
- gate を残すか消すかの**方針**は自分で決めない → state:needs-po（README.md §4.5）
- 製品コードは実装しない（Dev の職掌）。release cut / deploy はしない（監査の職掌）
```

---

## §5 運用上の注意

| 注意 | 理由 |
|---|---|
| **label を付け替えるときは古い state を外す** | 2 つ付いていると「次に誰が動くか」が読めなくなる |
| **state を外すときは必ず次の state を付ける** | **どの `state:*` も付かない = すべての受信箱から消える。** 報告上は「mailbox 空」になり、滞留と区別がつかない。作業が本当に終わったなら close する。close しないなら次の担当を必ず指す |
| **判断を仰ぐときは必ず `needs-po` か `needs-owner` を付ける** | 「不可逆 4 操作に当たらないから label を付けない」は、判断が要らないという意味ではない。mention / コメントは通知経路ではない（§3.1.2） |
| **label は状態であって承認ではない** | `state:ready-to-merge` は「QM が approve した」記録であって、CI 緑の保証ではない |
| **cron の結果が空でも報告する** | 「mailbox 空」が出ないと、cron が動いているのか死んでいるのか分からない |
| **「mailbox 空」を「やることが無い」と読まない** | orphan（§3.3.1）を必ず併せて確認する。2026-07-31 に Dev / QM とも「対応事項なし」と報告した時点で 5 件が滞留していた |
| **「空」が 3 回連続したら生存確認する（§5.1）** | 全員の受信箱が同時に空になるのは、仕事が無いときではなく **渡す経路が壊れているとき**である方が多い |
| **cron を主線の割り込みにしない** | 拾ったものが数分で終わるなら差し込む。そうでなければ現在の主線を優先し、拾ったことだけ報告する |
| **セッション終了で cron は消える** | 次のセッション起動時にもう一度作る。§3.4 の制約を参照 |

### §5.1 「mailbox 空」が 3 回連続したときの生存確認（PO の義務）

受信箱が空であることは、**仕事が無いこと**ではなく**渡す経路が壊れていること**の兆候である方が多い。PO は「空」が **3 回連続**したら、次を実行して**誰かが実際に動いているか**を確認する。

```bash
# 1. orphan — どの受信箱にも入っていない open
gh issue list --state open --limit 100 --json number,title,labels \
  --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN #\(.number) \(.title)"'
gh pr list --state open --limit 50 --json number,title,labels \
  --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN PR #\(.number) \(.title)"'

# 2. 各ロールの受信箱に何件あるか（0 が並ぶこと自体が異常信号）
for l in needs-dev dev-done qm-blocked ready-to-merge needs-audit needs-po needs-owner; do
  printf "%s: " "$l"
  echo "issue=$(gh issue list --label "state:$l" --state open --json number --jq 'length') pr=$(gh pr list --label "state:$l" --state open --json number --jq 'length')"
done

# 3. 直近の活動（人が動いているか）
gh pr list --state merged --limit 5 --json number,mergedAt,title --jq '.[]|"\(.mergedAt[0:16]) #\(.number) \(.title[0:50])"'
git fetch origin -q && git rev-list --count origin/main..origin/develop

# 4. EPIC の着手状況（open な EPIC に対して in-flight が 0 でないか）
gh issue list --state open --label "priority:critical" --json number,title --jq '.[]|"#\(.number) \(.title[0:60])"'
```

**判定**:

- orphan が 1 件でもある → **渡す経路が壊れている。** 該当する `state:*` を付けて配る
- 全受信箱 0 かつ merged が数時間停止 → **セッションが落ちているか cron が消えている。** 各ロールに起動確認を求める
- 全受信箱 0 かつ merged は進んでいる → 正常。ただし **`main..develop` が育っていないか**を併せて見る

> **2026-07-31 の実例**: PO が「mailbox 空」を 4 回連続で報告したあと、Dev / QM 双方が「対応事項なし」と報告した。実際には着手すべき Issue が 5 件滞留し、Dev の判断待ち 2 件が PO に届いていなかった。**全員の受信箱が同時に空になったのは、経路が壊れていたから**である。

## §6 改訂履歴に代えて — 語彙が足りなかった実例

語彙を増やさない原則（§2-5）は維持するが、**渡す経路が存在しない状態は「語彙が足りている」ではない**。以下は 2026-07-31 の実運用 1 日で露見した 2 つの欠落。同種の欠落を疑うときの判断材料として残す。

| 欠落 | 何が起きたか | 追加した語彙 |
|---|---|---|
| PO / QM → Dev に**着手を渡す**経路が無い | Dev が拾えるのは QM の差し戻しと reviewer request だけだった。PO が着手順を決めても Dev の受信箱に入らず、**5 件が滞留**したまま Dev は「対応事項なし」と報告した | `state:needs-dev` |
| **不可逆 4 操作ではない PO 判断**を渡す経路が無い | Dev が「ruleset 変更」「node EBADENGINE」を判断待ちとして書いたが、4 操作に当たらず label を付けられなかった。**PO の mailbox に入らないまま PR が merge されて流れた** | `state:needs-po` |
| PO → 監査に**release cut を渡す**経路が無い | 「明示依頼で足りる」としていたが、mention / コメントは通知経路ではない。Dev で起きたのと同じ取りこぼしが監査レーンでも成立する | `state:needs-audit` |

**共通の教訓**: 語彙を増やさない原則（§2-5）は、**渡す経路が既にあるとき**にのみ有効。経路が無いまま「増やさない」を守ると、伝達が mention に退化し、mention は誰の受信箱にも入らない。

## §7 現状（2026-07-31 時点）

- label **7 種**（`needs-dev` / `dev-done` / `qm-blocked` / `ready-to-merge` / `needs-audit` / `needs-po` / `needs-owner`）
- PO セッションの cron は稼働中（`37 * * * *`）
- **恒久化（GitHub workflow → Discord）は未実施。** 実際に見落としが発生してから作る
