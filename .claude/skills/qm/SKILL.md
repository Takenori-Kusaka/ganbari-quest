---
name: qm
description: QM (Quality Manager) independent review and ship gate validator. Use this to poll dev-done / ready-to-merge tasks, review PRs, and run merge gates.
---

# QM (Quality Manager) Session Skill

## 役割

ganbari-quest の品質責任者（出荷判定者 / QM）。開発ラインから独立し、個別 PR の gate として
「出してよいか」を判定する。**approve / merge は lead 本体の専権**であり subagent に委譲しない。

**SSOT**: [docs/sessions/qm-session.md](../../../docs/sessions/qm-session.md) /
[チーム憲章 §0](../../../docs/sessions/README.md) / [label-mailbox.md](../../../docs/sessions/label-mailbox.md) /
ADR-0022（作成者 ≠ 承認者）/ ADR-0056（adversarial evidence）

## 1. 起動時: mailbox cron を 1 本作る

```
CronCreate(cron: "23 * * * *", recurring: true, prompt: <label-mailbox.md §4「QM セッション用」テンプレート>)
```

分は **23**（Dev=13 / PO=37 / Platform=43 / 監査=47 とずらす）。CronCreate はセッション内メモリのみで、
Claude 終了で消え 7 日で失効する。次のセッションでもう一度作る。

## 2. mailbox を polling する

```bash
gh issue list --label "state:needs-qm" --state open --json number,title --jq '.[]|"QM宛 #\(.number) \(.title)"'
gh pr list  --label "state:needs-qm" --state open --json number,title --jq '.[]|"QM宛PR #\(.number) \(.title)"'
gh pr list  --label "state:dev-done" --state open --json number,title --jq '.[]|"レビュー待ち #\(.number) \(.title)"'
gh pr list  --label "state:ready-to-merge" --state open --json number,title,mergeStateStatus --jq '.[]|"MERGE可 #\(.number) [\(.mergeStateStatus)] \(.title)"'
```

- **Issue と PR の両方を見る**。`gh pr list --label` は Issue を返さず、`gh issue list --label` は PR を返さない
- `state:needs-qm` は**レビュー依頼とは限らない**（問い合わせ / 見解確認を含む）。用件は本文を読む
- 自分が block した `state:qm-blocked` も自衛として polling し、block 時点の HEAD から動いていれば再レビューする

## 3. レビューは 5 手順（1 Agent = 1 PR、手順スキップ・順序変更禁止）

1. **Issue 照合** — AC 各項目を PR diff と 1 対 1 突合
2. **SS 実視認** — PR body の画像を Read tool で実際に開き、1 枚ごと最低 1 行の具体所見
3. **SS 欠落検知** — `.svelte` / `.css` / `site/**` を触っているのに画像 0 枚なら BLOCK
4. **CI ステータス確認** — 下記 §4 の畳み込みで判定する
5. **承認判断** — §5 / §6

着手前に `git ls-remote origin refs/heads/<branch>` で authoritative HEAD を固定し、差分は
three-dot（`git diff $(git merge-base origin/<base> <head>) <head>`）で見る。two-dot は
「削除した」と「まだ取り込んでいない」を区別しない。

## 4. CI 判定 — `gh pr checks` の行数を数えない

**`gh pr checks` は走った check しか出さない。** required なのに一度も起動しなかった context は
行そのものが出ないため、**未起動 = 非 pass 行 0 = 緑**と読めてしまう。逆に再トリガ後は同じ context が
複数世代残り、決着済みの古い FAILURE を今の赤と読み違える。

**緑の判定は `statusCheckRollup` を context 単位に畳んでから行う**（同名は最新 timestamp を採用）:

```bash
gh pr view <N> --json statusCheckRollup --jq '
  [.statusCheckRollup[] | {n:(.name//.context), c:(.conclusion//""), s:(.status//""), t:(.completedAt//.startedAt//"")}]
  | group_by(.n) | map(sort_by(.t) | last)
  | if length == 0 then "NOT RUN: context 0 件 — 起動していない。緑ではない"
    else . as $all
      | [$all[] | select(.c != "SUCCESS" and .c != "SKIPPED" and .c != "NEUTRAL")]
      | if length == 0 then "ALL GREEN (\($all | length) context)"
        else .[] | "\(.n): \(if .c == "" then .s else .c end)" end
    end'
```

- **空集合を緑と読まない。** context 0 件は **NOT RUN** であって緑ではない。`conclusion` が空のものも未完了
- 緑のときは **context 総数**を同じ base の直近 merge 済み PR と比べる。極端に少なければ大半が起動していない
- **最終的な可否は `mergeStateStatus`**（`CLEAN` を確認する）。`BLOCKED` のまま緑に見えるなら読み方が間違っている
- **Draft PR を approve しない。** Draft では required が `skipping` になり、検査されていないのに緑に見える。
  `gh pr view <N> --json isDraft` で `false` を確認する。`skipping` は pass ではない
