# M2 論理モデル レビュー Round 1 応答台帳

> **対象**: `docs/design/dsql/m2-logical-model.md`（初版）。**レビュー**: 3 独立観点（正規化 / キー戦略 / 敵対 skeptic）。**判定**: 全観点 FAIL（[must] 5 件 = 局所修正 3 + 写像漏れ 2）だが M1 より遥かにクリーン。**DBMS 非依存は PASS**。
>
> **本 Round の性質**: 局所的な正規化欠陥（推移従属 1 / 導出値格納 1 / 非最小キー 1）＋ M1 entity の写像漏れ 2（I-CHILD-USER FK / FixedIntervalReward）。構造転換や集約再設計は不要。全 [must] を rework 反映済、[should] も全反映。
>
> **記法**: finding → 対応（何を変えたか）→ 反映箇所（m2-logical-model.md の §）。

---

## [must]（3 観点統合、全 5 件解消）

| # | 観点 | finding | 対応 | 反映箇所 |
|---|---|---|---|---|
| **1** | 正規化 | **R-PLAN の推移従属** `プランコード → プラン層 → 猶予日数`（3NF 違反） | R-PLAN を `{プランコード → プラン層}` に縮小し、**R-PLAN_TIER `{プラン層(PK) → 猶予日数}` を新設分解**。SUBSCRIPTION_STATE/ACCOUNT_LIFECYCLE は R-PLAN→R-PLAN_TIER 経由で猶予日数へ到達。代替（猶予日数を課金 scope として M3 送り）も明記し、I-LIFECYCLE grounding のため分解を採用 | §1.10 R-PLAN / R-PLAN_TIER / §2.1 推移従属 / §2.3 グローバル参照 / §3.1 自然単一キー表 / §5.1 グローバル行 |
| **2** | 正規化 [must] + skeptic [should] | **R-CHILD の年齢帯モード格納導出値**: 非固定時 `生年月日 → 年齢帯モード` の導出 FD が残り L-10 年齢と同型の stale-on-birthday anomaly | 列を **`手動固定年齢帯`（nullable、手動固定時のみ非 NULL＝固定フラグ兼用）** に改名。実効年齢帯は D-AGE で導出（固定値が非 NULL なら権威、NULL なら導出）。§2.1 で「制御された派生冗長」分類＋**「全リレーション 3NF」の全称を「3NF（明示した制御冗長を除く）」に緩和** | §1.2 R-CHILD / §2.1 冒頭・推移従属・制御冗長 |
| **3** | キー戦略 | **R-DAILY_MISSION の非最小候補キー** `{子供,対象日,活動}`: per-child ゆえ `活動 → 子供` で `{対象日,活動}` が既に superkey | **最小候補キーを `{対象日,活動}` に是正**、`子供` を活動由来の冗長 prime として開示。`活動 → 子供` FD と「**3NF だが BCNF でない**（子供は冗長 prime）」を明示（R-STAMP_ENTRY の N-4 開示と同水準） | §1.3 R-DAILY_MISSION / §2.1 非 BCNF 開示 / §3.1 自然複合キー表 / §5.3 I-MISSION |
| **4** | skeptic | **I-CHILD-USER の写像漏れ + phantom mapping**: M1 `CHILD \|o--o\| MEMBERSHIP`（role=child, 0..1:0..1）を担う FK が不在なのに §5.3 が実在しない `R-CHILD.linked` を指す | **R-MEMBERSHIP に `対象子供: 参照<CHILD>?`（role=child 行のみ・UNIQUE 候補キー）を追加**して 0..1:0..1 を一意 FK で写像。§5.2 に当該関係行を追加、§5.3 の phantom を実在属性名（R-MEMBERSHIP.対象子供）に是正 | §1.1 R-MEMBERSHIP / §5.2 新行 / §5.3 I-CHILD-USER |
| **5** | skeptic | **FixedIntervalReward の silent drop**: M1 §4.2 が Child 衛星集約として明記だが M2 全文に不在 | **§6 に U-8 を追加**（発行間隔 N・last-issued カウンタ/冪等キーの置き場所。M1 は集約と呼ぶが §3 ER 未構造化ゆえ勝手に作らず board 判断＝U-5 と同型）。構造を発明せず存在のみ明示（no-silent-gap） | §6 U-8 |

