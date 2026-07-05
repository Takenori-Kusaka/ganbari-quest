# M1 概念モデル Round 3 レビュー 応答台帳

> **目的**: M1 レビュー Round 3 board（3 独立観点）の finding に対し「どう対応し、どこに反映したか」を 1:1 でトレースする。
> **対象成果物**: `docs/design/dsql/m1-conceptual-model.md`（Round 3 rework）。
> **前提**: Round 2 の [must]1/3/4/5（PointLedger 独立集約・convert 消費・Family 衛星化・§9 mermaid）は解消確認、PointLedger をバイパスする付与経路が無いことも独立確認済。Round 3 の残 [must] は「**ポイント経済の権威と層分け**」に集約。
> **凡例**: 反映箇所は §番号 / L番号 / I番号。

---

## 0. 構造決定（残 [must] の大半を連鎖解決）

| 決定 | 対応 | 反映箇所 |
|---|---|---|
| **PointLedger を全点数値の唯一の権威（sole authority）とする** | 衛星の点数属性を「非権威な表示用観測値（streak と同格）」と位置づけ、残高・集計の source は PointLedger のみに一本化。I-LEDGER-AUTH / I-SATELLITE-RECON を §5 新設 | §3.3 / §4 intro Round 3 / §4.2 Child 衛星注記 / §5 I-LEDGER-AUTH I-SATELLITE-RECON I-BAL |

---

## 1. [must]（Round 3、3 観点統合）への対応

| # | [must] 指摘（観点） | 対応内容 | 反映箇所 |
|---|---|---|---|
| **1** | [skeptic-2 = 発端 defect と同型] 集約横断の点数二重保持（ACTIVITY_LOG.付与ポイント / CHECKLIST_LOG.付与ポイント / LOGIN_BONUS.付与ポイント / EVALUATION.ボーナスポイント 等 が PointLedger と同一事実を二重保持＝ L-03 を集約境界で再導入）。PointLedger を唯一権威とし satellite 点数属性を非権威観測値と明示、reconciliation 不変条件を §5 に、I-BAL は PointLedger のみから導出 | **I-LEDGER-AUTH**（正本は PointLedger、衛星点数属性は記録時捕捉の非権威観測値・streak 同格・残高集計の source 禁止）+ **I-SATELLITE-RECON**（観測値は対応台帳エントリ額に結果整合で収束、乖離時は PointLedger を正）を §5 新設。I-BAL を「PointLedger のみから派生」に更新 | §3.3（sole authority 明記）/ §4.2 Child 衛星注記 / §5 I-LEDGER-AUTH I-SATELLITE-RECON I-BAL |
| **2** | [domain-A + skeptic-1 = taxonomy 過剰主張の再々発] 完全性主張を全撤回。毎回反例（mission_bonus / special_reward）が出る。網羅は M1 の本質でなく M3 の関心事 → 「網羅／裏取り済＝完全」の語を全撤回、代表例のみ列挙、完全集合 + CHECK + backend 差（sqlite daily_mission 畳込み ⇄ DSQL mission_bonus）確定は M3。以後「網羅」と書かない | §3.3 の種別記述を**代表例のみ**に書き換え、「**完全な種別集合・CHECK 制約・backend 差の確定は M3 の関心事**」と明記。mermaid enum も「代表例は下記(完全な値集合はM3)」に。**Round 2 主変更ヘッダの「実 grep で網羅列挙（付与14/消費3/繰越1）」表現を撤回**し Round 3 変更を追記。§10 M3 委譲に「点数種別の完全な値集合・CHECK・backend 差」を明示追加。**本台帳含め以後「網羅」の完全性語を使わない** | §3.3 / mermaid enum / 本文 Round 3 ヘッダ / §10 |
| **3** | [data-arch = reversal の穴] 負エントリを 3 分類: (i) 裁量消費（reward_redemption/convert、同期・I-BAL-NONNEG 適用）(ii) award 逆転（cancel/checklist_cancel、記録取消補正、残高を一時的に負にしうる正当補正）— I-BAL-NONNEG は裁量消費のみに適用（逆転はバイパス正当、「負残高中は新規裁量消費不可」を不変条件化）(iii) 繰越。§3.3 消費 counting を実 type と一致 | §3.3 を**負エントリ 3 分類**（裁量消費 / award 逆転 / 繰越）に書き換え、cancel/checklist_cancel を award 逆転として reward_redemption/convert と分離。**I-BAL-NONNEG を「裁量消費のみに適用する目標不変条件」に限定**し award 逆転はバイパス正当と明記。**I-NEG-BAL**（負残高中の新規裁量消費禁止）を §5 新設。I-CONSUME を「裁量消費経路の統一則」に更新 | §3.3 負エントリ 3 分類 / §5 I-BAL-NONNEG（限定）I-NEG-BAL I-CONSUME |
| **4** | [domain-B = 新規概念欠落] 固定間隔特別報酬（checkAndGrantFixedIntervalReward、記録 N 回で自動発行する予告型マイルストーンごほうび、ADR-0012 準拠、special_reward 付与）を C7 習慣装置概念として C7・§4.2 Child 衛星に追加。付与は PointLedger へ結果整合要請 | **固定間隔特別報酬（FixedIntervalReward）を C7 概念に追加**（予告型・変動比率でない＝ADR-0012 anti-engagement 準拠、special_reward を PointLedger へ要請、記録の後追い additive）。§4.2 Child 衛星集約に列挙 | §3.4（FixedIntervalReward）/ §4.2 Child 衛星注記 |

