# M1 概念モデル Round 5 レビュー 応答台帳

> **目的**: M1 レビュー Round 5 board（ドメイン・データアーキ PASS、skeptic が [must] 1 件発見・オーケストレーターがコードで裁定＝skeptic 正）の finding を 1:1 トレースする。
> **対象成果物**: `docs/design/dsql/m1-conceptual-model.md`（Round 5 rework）。
> **性質**: 本 fix は **Round 4 で導入された過剰な全称（false universal）の訂正**。バトル報酬が反例。
> **凡例**: 反映箇所は §番号 / I番号。

---

## 1. [must]（バトル報酬 = 非経済の内部値、RECON の全称が偽）

**裁定根拠（実装確認）**: `battle-service.ts` に `insertPointEntry`/`point_ledger` 書込は皆無。`rewardPoints`（勝=dropPoints / 負=consolationPoints）は `dailyBattles` 行にのみ格納され、残高（=SUM(point_ledger)）に一切入らない。§3.3 付与代表例にも `battle` は無い。→ Round 4 の I-SATELLITE-RECON (b)「点数観測値を持つ衛星付与は全て基幹付与」は**偽**（バトルが反例：観測値を持つが台帳付与でない）。

| # | 指摘 | 対応内容 | 反映箇所 |
|---|---|---|---|
| 1 | DAILY_BATTLE の報酬を「バトル内部の演出値（勝敗で決まる・台帳付与でない・残高に入らない）」と明記。混同回避のため概念名を point 経済と紛れない語に | mermaid の `報酬ポイント` を **`戦果値`** に改名し「バトル内部の演出値・台帳付与でない・残高に入らない」を注記。§3.4 バトル bullet に「戦果値は PointLedger 付与でない・非経済の内部値（実装確認: バトルは台帳へ書かない）」を追記、`報酬ポイント` の語を避ける | §3.4 mermaid DAILY_BATTLE / §3.4 バトル bullet |
| 2 | I-SATELLITE-RECON の全称を訂正（false universal 除去）: 「台帳エントリを生む衛星観測値のみ reconcile 対象で基幹 exactly-once、台帳エントリを生まない値（バトル戦果値・streak 計数）は RECON scope 外」と精密化。scope 外を明示列挙 | I-SATELLITE-RECON を **scope 分類版**に更新: reconcile 対象 = 台帳エントリを生む経済的付与の総額観測値のみ（基幹 exactly-once に対応）。**RECON scope 外を明示列挙** = (i) バトル戦果値（非経済内部値）(ii) streak 日数計数（不変）(iii) I-REDEEM 申請捕捉値（不変歴史値）。装飾 additive は観測値を持たず reconcile の対にならない。「全て基幹」の断言を撤去し scope 明示分類に置換 | §5 I-SATELLITE-RECON |
| 3 | §3.3 の「C7 各達成も PointLedger 付与（no-silent-gap）」の全称を訂正: バトルは C7 だがその戦果値は経済的付与でなく台帳に入らない例外 | §3.3 に **no-silent-gap の精緻化** を追記: 「習慣装置の各達成が悉く台帳付与になるわけではない。経済的付与（残高に入る点数）のみ台帳経由、バトルの戦果値のような非経済の内部値は台帳外」と分類（悉皆の断言をしない） | §3.3 付与代表例の直後 |

---

## 2. [note]（表記整理）

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| cheer は台帳を synchronous に先 insert → 後 message で §4.3「衛星先・台帳 eventual」の向きと逆。realization の同期/eventual 別は M3 の関心事と 1 句添え、概念層の向き規定と分離 | §4.3 に「概念層が規定するのは衛星→PointLedger の**付与方向**であり、その realization（同期に先 insert するか eventual に要請するか。例: cheer は現行 realization で台帳エントリを同期先 insert）は M3 の関心事」を追記 | §4.3 |
| I-ADD の bare `challenge` は「進捗（現在値・droppable）」を指す旨限定（達成報酬 child_challenge は基幹）／ACTIVITY_LOG.連続ボーナスは付与ポイント総額に subsume され reconcile される旨 | I-ADD に「bare challenge = 進捗（droppable）、チャレンジ達成報酬 child_challenge は基幹付与（exactly-once eventual）で droppable 対象外」を明記。「ACTIVITY_LOG.連続ボーナスは `activity` 付与ポイント総額に subsume され総額観測値として reconcile」を追記 | §5 I-ADD |

---

## 3. 制約遵守確認

- **個数・網羅・完全・裏取り・全称の過剰主張を書かない**: push 前 `grep -nE "網羅|完全|付与14|消費3|裏取り"` = **ZERO RESIDUE** を実確認。「全て基幹/悉皆」等の全称断言も本文に置かず、scope 明示分類に置換（Round 5 ヘッダの「『…は全て基幹』は偽」はメタ言及＝訂正対象の旧主張を「は偽」と明示する引用であり、live な全称主張ではない）。
- バトルで露呈した通り「全て/悉皆」の断言は反例で崩れるため、精密だが検証不能な全称を避け scope を明示分類する方針を徹底。
- DB 非依存厳守: 物理・ベンダ語をドメイン記述に持ち込まず（cognito 0 / erDiagram 6 健在）、backend 挙動は「実装確認」の個別事実 or M3 委譲としてのみ言及。