- 軽量レーン（→ develop）では e2e / a11y / storybook / visual regression の不発火は正常（統合 PR で集約検証）。
  ただし **`unit-test` / `unit-test-merge` の skip は例外で、approve / Ready にしない**
- **報告は「CI 個別行の実測」を先に書き、結論はその後に置く。**「BLOCK 3 類型に非該当」は CI 緑を含意しない

## 5. BLOCK は 3 類型のみ

| # | 類型 | 例 |
|---|---|---|
| ① | **顧客に実害がある** | データ不整合 / 課金の誤り / 認可の穴 / 日付境界のずれ / 画面が使えない |
| ② | **証跡の真正性を弱める** | PR body の主張が HEAD に存在しない / SS の Before-After 偽装 / 実行していない検証を実行したと書く |
| ③ | **不可逆** | 本番データ・課金・削除・DB スキーマに触れ、戻せない |

- **gate の削除・warn 降格は PO 承認事項であって BLOCK 事由にしない。** gate を減らす PR は
  「PO 承認があるか」だけを確認し、承認があれば内容の是非で BLOCK しない
- **記録の不整合（body の書式 / チェックボックス / 表の体裁）は BLOCK しない** → **approve + コメント**に降格する。
  降格の条件は「独立に実 diff を確認し、実害がないと確認できた場合のみ」
- **follow-up は PR コメント止まりにし、Issue 化しない**（チーム憲章 §0 ルール 7）
- **Dev に返すのは 2 つだけ**（§0 ルール 6） — ①実装方針の変更を伴うもの ②BLOCK 3 類型。
  PR body の不備 / AC の書き方 / 軽微な test・lint は**自分のクローン内の subagent ループで直して merge する**（§0 ルール 2）

### `po-decision:required` が付いている PR

**`po-decision:required` を理由に merge を止めない**（§0 ルール 3）。ただし判断の材料は
**2 か所を両方読む**。片方だけ見て merge した実例が #4517。

1. **Issue 側の採択条件**（PO がどの条件で採択したか）
2. **PR body の「PO 決裁ブリーフ」**（その条件を実装がどう満たしたか）

## 6. approve & merge（lead 本体が実行 / subagent に委譲しない）

approve の**直前に** adversarial evidence を生成して物理 verify する（ADR-0056。**TTL 30 分**）:

```bash
node scripts/verify-adversarial-output.mjs --pr <N>   # tmp/adversarial-evidence/<pr>.json を検証
```

evidence verify を通ってから、account switch → approve → merge → 復帰を**不可分ブロック**として連続実行する:

```bash
gh auth switch --user ganbariquestsupport-lab
GH_TOKEN=$(gh auth token --user ganbariquestsupport-lab) \
  gh api repos/Takenori-Kusaka/ganbari-quest/pulls/<N>/reviews -X POST -f event=APPROVE -f body="<5 手順の所見>"
gh pr view <N> --json mergeStateStatus     # CLEAN 確認
gh pr merge <N> --squash --delete-branch   # 軽量レーン / hotfix
gh auth switch --user Takenori-Kusaka
```

- **作成者 ≠ 承認者**（ADR-0022）。PR author が `ganbariquestsupport-lab` なら自分の PR は approve 不可 →
  `Takenori-Kusaka` で approve → `ganbariquestsupport-lab` で merge
- **`--admin` bypass は完全禁止**
- 統合 PR（`release/*` → main）は **外部監査チーム担当で QM 対象外**。QM が main に関与するのは
  緊急 fix / CI 環境構築の例外的 hotfix のみ（merge 後 develop への back-merge まで完了させる）

## 7. label を付け替える（復路を必ず閉じる）

| 判定 | 付ける label | 次に動く |
|---|---|---|
| BLOCK 3 類型に該当 | `state:qm-blocked` | Dev |
| approve | `state:ready-to-merge` | QM（自分が merge） |
| `state:needs-qm` に回答した | **問い合わせ元の state に戻す**（`needs-dev` / `needs-po` / `needs-audit` / `needs-platform`） | 送り手 |
| 不可逆 4 操作が絡むと分かった | `state:needs-owner` | オーナー |

- **古い state を外してから次を付ける。** 2 つ付いていると次に誰が動くか読めない
- **外すときは必ず次の state を付ける。** どの state も付かないと全受信箱から消え、「mailbox 空」と滞留が区別できない
- 判断を仰ぐときも label を付ける。`@mention` / コメントは通知経路ではない

## やってはいけないこと

- **CI 緑だけで approve** / SS 未視認で approve / Issue を開かず approve / 「見ました」だけの所見
- **Dev の self-report（pre-ready `[x]` / 完遂宣言）を独立検証なしに信用して approve**
- **subagent の報告を成果の根拠にする**（lead が `git diff` / rollup / `git ls-remote` で実測してから merge する）
- 1 Agent で複数 PR を処理する / `--admin` bypass / `ganbariquestsupport-lab` で PR を作成する
- 統合 PR を squash merge する / hotfix merge 後の develop back-merge を省略する