---

## 2. [should] への対応

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| `CHILD ||--o| MEMBERSHIP` を `|o--o|` に修正（各 membership が子供ちょうど 1 を強制し parent/owner membership と矛盾） | §3.2 mermaid を **`CHILD |o--o| MEMBERSHIP`（子供 0..1 ⇔ 所属 0..1）** に修正 | §3.2 mermaid |
| 基礎点付与を「hard 不変条件なし」→「guaranteed exactly-once eventual（欠落不可・冪等）」に訂正（装飾 additive の I-ADD とは別水準、「付与は落ちてよい」誤読防止） | §4 intro #1 と §4.3 を**付与の 2 水準**（基幹付与=exactly-once eventual 欠落不可 / 装飾 additive=欠落許容 I-ADD）に訂正。「落ちてよい」の誤読を明示的に禁止 | §4 intro #1 / §4.3 |
| convert は現行 realization 非原子（read→check→append）、M3 で原子的消費へ収斂必須と注記（overspend 不能を実測でなく target として分離） | §3.4 に「**概念上の目標 invariant と現行 realization の分離**」を追記（現行 convert は TOCTOU 窓あり非原子、原子化は M3）。I-BAL-NONNEG を「目標不変条件」と明記 | §3.4 / §5 I-BAL-NONNEG |
| I-PURGE に外部メディア実体（子供の画像・音声）の消去も purge 到達範囲（ドメイン外だが消去責務 cross-cut、COPPA/GDPR） | I-PURGE に「メディア参照が指すドメイン外実体（画像・音声バイト）の消去も purge 到達範囲、参照だけ消して実体を残さない」を追記 | §5 I-PURGE |
| Consent 現在値が衛星ログからの derived-on-read である旨と同期読取要否を balance と同水準で明記 | I-CONS を「現在の同意は衛星追記ログからの **derived-on-read** 派生値（残高=台帳総和と同水準の都度導出、認可時に最新値を同期読取）」に更新 | §5 I-CONS |
| marketplace 公開プリセット（5 type）を「テナント外共有参照で M1 scope 外」と §10 に明記（暗黙の no-silent-gap を閉じる） | §10 に「**marketplace 公開プリセットはテナント外共有参照で M1 scope 外**」を明示追加。取込はコピー上書きで per-child instance を生む（帰属記録のみ） | §10 |

---

## 3. 過剰主張の是正（Round 3 最重要制約の遵守）

- Round 3 制約「**完全性/網羅の語を一切書かない**（M3 送りが正しい scope 分け）」を遵守した:
  - §3.3 から「完全集合・実 grep で網羅・裏取り済=完全」の語を撤去し「代表例のみ／完全集合は M3」に置換。
  - Round 2 主変更ヘッダの「実 grep で網羅列挙（付与14/消費3/繰越1）」を撤回。
  - 本台帳でも種別の「網羅」を主張せず、代表例と M3 委譲のみを記述。

> **⚠️ Round 4 訂正**: 上記「撤回」は §3.3 と Round 2 ヘッダについては完了していたが、**§4.2 PointLedger 行と §6 code スケッチに個数表記「付与14/消費3/繰越1」が 2 箇所残存していた**（＝撤回は不完全だった）。Round 4 [must] でこの 2 箇所を分類参照（数を断言しない）に置換し、push 前 grep で残渣ゼロを実確認して根絶した。詳細は `m1-review-round4-ledger.md`。この訂正により「撤回済」の記述実態を正す。
- ただし**個別事実の grounding（例: convert が実残高消費 / fixed-interval が予告型 / mission_bonus が DSQL 側 type）は具体的 1 事実の裏取りであって taxonomy 完全性主張ではない**ため、その旨を根拠として記述に使うのは許容（完全性語は使わない）。

---

## 4. DB 非依存制約の遵守確認

- テーブル/列/PK/索引/正規形/JSON/uuid/認証ベンダ名等の物理・ベンダ語をドメイン記述（§1〜§9 の ER・class・不変条件）に持ち込んでいない。
- 物理語が現れるのは §2 読み替え規則と §10 M3 委譲境界に限定。backend type 名（mission_bonus 等）は §3.3 / §10 で「M3 で確定する物理 type」として言及するに留め、概念記述の語彙にしていない。
