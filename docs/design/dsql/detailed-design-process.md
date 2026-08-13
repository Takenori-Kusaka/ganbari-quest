# DSQL 詳細設計プロセス（提案 — 承認後に ADR 化して運用）

> 目的: 「大方針設計書 (#3514) は方向性 OK だが、そこからの落とし込みが杜撰で、多角検証・十分な設計が
> 行われなかった」原因を潰し、詳細設計フェーズを**確実**にする開発プロセス・マイルストーン・
> デザインレビューの I/O・決裁条件を定義する。**本プロセスの承認が、詳細設計着手の前提。**

---

## 0. 根本原因（プロセスは各項目を構造的に潰す）

| # | 杜撰さの原因 | 本プロセスでの対策 |
|---|---|---|
| R1 | 大方針 → 実装の間に**詳細設計ゲートが無く**、「凍結・panel 決裁済」で即コード | 概念→論理→物理の**3ゲート**を挟み、各 exit 基準を満たすまで下流着手不可 |
| R2 | **「まず作る」バイアス**（code=進捗単位、test green=設計正しいと誤認） | 進捗単位を**設計 artifact**に。実装は M3 物理モデル exit 後のみ |
| R3 | 設計レイヤー未分離（概念/論理/物理を混同、DB 非依存 ER モデル不在） | ANSI-SPARC 3層を**明示分離**（下記 §1） |
| R4 | **単一パス・自己検証**（多角/敵対レビュー無し、8軸 deep research を実装で無視） | 各ゲートで**独立・敵対的レビュー**を決裁条件化。8軸 deep research を全設計判断に適用 |
| R5 | **決裁条件が曖昧**（「panel 決裁済」に基準チェックリスト無し） | 各ゲートに**明文の決裁チェックリスト**。全項目 ✓ + レビュアー承認で初めて pass |
| R6 | **トレーサビリティ欠如**（決定↔根拠↔検証エビデンスの紐付け無し） | 全設計判断を**決定台帳**（決定→根拠→検証エビデンス→影響）で管理、空欄がある間は exit 不可 |

## 1. 採用する方法論（established、実エビデンスに接地 — 私の発明ではない）

本プロセスの骨格は、私が考案したものではなく **DB 設計の標準実務そのもの**。以下は 2026-07-05 web 調査で裏取り済み（出典は §7）：

| 構成要素 | 何に接地しているか（established） | 出典 |
|---|---|---|
| **概念→論理→物理 の3段データモデリング**（M1/M2/M3） | データモデリングの**業界標準プロセス**。「まず概念、次に論理、最後に物理」の順が best practice と複数の一次実務ソースが一致 | Couchbase / erStudio / ThoughtSpot / Visual Paradigm |
| **設計レイヤーの分離**（DB 非依存の概念層 ⇄ 物理格納層） | **ANSI-SPARC 三層スキーマ**（External / Conceptual / Internal、ANSI/SPARC **1975**）。「各利用者ビューを物理表現から分離する」という DBMS 設計の基礎モデル | Wikipedia / GeeksforGeeks |
| **各ゲートの entry/exit 決裁条件（測定可能な合格基準）** | **Phase-Gate（Stage-Gate）+ Entry/Exit Criteria**。規制産業（FDA / ISO 13485 / DO-178C）と **NASA SWE Handbook 7.9** が「フェーズ完了前に満たすべき測定可能条件」を必須化 | NASA SWE Handbook / Smartsheet |
| **ER モデル / 正規化 / DDD 集約** | 概念モデル = ERD、論理モデル = 正規化、集約境界 = DDD（大方針 §3 で既採用）。上記データモデリングプロセスの標準構成要素 | 上記 + 大方針 §3 |

> M0（下記）で、本方法論採用を **`docs/decisions/README.md` §OSS 先調査ルール（確立パターン最低2件比較）** に沿って正式決裁し ADR 化する。
> **接地の意味**: R4（自己流・単一パス）の再発防止。プロセスが「私の独断」でなく標準実務であることを、出典で検証可能にする。

## 2. 現在地（前提の確認）

- **フィジビリティ ✓**: AWS 実機 DSQL クラスター構築・spike#1（RLS非対応 / dialect / 3000行 / OCC / コスト¥0 実機確証）
- **大方針設計 ✓ 方向性 OK**: `dsql-data-model.md`（§3 DDD 集約 / §8 recordActivity 原子化 等）。ただし物理寄り・§5⇄§9.2.1 矛盾・Phase 1 PoC 未検証
- **→ ここから詳細設計**: 概念モデル → 論理モデル → 物理モデル をゲート付きで

## 3. マイルストーン & デザインレビュー・ゲート

各ゲート = **INPUT → OUTPUT（artifact）→ 決裁条件（全 ✓ で pass）**。決裁の最終主体は PO/ユーザー。私は artifact を用意しレビューにかける（自己申告で pass しない）。

### M0: 方法論採用（ADR）
- **INPUT**: 本プロセス案 + 確立パターン候補（§1）
- **OUTPUT**: 「DSQL 詳細設計プロセス」ADR（方法論・ゲート・決裁条件を確定）
- **決裁条件**: (a) 最低2確立パターンの比較記載（`docs/decisions/README.md` §OSS 先調査ルール）(b) 根本原因 R1-R6 への対策が各々ゲートに紐づく (c) PO 承認

### M1: 概念データモデル（Conceptual、DB 非依存）
- **INPUT**: 製品ドメイン（企画書 / UI / ドメイン知識）。**既存 entity・schema は「参照」のみ、継承しない**
- **OUTPUT**: ① ER 図（entity / 属性 / 関係 / 多重度 / 参加制約）② 集約境界（DDD）③ **ドメイン不変条件一覧**（例: total_point の意味論、1子1週1カード 等）④ DB 非依存の domain class 定義
- **決裁条件**: (a) 全 entity が製品ドメインの概念に対応（DynamoDB 遺産の継承でない）(b) 各 entity につき「既存構造との差分」と「なぜ変えた/継承したか」を明記 (c) 関係の多重度・不変条件が全て明示 (d) **独立レビュー最低2観点**（ドメイン正しさ / 関係整合）パス

### M2: 論理データモデル（Logical、relational だが DBMS 非依存）
- **INPUT**: M1 概念モデル
- **OUTPUT**: ① 正規化済リレーション schema（3NF 既定、非正規化は根拠付き）② キー戦略（自然キー / 代理キー、選択根拠）③ 参照整合ルール（DSQL は FK 非対応 → app/CHECK でどう担保するか）
- **決裁条件**: (a) 全リレーションが M1 から導出可能（トレーサブル）(b) 3NF（逸脱は計測 or 明示根拠）(c) 各キー選択に根拠（§P1 非可逆性への配慮含む）(d) 正規化違反ゼロをレビュー確認

### M3: 物理データモデル（Physical、DSQL + sqlite 2 方言）
- **INPUT**: M2 論理モデル + **Phase 1 PoC 実測**（DPU / OCC 率 / drizzle-kit DDL 制約 / import 上限）+ DSQL 物理制約 §2
- **OUTPUT**: ① 確定 DDL（PK 凍結 / index / JSON 格納方針 / 派生列 / CHECK）② fitness function ③ cutover runbook
- **決裁条件**: (a) **全物理判断が M2 論理 + PoC 実測に紐付く**（決定台帳に空欄なし）(b) §P1 凍結対象の非可逆判断は PoC 裏取り済 (c) **相互矛盾ゼロ**（§5⇄§9.2.1 型の矛盾を機械 or レビューで検出）(d) **敵対的レビュー**（各判断に「これで壊れる入力/運用は?」を1つ以上ぶつけ、耐えたもののみ pass）

### M4: 実装（Phase 3）— **M3 exit 後のみ着手可**
- 既存実装（現 develop の DSQL コード）は**参照材料**。M3 確定モデルへリファクタで寄せる（ハード revert しない、2026-07-05 方針）
- 各実装 PR は M3 の決定台帳の該当項目にトレースバック

## 4. 多角検証の制度化（R4 対策）

- 各ゲートで**独立レビュー**（自己検証禁止）。最低1つは**敵対的観点**（「これが壊れるケースは?」）
- EPIC の**8軸 deep research**を各設計判断に適用（公式doc / 設計パターン / OSS事例 / 公式推奨 / 独自要否 / 将来性 / データ整合 / 運用費）
- **決定台帳**（1 決定 = 1 行: 決定 / 根拠 / 検証エビデンス / 影響 / レビュー結果）を M1-M3 で維持。空欄がある間は exit 不可

## 5. 決裁の主体と成果物

- 各ゲートの**決裁は PO/ユーザー**。私は artifact + 決裁チェックリストの充足状況を提示、レビューにかける
- 成果物は docs 配下に残す（M0 ADR / M1 概念モデル / M2 論理モデル / M3 物理 DDL + 決定台帳）。**大量トークンを消費して何も残らない、を再発させない**

## 7. 出典（2026-07-05 web 調査、§1 の接地根拠）

**3段データモデリング（概念→論理→物理）**:
- Couchbase — The Differences Between Conceptual, Logical, & Physical Data Models: https://www.couchbase.com/blog/conceptual-physical-logical-data-models/
- erStudio — What Is Physical Data Modeling: https://erstudio.com/blog/physical-data-modeling/
- ThoughtSpot — Conceptual vs Logical vs Physical Data Models: https://www.thoughtspot.com/data-trends/data-modeling/conceptual-vs-logical-vs-physical-data-models
- Visual Paradigm — Conceptual, Logical and Physical Data Model: https://www.visual-paradigm.com/support/documents/vpuserguide/3563/3564/85378_conceptual,l.html

**ANSI-SPARC 三層スキーマ（1975、レイヤー分離の基礎）**:
- Wikipedia — ANSI-SPARC Architecture: https://en.wikipedia.org/wiki/ANSI-SPARC_Architecture
- GeeksforGeeks — The Three-Level ANSI-SPARC Architecture: https://www.geeksforgeeks.org/dbms/the-three-level-ansi-sparc-architecture/

**Phase-Gate + Entry/Exit Criteria（ゲート決裁条件の基礎）**:
- NASA Software Engineering Handbook 7.9 — Entrance and Exit Criteria: https://swehb.nasa.gov/display/7150/7.9+-+Entrance+and+Exit+Criteria
- Smartsheet — Ultimate Guide to the Phase Gate Process: https://www.smartsheet.com/phase-gate-process

---

## 6. マルチエージェント設計レビュー board（#2 指示: 役割を deep research してから決定）

**接地根拠（2026-07-05 web 調査、出典 §7）**: Fagan inspection（役割 + Planning→Inspection→Rework→Follow-up の工程）/ Architecture Review Board（技術アーキ / ドメイン専門 / セキュリティ / QA の多観点）/ ATAM（SEI-CMU、品質属性トレードオフ評価: 性能/セキュリティ/改変性/可用性）。**役割設計は私の発明でなく上記標準の写像。**

### 工程（Fagan 準拠、各ゲート共通）
artifact 提示 → **独立並列レビュー** → 欠陥ログ（決定台帳、Fagan recorder）→ rework → follow-up 再レビュー。**未解決 [must]/[critical] ゼロに収束するまで私が自律で回す**（ユーザーに諮らない）。

### 役割（reviewer は context 非継承の fresh agent = 私の盲点を継がない。原発端の defect も fresh agent の独立調査が発見）
- **Moderator = 私（オーケストレーター）**: 起動・進行・収束管理（Fagan moderator）
- **Recorder = 決定台帳 agent**: 決定/根拠/検証エビデンス/影響/レビュー結果を記録
- **M1 概念レビュアー**: ①ドメイン専門（entity/関係が製品ドメインに合致・DynamoDB 継承でないか）②データアーキ（ER/集約境界の正しさ）③敵対 skeptic（継承/欠落/矛盾を突く）
- **M2 論理レビュアー**: ①関係理論（正規化/3NF/関数従属）②キー戦略（自然/代理・§P1 非可逆ヘッジ）③参照整合（FK非対応→CHECK/app 担保）④敵対 skeptic
- **M3 物理レビュアー（ATAM 品質属性レンズ）**: ①DSQL 物理制約（PK凍結/ASYNC index/1txn上限/方言parity）②性能・コスト（DPU/OCC）③セキュリティ・テナント分離（§P9）④**データ移行・cutover 安全**（NUC 破壊/喪失レンズ ← ここの [critical] のみユーザーへエスカレーション）⑤敵対「何で壊れるか」⑥トレーサビリティ監査（各物理決定→M2論理+PoC 実測）

### 合格規準（entry/exit）
台帳の未解決 [must]/[critical] ゼロ + 全敵対反証が解決 + gate exit チェックリスト全 ✓。**例外: cutover 安全レビュアーの [critical]（NUC 破壊/喪失）はユーザー決裁へ**。

## 8. ブランチ戦略・役割・移行（2026-07-05 ユーザー指示）

- **私の役割 = オーケストレーター**。起票/実装/テスト/検収は全てサブエージェント。私は手を動かさずチームを統括。各ゲート決裁は §6 の多エージェント board（PO/ユーザーでなく）。
- **ブランチ**: `feature/dsql` を develop から作成済。以降の DSQL 作業は各 sub-PR を **feature/dsql 宛**に段階的に。QM に出せる状態で **feature/dsql → develop の PR** を出し Ready 化。
- **既存コードの扱い**: R0-R7（#3579-#3602）は既に develop へ merge 済（**dormant** = DATA_SOURCE 未結線で非活性）。feature/dsql は develop から切ったのでこれらを参照材料として含む。M1-M4 でこれを確定設計へリファクタし、feature/dsql→develop で supersede。R8/R9/R10 は PR 化されず branch のみ（未 merge、参照材料）。
- **ユーザー確認は NUC 破壊/データ喪失のみ**: DynamoDB 破棄 OK / NUC バックアップ取得後 破棄 OK。復旧はユーザー実行になるため **lazy migration（遅延マイグレーション）を cutover 設計の必須要件**とし、復旧負担を最小化（M3/Phase 5 の決裁条件に組込）。
