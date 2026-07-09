# M2 論理モデル レビュー Round 2 応答台帳

> **対象**: `docs/design/dsql/m2-logical-model.md`（Round 1 rework 後）。**レビュー**: 3 独立観点（正規化 / キー戦略 / 敵対 skeptic）。**判定**: キー戦略 PASS、正規化 + skeptic が独立に同一 [must] を捕捉。M1 fidelity・DBMS 非依存は両観点 PASS（Round 1 の写像漏れ 2 件も閉じたと確認）。
>
> **本 Round の性質**: Round 1 の私（moderator）→builder のキー修正が生んだ**正規形の誤分類 1 件**の是正のみ。構造転換なし。これで収束見込み。
>
> **記法**: finding → 対応 → 反映箇所。

---

## [must]（正規化 + skeptic 収束、1 件）

| # | finding | 厳密な根拠 | 対応 | 反映箇所 |
|---|---|---|---|---|
| **1** | **R-DAILY_MISSION は「3NF だが非 BCNF」でなく実際は 3NF 違反**（Round 1 の誤分類） | FD 閉包: 唯一の候補キーは `{対象日,活動}`（`{子供,対象日}` は活動を決定せず超キーでない）→ `子供` は**非 prime**。`活動→子供` は「非超キー `活動` → 非 prime `子供`」＝**3NF 定義違反（非 prime 推移従属）**。「子供＝冗長 prime／R-STAMP_ENTRY と同水準」の framing は誤り（R-STAMP_ENTRY は両決定項が候補キー＝真正 BCNF で別次元） | **正規化は M2 の責務ゆえ M3 送りにせず是正**: R-DAILY_MISSION から **`子供` 属性 + `子供→R-CHILD` FK を削除**し `活動→R-CHILD_ACTIVITY.子供` で導出。→ 唯一候補キー `{対象日,活動}` の **BCNF**。R-ACTIVITY_LOG が既に子供を持たず活動経由参照するのと整合（モデル内不整合も解消）。§1.3/§2.1/§3.1/§5.3 の「3NF だが非 BCNF／冗長 prime／R-STAMP_ENTRY 同水準」記述を撤回。L193「活動所有子供＝本行子供」述語も子供導出化で自明化し削除 | §1.3 R-DAILY_MISSION / §2.1 冒頭注・BCNF 是正 bullet・見出し / §3.1 自然複合キー表 / §5.3 I-MISSION |

---

## [should]（3 観点で収束、全反映）

| # | finding | 対応 | 反映箇所 |
|---|---|---|---|
| S-1 | R-MEMBERSHIP.対象子供 は nullable ゆえ「候補キー」でなく**条件付き一意制約（filtered unique、role=child 部分集合上）** | §1.1 の「別 UNIQUE 候補キー」を「条件付き一意制約（filtered unique）」に是正（0..1:0..1 写像自体は正しい）。§5.3 I-CHILD-USER も [K]→[R]/[C] + filtered unique に是正 | §1.1 R-MEMBERSHIP / §5.3 I-CHILD-USER |
| S-2 | R-ACCOUNT_LIFECYCLE.猶予プラン層 の FK 先を R-PLAN_TIER に一意確定（[must]1 で猶予日数を R-PLAN_TIER へ外出し、属性名「層＝tier」とも整合） | `参照<PLAN>` を `参照<PLAN_TIER>` に、FK 先も R-PLAN_TIER に是正（M3 送りの曖昧を残さない） | §1.1 R-ACCOUNT_LIFECYCLE |
| S-3 | §2.3 集約表 + §5.1 trace に「FixedIntervalReward → U-8（構造保留）」の明示ポインタ（M1 命名集約 1 件を無注記で欠くと exhaustive 誤読で no-silent-gap が緩む） | §2.3 Child 衛星行に FixedIntervalReward→U-8 注記、§5.1 に明示ポインタ行を追加（発行結果は R-SPECIAL_REWARD として現れる旨も） | §2.3 Child 衛星行 / §5.1 |
| S-4 | §5.2 FK trace に `USER→CONSENT(同意本人)` 行を追加、`EMAIL_LOGIN_LOCKOUT` は FK でなく email 値一致で表現する旨を明記（トレーサビリティの穴） | §5.2 に 2 行追加（CONSENT_RECORD.同意本人 の FK / EMAIL_LOGIN_LOCKOUT は email 値一致で FK を張らない旨） | §5.2 |
| S-5 | U-7 の `由来参照: 参照<弱・任意>` は §0 の `参照<R>`（単一 R 名指し）に非適合ゆえ、既定 (a) は well-formed でなく (b) 由来種別+識別子案が sound | U-7 に「(a) は §0 上 well-formed でない（多態を単一 FK で表せない）→ (b) が sound、論理型健全性では (b) を推す」と追記 | §6 U-7 |

---

## 全称断言・正規化責務の再点検
- **正規化を M3 送りにしない**: [must]1 は「物理判断」でなく論理正規形の誤分類ゆえ M2 で BCNF に是正した（M3 に先送りしていない）。
- **全称断言をしない**: §2.1 冒頭を「BCNF 逸脱候補は Round 2 で是正」に更新、見出しからも「非 BCNF 例外開示」を撤去（もはや非 BCNF リレーションが無い）。悉皆断言を残さない。

## DBMS 非依存の再確認
Round 2 の全対応は論理レベル（属性削除による BCNF 化 / FK 先の一意確定 / 一意制約の呼称是正 / trace 補完 / 論理型健全性注記）に閉じ、物理語を新規導入していない（grep: 物理語 2 箇所は §0/§7 の M3 委譲宣言のみ）。§7 の遵守確認は有効。

---

## 関連
- `docs/design/dsql/m2-logical-model.md` — 本台帳の対象（Round 2 rework 反映済）
- `docs/design/dsql/m2-review-round1-ledger.md` — Round 1 応答台帳（[must]3 の当初対応＝本 Round で是正）
- `docs/design/dsql/m1-conceptual-model.md` — M1（写像元）