---

## [should]（全反映）

| # | finding | 対応 | 反映箇所 |
|---|---|---|---|
| S-1 | R-ENEMY_COLLECTION.討伐回数/初討伐日時 を導出分類（mastery と対称、可変集約で captured 免罪符が効かない） | **§4 D-ENEMY 新設**（daily_battle 勝利行の count/min）。属性を導出注記化し update anomaly ゆえ導出が正と明示 | §1.6 R-ENEMY_COLLECTION / §4 D-ENEMY |
| S-2 | R-LOYALTY_STATE.記念チケット数 の派生整合ギャップ（第 2 通貨に台帳なし＝I-DERIVED 普遍則の唯一の穴） | **U-2 を「未決」から「派生整合ギャップ」に格上げ**し board 判断を促す。§4 D-LOYALTY 注も同旨に更新 | §6 U-2 / §4 D-LOYALTY 注 |
| S-3 | R-MEMBERSHIP の CK 根拠明記 | 「Q-07=A 下の最小候補キーは `{利用者}`、`{家族,利用者}` は将来 M:N 反転の連関安定性のため採る非最小 superkey」と根拠明記 | §1.1 R-MEMBERSHIP PK 選択の根拠 |
| S-4 | 家族境界一致述語を一律 [C] にせず条件分岐で明示 | §5.3 の I-CHEER/I-MSG-SENDER/I-MEDIA-EXT を「**[C](family 非正規化前提=U-6 で複合 FK 化可) / でなければ [M3]**」に是正 | §5.3 I-CHEER/I-MSG-SENDER/I-MEDIA-EXT |
| S-5 | R-CHECKLIST_LOG に複合 FK `{子供,テンプレート}→R-CHECKLIST_ASSIGNMENT` を張り I-CHECKLIST 配信済前提を [R] に格上げ | R-CHECKLIST_LOG に複合 FK 追加、§5.3 I-CHECKLIST を [C] 述語から **[R] 参照整合**に格上げ | §1.6 R-CHECKLIST_LOG / §5.2 新行 / §5.3 I-CHECKLIST |
| S-6 | R-CHECKLIST_ITEM_RESULT に `対象項目.テンプレート = 進捗.テンプレート` の行間整合述語 | 行間整合述語を追加（別テンプレ項目の誤紐付け排除、[C]） | §1.6 R-CHECKLIST_ITEM_RESULT |
| S-7 | §5.2 に R-STATUS→AGE_BENCHMARK は導出参照（年齢は導出属性）である旨明記 | §5.2 の該当行を「格納 FK でなく導出参照（実効年齢での M3 lookup）」に是正 | §5.2 R-STATUS→R-AGE_BENCHMARK 行 |
| S-8 | R-AGE_BENCHMARK の CK 既定を M1 文字通りの `{年齢}` に戻す（カテゴリ入りは U-1 候補に留める） | 属性からカテゴリを外し CK を `{年齢}` に是正。カテゴリ別は U-1 候補に留め既定に焼き込まない（勝手に足さない原則） | §1.10 R-AGE_BENCHMARK / §3.1 / §6 U-1 |

---

## 全称断言の再点検（M1 の教訓）

- **「全リレーション 3NF」の全称を撤回**（[must]2 対応）。§2.1 冒頭に「全称を張らない」注を置き、3NF は「明示した制御冗長を除く」、一部は「3NF だが BCNF でない（FD と決定項を開示）」と例外を列挙・述語で定義した。
- 「全/悉皆/網羅」型の断言が本文に残っていないことを確認（トレーサビリティ §5.1 は「漏れなく写像」を entity 列挙で示し、悉皆断言でなく個別対応で担保）。

## DBMS 非依存の再確認
Round 1 の全対応は論理レベル（relation 分解 / 候補キー是正 / FK 追加 / 導出分類 / 述語分類）に閉じ、物理語（物理型・PK 凍結形式・索引・materialize・CHECK 構文）を新規導入していない。§7 の遵守確認は有効なまま。

---

## 関連
- `docs/design/dsql/m2-logical-model.md` — 本台帳の対象（rework 反映済）
- `docs/design/dsql/m1-conceptual-model.md` — M1（写像元・[must]4/5 の根拠）
- `docs/design/dsql/detailed-design-process.md` §M2 — 決裁条件
