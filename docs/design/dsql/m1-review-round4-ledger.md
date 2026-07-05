# M1 概念モデル Round 4 レビュー 応答台帳（収束）

> **目的**: M1 レビュー Round 4 board（データアーキ PASS、残 [must] 唯一）の finding を 1:1 トレースする。
> **対象成果物**: `docs/design/dsql/m1-conceptual-model.md`（Round 4 rework、収束見込み）。
> **前提**: 構造は全観点健全と確認。唯一の [must] は「付与14/消費3/繰越1」の個数表記残渣（ドメイン+skeptic が独立に同一箇所を指摘）。
> **凡例**: 反映箇所は §番号 / I番号。

---

## 1. [must]（唯一・機械的、ドメイン+skeptic 収束）

| 指摘 | 対応内容 | 反映箇所 |
|---|---|---|
| 「付与14/消費3/繰越1」の個数表記が 2 箇所生存（`m1-conceptual-model.md` §4.2 PointLedger 行 / §6 code スケッチ）。(1)「14」等の精密個数は §3.3「代表例のみ・値集合は M3」と真っ向矛盾（過剰主張の再々発）(2)「消費3」は I-CONSUME「裁量消費は 2 経路のみ」+ cancel/checklist_cancel を award 逆転へ再分類したことと数が合わない（文書内矛盾）(3) Round 3 台帳「撤回済」は実態と不一致（虚偽） | **両箇所を数を断言しない分類参照に置換**: §4.2 = 「点数事象（付与 / 裁量消費(2経路) / award 逆転 / 繰越 の各種別、代表例は §3.3、値集合の確定は M3）」／ §6 = 「追記のみ（付与 / 裁量消費 / award逆転 / 繰越 の各種別、代表例は §3.3、値集合の確定は M3）」。**「消費」を「裁量消費(2経路)」に統一し I-CONSUME と数を一致**（cancel/checklist_cancel は award 逆転で別立て）。**Round 3 台帳の「撤回済」記述を実態（残存していた）に合わせて訂正**（round3-ledger §3 に Round 4 訂正注記を追加） | §4.2 / §6 / round3-ledger §3 訂正 |

### push 前 grep 実確認（board 必須）

`grep -nE "網羅|完全|付与14|消費3|裏取り" docs/design/dsql/m1-conceptual-model.md` → **ZERO RESIDUE**。

- 個数表記（付与14/消費3）: 撤去（メタ言及も含め本文から literal を排除）。
- `完全`: M3 委譲の語（「完全集合は M3」等）を「値集合の確定は M3」に、ドメイン語「アカウント完全削除」を「アカウント全体削除」に言い換え、screen をクリーンにした（意味は不変）。
- `裏取り`: 個別事実の grounding 語を「実装確認」に統一（per-fact 確認の意味は保持、完全性主張ではない）。
- `網羅`: もとより本文に不在。

---

## 2. [should]（RECON の穴を完全に閉じる）

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| I-SATELLITE-RECON の scope 明記: (a) reconcile 対象は総額観測値（付与ポイント）のみ、streak 日数等の歴史的計数は不変・非是正（I-STREAK-VS-COMBO 接続）(b)「点数観測値を持つ衛星付与は全て基幹付与（exactly-once eventual）」(c) 乖離は基幹付与 land までの一時窓のみ、land 後は恒常一致（temporary/permanent 明確化）。I-REDEEM の申請捕捉値は不変歴史値ゆえ reconcile 対象外 | I-SATELLITE-RECON を **scope 明記版**に全面更新: (a) 総額観測値のみ対象・streak 計数は不変非是正 (b) 観測値の有無＝基幹/装飾の対応（観測値を持つ＝基幹 exactly-once、装飾 additive は観測値を持たず台帳エントリのみ）(c) 乖離は land までの一時窓のみ・land 後恒常一致 + 申請捕捉値は対象外 の 4 点を明記 | §5 I-SATELLITE-RECON |

---

## 3. [note]（表記整理）

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| carryover を「負エントリ 3 分類」から外し符号中立の残高保存事象として別立て。見出しを「台帳エントリの役割別分類（付与/裁量消費/award逆転/繰越）」に | §3.3 の見出しを役割別分類に変更。carryover を「符号中立の残高保存事象（消費でも付与でもない中立イベント）」として別立て | §3.3 |
| I-NEG-BAL は I-BAL-NONNEG の負残高特化である旨を 1 行注記（補強と明示） | I-NEG-BAL に「本条は I-BAL-NONNEG の負残高特化（別制約でなく補強）」を追記 | §5 I-NEG-BAL |
| I-BAL に「基幹付与 land までの一時窓で残高が稼得分を含まず過小表示になりうる（overspend 安全と引き換えの獲得側ラグ、materialize は M3）」を 1 行 | I-BAL に当該 1 行を追記 | §5 I-BAL |

---

## 4. 制約遵守確認

- **個数・網羅・完全・裏取りの語を本文に一切残さない**: push 前 grep で ZERO RESIDUE を実確認（本台帳 §1）。
- DB 非依存厳守: 物理・ベンダ語をドメイン記述に持ち込まず（cognito 0 / erDiagram 6 健在）、backend type 名は M3 委譲としてのみ言及。
