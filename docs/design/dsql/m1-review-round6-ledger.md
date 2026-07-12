# M1 概念モデル Round 6 レビュー 応答台帳

> **目的**: M1 レビュー Round 6 board（データアーキ PASS、skeptic が [must] 1 件 = fix の伝播漏れ）の finding を 1:1 トレースする。
> **対象成果物**: `docs/design/dsql/m1-conceptual-model.md`（Round 6 rework）。
> **根の分析（board）**: Round 4/5/6 の [must] は**全て同一根＝「点数次元の値を持つが台帳付与に裏付けられない観測値」**（バトル戦果値・卒業 KPI スナップショット）。列挙で塞ぐと反例のたび漏れるため、**述語ベースに構造転換して根絶**する。
> **凡例**: 反映箇所は §番号 / I番号 / L番号。

---

## 1. [must]（伝播漏れ、機械的）

| 指摘 | 対応内容 | 反映箇所 |
|---|---|---|
| §4.2（旧 line 338）の「正の付与を PointLedger へ要請する衛星」列挙に `Battle` が残存＝§3.4/§5 でバトルを非経済化したのと矛盾（同 §4 の集約一覧行には Battle が付与要請主体として無く内部不整合）。実コード: `battle-service.ts` は台帳に一切書かない。全 `Battle|バトル` 出現を洗い出し付与/台帳文脈を §3.4 と整合 | **§4.2 の付与要請衛星列挙から `Battle` を除去**し「経済点数を生む衛星集約（GrowthJournal / StampCard / ChecklistProgress / ChildChallenge / FixedIntervalReward / login / focus / must / cheer 等。**バトルは戦果値が非経済ゆえ台帳へ要請しない**）」に修正。**全 Battle/バトル 出現を grep で洗い出し**、付与/台帳文脈の全箇所（§3.3 no-silent-gap / §3.4 mermaid+bullet / §4.2 / §5）がバトル=非経済で一貫することを確認（§4.2 集約一覧の Battle 行は「1 日 1 戦の局所整合」で付与要請を伴わず正当につき維持） | §4.2 付与要請リスト / grep 全確認 |

---

## 2. 構造 fix（根絶 — 列挙 → 述語）

| 指摘 | 対応内容 | 反映箇所 |
|---|---|---|
| I-SATELLITE-RECON の scope を「明示列挙 (i)(ii)(iii)」から**述語定義**に変える: RECON 対象 = 台帳の経済的付与エントリに対応する衛星観測値のみ。台帳付与に裏付けられない点数次元の値は定義上 scope 外（バトル戦果値・卒業 KPI スナップショット・streak 計数・申請捕捉値は例示であって列挙でない）。新たな非台帳点数値も述語で自動 scope 外化（data-arch 指摘の graduation_consent.user_points も自動被覆） | **I-SATELLITE-RECON を述語定義に転換**: 「RECON 対象は『台帳の経済的付与エントリに対応する衛星観測値』だけ」「台帳付与に裏付けられない点数次元の値は定義上 scope 外（新たな非台帳点数値が現れても自動的に scope 外、列挙漏れが起きない）」と記述。scope 外の値は**例示（代表例、悉皆列挙でない）**として バトル戦果値／卒業 KPI スナップショット／streak 計数／申請捕捉値 を挙げるに留める。「明示列挙／網羅」の語を使わず述語で定義 | §5 I-SATELLITE-RECON |

---

## 3. [should]

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| 「全点数値」→「経済点数値（残高＝台帳総和を構成する点数）」に限定（I-LEDGER-AUTH / §3.3 / §4.2）。無限定全称の再燃防止。I-LEDGER-AUTH に「非経済演出値（戦果値）・KPI スナップショットは本条の対象点数属性でない」1 句 | **I-LEDGER-AUTH を「経済点数に限定」版に更新**（「本条の対象は経済点数のみ」「非経済の演出値（バトル戦果値）・KPI スナップショットは本条の対象点数属性でない」を追記）。§3.3 sole-authority bullet と §4.2 #1 bullet の「全点数値」を「経済点数値」に是正（無限定表現の literal も除去） | §5 I-LEDGER-AUTH / §3.3 / §4.2 |
| graduation_consent の no-silent-gap: nickname（公開表示名）/ message（卒業の言葉）は正当なドメイン内容 → §3.5 に概念化。user_points/usage_period_days は KPI 派生（L-07 read-model 同様の概念外プロジェクション）と 1 行明記 | §3.5 GRADUATION_CONSENT mermaid に `公開表示名`・`卒業の言葉`（ドメイン内容）+ `卒業時点数KPIスナップショット`・`利用期間日数KPIスナップショット`（概念外プロジェクション）を追加。**no-silent-gap bullet を新設**: nickname/message は正当なドメイン内容、user_points/usage_period_days は L-07 型の概念外プロジェクション（KPI スナップショット、点数経済の権威でない）→ I-SATELLITE-RECON の述語で自動 scope 外と明記（実装確認: graduation-consent は nickname/consented/userPoints/usagePeriodDays/message を持つ） | §3.5 mermaid + bullet |

---

## 4. 制約遵守確認

- **列挙を「網羅/完全/明示列挙」と称さない — 述語で定義**: I-SATELLITE-RECON を述語定義に転換し、scope 外は「代表例、悉皆列挙でない」と明示。「網羅でなく」の literal（否定形でも screen に掛かる）も撤去。
- **push 前 grep で矛盾ゼロ実確認**:
  - `grep -nE "網羅|完全|全点数値"` = **ZERO**（無限定表現の literal を撤去、網羅・完全は不在）。
  - `grep -nE "網羅|完全|付与14|消費3|裏取り"`（Round 4 screen）= **ZERO**。
  - Battle の live な付与/要請主張 = 不在（§4.2 集約一覧の Battle 行は局所整合のみで付与要請を伴わない）。残る `Battle|バトル` 出現は全て「非経済・台帳外」を述べる文脈 or 集約一覧の正当な行。
- DB 非依存厳守（cognito 0 / erDiagram 6 健在）。
- **根絶の担保**: 今後 point 次元の値を持つ非台帳観測値（新機能の KPI 等）が現れても、I-SATELLITE-RECON の述語が自動的に scope 外化するため、同一根の [must] は再発しない（列挙メンテ不要）。
