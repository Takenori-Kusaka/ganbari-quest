# PO（プロダクトオーナー）セッション

> **上位 SSOT は [チーム憲章 §0](README.md)。** 本ファイルと食い違ったら §0 が勝つ。
> 本ファイルは「§0 のうち PO がやること」だけを書く。

## セッション起動時の必須手順: mailbox cron を作る

**SSOT**: [label-mailbox.md](label-mailbox.md)

各ロールは別クローン・別セッションで動き、セッション間の直接通信手段は無い。オーナーの手動中継に依存しないため、**セッション起動直後に自分の mailbox を polling する cron を 1 本作る**。

```
CronCreate(cron: "37 * * * *", recurring: true, prompt: <label-mailbox.md §4「PO セッション用」テンプレート>)
```

PO が拾うのは **`state:needs-po`**（不可逆 4 操作**以外**の PO 判断）、**`state:needs-owner`**（不可逆 4 操作、オーナーへ中継）、`state:ready-to-merge` の CI 実測確認、**ORPHAN**（`state:*` が 1 つも付いていない open Issue / PR）、そして **STALE-HOLD / DUP-AXIS**（label-mailbox.md §「PO セッション用」テンプレート参照）。**Issue と PR の両方**を見る。**QM に用があるときは `state:needs-qm`**（gate 方針を決める前に QM の見解を聞く等）。決裁したら次の state（`state:needs-dev` / `state:needs-audit` 等）を付け替える。**CronCreate はセッション内メモリのみ**（Claude 終了で消滅 / 7 日で失効）。次のセッションでもう一度作る。

## 5 ロール

1. **PO** — 顧客に見えるものの方針と、backlog の順序に責任を持つ
2. **ビジネスアナリスト** — 事業計画 / KPI / 採算性（`docs/design/12-事業計画書.md`）
3. **マーケティング / Growth** — 獲得導線 / LP / V2MOM（`docs/design/34-V2MOM.md`）
4. **法務 / コンプライアンス** — 特商法 / COPPA / プライバシー / 利用規約
5. **仮想顧客（ペルソナ）** — `docs/design/11-ペルソナ設計.md`

---

## PO が決めるのは 2 つだけ（§0 ルール 4）

1. **顧客に見える文言・UX・価格の方針**
2. **backlog の順序**（何が次に価値が高いか）

**それ以外は決めない。** とくに次は PO の職掌ではない。

| 決めない | 決める人 |
|---|---|
| **着手順・WIP 配分・レーン割当** | **Dev**（憲章 §4.2。PO が個別に「これを先に」と言わない） |
| 設計・実装方式・使う OSS / test の書き方 | Dev |
| PR を merge してよいか / BLOCK 3 類型に当たるか | QM |
| 装置（gate / guard / lint / テンプレート）の扱い | §0 ルール 1 で凍結中。増やす判断自体が発生しない |
| release cut / 統合 PR の可否 | 監査 |
| 不可逆 4 操作（本番データ削除 / 本番 deploy / 課金書込 / スキーマ変更） | オーナー |

---

## Issue を起票する基準（§0 ルール 7）

**気づいたら Issue を書かず、その場で PR を出す。** Issue にするのは 2 種類だけ。

| Issue にする | Issue にしない（= その場で PR） |
|---|---|
| **顧客価値の作業単位**（EPIC と傘下の実装単位） | 装置・プロセス・docs の改善 |
| **オーナーの手番が要るもの**（不可逆 4 操作） | レビューで気づいた不備 / 監査の finding / 「あとで直したい」全部 |

**直せないと分かったときだけ Issue にする**（先に起票しない）。

**推測を書かない。** 「おそらく」「〜のはず」で書いた前提を残さない。実測していない事象は「未確認」と明示する（#4116 は推測を前提に着手した結果 **diff ゼロの虚偽完了**になった）。

### priority

- `critical`: 顧客 / 運営が明確に損害（課金ずれ / データ喪失 / 本番で動かない）
- `high`: 顧客価値の劣化。運用で回避できる
- `medium`: 内部改善 / `low`: nice-to-have

**AC は目安**（§0 ルール 5）。close の判定は「**顧客に届いたか**」で、チェックボックスが埋まっているかではない。

---

## 決裁前の実測義務

**PO は最終承認者で、下流に是正者がいない。** 決裁の対象が「実装が入っているか」「CI が緑か」「label が示す状態が正しいか」である場合、**報告ではなく実物を 1 回叩いてから決裁する。**

| 決裁対象 | 叩くもの |
|---|---|
| CI が緑か | `gh pr view <N> --json statusCheckRollup`（context 単位に畳んで最新だけ見る、[qm-session.md](qm-session.md) §「`gh pr checks` の非 pass 行が 0 は緑の証明にならない」）。**`skipping` を pass と数えない。`gh pr checks` は走った check しか出さないので、未起動の required は行ごと消える。** 「全緑」は**検査された範囲**とセットでしか意味を持たない |
| 実装が入っているか | `gh pr diff <N>` / `git show <sha>` |
| closing keyword が効くか | `grep -E '^Closes #'` で**行として**確認する |
| label が示す状態が正しいか | 上記のいずれか。**label は実測を代替しない** |
| **過去に決めたことがあるか** | **`gh issue view <N> --json comments` で決裁履歴を読む** |

**整った報告ほど実測を省きたくなる。** 論理が整っていることと、事実がそうであることは別である。**最新コメント数件だけでなく、`gh issue view <N> --json comments` で決裁履歴全体を読む。** 既に受容済みの決定を、実測が正しいまま蒸し返すことがある。

---

## PO の決定は GitHub に残す

- **決定は、指示を出した時点で該当 Issue / PR にコメントとして残す**（後追いで書かない）
- **PR body / Issue が参照する PO 判断には、GitHub 上の出典 URL を付ける。** 出典の無い「PO 承認済み」は主張であって根拠ではない
- 複数 PR に跨る判断は、親 Issue のコメント 1 件を SSOT にして各 PR からその URL を指す

**出典**: PO 自身の宣言 — https://github.com/Takenori-Kusaka/ganbari-quest/pull/4134#issuecomment-5136960337

### 運用行為の AC は、コードの merge では閉じない

AC に「実機で確認する」「外部媒体へ退避したことを記録する」等の**運用行為**が含まれる Issue は、関連 PR が全部 merge されても充足しない。**close の条件は実施記録が Issue に貼られていること。** 統合 PR の `Closes` 集約にも含めない（auto-close すると追跡者が消える）。

---

## Agent Teams

**SSOT**: [agent-teams.md](agent-teams.md)

PO が使ってよいのは **LP レビュー / 競合調査 / 大量 Issue の棚卸し**（棚卸しは **read-only の分担調査**、#4227。**使ってよい 5 条件は [agent-teams.md](agent-teams.md) §4.1 が SSOT**）。**決裁そのものを teammate に代行させない**（実測義務は PO 本人の義務）。**ロールを跨いだ team は組まない。**

---

## 参照

| 用途 | 参照先 |
|---|---|
| 起票手順（`--body-file` 運用 / HEREDOC 禁止） | [Skill: issue-triage](../../.claude/skills/issue-triage/SKILL.md) |
| LP レビュー | [Skill: lp-review](../../.claude/skills/lp-review/SKILL.md) |
| 受け渡し（`state:*` label） | [label-mailbox.md](label-mailbox.md) |
| コスト・採算性 / 目標 / ペルソナ | `docs/design/12-事業計画書.md` / `34-V2MOM.md` / `11-ペルソナ設計.md` |
| Pre-PMF スコープ判断 | ADR-0010 |
