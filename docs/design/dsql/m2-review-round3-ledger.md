# M2 論理モデル レビュー Round 3 応答台帳

> **対象**: `docs/design/dsql/m2-logical-model.md`（Round 2 rework 後）。**レビュー**: 3 独立観点（正規化 / キー戦略 / 敵対 skeptic）。**判定**: キー戦略・正規化 PASS、skeptic が [must] 1 件（3 観点が同一箇所に収束、skeptic のみ M3 巻き戻しリスクで [must] 格上げ）。**構造は 3 観点とも健全確認済み**。残るは散文残渣 1 箇所の掃除のみでゲート成立。
>
> **本 Round の性質**: Round 2 の BCNF 是正（R-DAILY_MISSION の `子供` 属性削除）に伴う**散文残渣の掃除**。構造変更なし。本掃除で [must] ゼロ、M2 収束。
>
> **記法**: finding → 対応 → 反映箇所。

---

## [must]（散文残渣、1 箇所）

| # | finding | 対応 | 反映箇所 |
|---|---|---|---|
| **1** | **§3.2 の家族境界述語の例に `R-DAILY_MISSION.活動 の所有子供＝本行子供` が生存**（Round 2 で `子供` 属性削除により自明化・不要化済＝§1.3 が明記なのに §3.2 の例として残る自己矛盾）。放置すると M3 実装者が `本行子供` 列 + CHECK を復活させ **BCNF 是正が巻き戻る** | §3.2 の例から R-DAILY_MISSION を**削除**し、「Round 2 で子供＝活動経由導出化ゆえ本述語は自明・不要、復活させると BCNF 是正が巻き戻るため置かない」旨を明記。他 3 例（PARENT_MESSAGE/SIBLING_CHEER/CHECKLIST_ASSIGNMENT）は該当属性が実在するため維持。**`本行子供`/`活動所有子供` を全 grep** し、残る 2 箇所（L195 是正記録＝正当／L561 I-LOG＝[should] で是正）以外に生存なしを確認 | §3.2 家族境界一致の論理制約 |

---

## [should]（同型の整合、反映）

| # | finding | 対応 | 反映箇所 |
|---|---|---|---|
| S-1 | §5.3 I-LOG の `[C] 記録子供＝活動所有子供` を「自明」と再分類（DAILY_MISSION で「述語不要」と正しく書けているのに同型の I-LOG が [C] のまま残る不整合） | I-LOG を「[R] 活動 FK（記録子供＝活動所有子供は**自明**: 子供は活動経由導出で R-ACTIVITY_LOG は記録子供属性を持たない。R-DAILY_MISSION と同型）」に再分類。[C] 述語を撤去 | §5.3 I-LOG |

---

## [note]（表記統一、反映）

| # | finding | 対応 | 反映箇所 |
|---|---|---|---|
| N-1 | §4 D-MISSION-DONE の定義タプル `（子供,日,活動）` を `（対象日,活動）` に寄せる（子供は導出ゆえ実害なし、表記統一） | `（対象日,活動）` に是正（子供は活動経由導出の旨を併記） | §4 D-MISSION-DONE |

---

## grep 整合の確認（1 箇所残しを断つ）
`本行子供` / `活動所有子供` の全 grep 結果 3 箇所の帰属:
- L195 R-DAILY_MISSION 正規形注 — Round 2 是正記録（「活動所有子供が自明化」＝正当な履歴記述、維持）
- L478 §3.2 家族境界述語例 — **本 Round [must] で R-DAILY_MISSION を除外**（是正済）
- L561 §5.3 I-LOG — **本 Round [should] で「自明」に再分類**（[C] 撤去済）

→ BCNF 是正を巻き戻す残渣は根絶。

## 全称断言・DBMS 非依存の再確認
- 全称断言なし（例の除外・自明化の明記のみ、悉皆断言を足さない）。
- DBMS 非依存維持（散文掃除のみ、物理語の新規導入ゼロ。grep: 物理語は §0/§7 の M3 委譲宣言のみ）。

---

## 関連
- `docs/design/dsql/m2-logical-model.md` — 本台帳の対象（Round 3 掃除反映済）
- `docs/design/dsql/m2-review-round2-ledger.md` — Round 2 応答台帳（BCNF 是正＝本 Round 残渣の発生源）
- `docs/design/dsql/m1-conceptual-model.md` — M1（写像元）
