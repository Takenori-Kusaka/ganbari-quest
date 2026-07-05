# M1 概念モデル Round 1 レビュー 応答台帳

> **目的**: M1 レビュー board（3 独立観点、全観点 FAIL）の finding に対し「どう対応し、どこに反映したか」を 1:1 でトレースする（ADR-0060 全対応完了の検証義務 / no-silent-gap）。
> **対象成果物**: `docs/design/dsql/m1-conceptual-model.md`（rework 版）。
> **凡例**: 反映箇所は rework 版の §番号 / L 番号（§7 対照表）/ I 番号（§5 不変条件）。

---

## 0. 根因対応（1 つで [must] 多数が連鎖解消）

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| **settings KVS を §2 読み替え規則で処理せず暗黙に捨てている**（no-silent-gap 違反。物理草稿は Family 集約に settings を含む） | §2 に「家族設定 KVS → 各キーを意味あるドメイン概念へ展開、または明示 scope 外 + 理由」の読み替え行を追加。§7 に **L-14「家族設定 KVS decompose」** を新設し、全キー群を **(a) 概念昇格 / (b) UI 一過性フラグ=概念外 / (c) 無状態の実現手段=概念外** に線引き | §2 読み替え表（新規行）/ §7 L-14 / §3.1・§3.3・§3.4・§3.5 に昇格概念を配置 |

この根因対応から下記 [must] が生成・連鎖解消された（1/2/3 の大半）。

---

## 1. [must] 一覧（3 観点統合・重複排除）への対応

| # | [must] 指摘 | 対応内容 | 反映箇所 |
|---|---|---|---|
| **1** | settings decompose → BonusRule / ParentGate / AuthSession / DecayPolicy / DefaultChildSelection / ポイント→通貨換算 / 承認方針 / 通知設定 / loyalty / level 称号 を概念昇格。UI 状態は概念外 | 全て §7 L-14 (a) で概念昇格 or (b)(c) で概念外に線引き。**BonusRule** は C5 の family master（§3.3）。**DecayPolicy** §3.3。**PointConversionPolicy / ApprovalPolicy** §3.4。**NotificationSettings** §3.5。**LoyaltyState / AccountLifecycle / DefaultChildSelection** §3.1。UI フラグ（tutorial_*/premium_welcome_shown 等）は §7 L-14(b) で概念外と明示。**AuthSession（保護者ゲート署名セッション）は無状態で永続概念でない**と §2 注 + §7 L-14(c) で明記。**裏取り訂正**: 「level/称号 family カスタム」は KVS に実在せず（称号相当はロイヤルティ継続月数から導出）概念化しない旨を L-14 末尾に明記。**ボーナスは POINT_LEDGER に独立 `bonus` 種別を持たず基礎点へ畳み込む**実装事実を §3.3 種別集合 + §7 L-19 で訂正（board 前提の修正） | §2 / §7 L-14 L-19 / §3.1 §3.3 §3.4 §3.5 / §6 |
| **2** | 保護者ゲート認証（PIN/lockout/session）の概念化 = ParentGate。email ログイン lockout は PIN lockout と別機構。I-PIN-LOCK / I-PIN-RESET を §5 に | **ParentGateCredential**（家族単位、PIN 資格・失敗回数・ロック期限・運用リセット痕跡）を C1 に追加。**EmailLoginLockout**（メール単位、家族非依存）を別概念で追加。両者が別機構である旨を §3.1 注記。**I-PIN-LOCK / I-PIN-RESET(検証済ワンタイム確認のみ)/ I-EMAIL-LOCK** を §5 新設 | §3.1 / §5 I-PIN-LOCK I-PIN-RESET I-EMAIL-LOCK / §6 ParentGateCredential / §7 L-15 |
| **3** | ステータス減衰(decay) をモデル化。I-STATUS を「成長総和 − 減衰総和」に訂正。REST_DAY の意味（減衰猶予日）明記。DecayPolicy×REST_DAY 不変条件 | **DecayPolicy**（強度 4 段階 + 猶予日数、family 単位）を C5 に追加。**REST_DAY = 減衰猶予日**と §3.2 で意味確定。**I-STATUS を「成長総和 − 減衰総和」に訂正**。**I-DECAY**（休養日 / 猶予内 / 強度 none で停止）を §5 新設 | §3.2（REST_DAY）/ §3.3（DecayPolicy）/ §5 I-STATUS 訂正 I-DECAY / §7 L-17 |
| **4** | CHILD ⇔ USER/MEMBERSHIP(role=child) の整合規則が空白。I-CHILD-USER 新設 + ログインしない子供は USER/MEMBERSHIP 無し | **I-CHILD-USER** 新設（子供が利用者を持つなら同一家族に role=child 所属ちょうど 1、逆も。ログインしない子供は任意参加で所属無し）。ER に CHILD—MEMBERSHIP(0..1) 関係を追加 | §3.2 ER + 注記 / §5 I-CHILD-USER |
| **5** | Child 集約の巨大集約スメル。(a) Child を所有スコープに再位置づけ + 内側に小集約群、(b) 単一集約のまま結果整合と明記、のどちらか。**推奨 (a)** | **案 (a) 採用**。§4 全面改稿: Child を「所有スコープ（per-child = ADR-0055 所有軸）」に再位置づけ、内側に **GrowthJournal（I-REC の atomic 核）/ ActivityCatalog / StampCard / ChecklistProgress / Battle / RewardExchange / ChildChallenge** の小集約を配置。各小集約は Child を同一性参照。衛星（メッセージ/証書/評価等）は atomic 境界外の独立記録と明記。**I-REC を GrowthJournal に scope** | §4.1 §4.2 §4.3 全面改稿 / §6 GrowthJournal 等の class 分割 |
| **6** | USAGE_LOG の集約二重帰属 → Family 集約に一本化（対象子供は任意属性） | USAGE_LOG を §3.5 で Family 所有に一本化、対象子供を任意属性化。§4.2 で Family 集約に配置 | §3.5 / §4.2 / §7 L-16 |
| **7** | combo/streak の二重帰属矛盾。連続(streak) と連鎖(combo) を用語定義し atomic 内外を分離。I-ADD「再導出可能」は状態なし効果に限定 | **I-STREAK-VS-COMBO** 新設: streak = 記録時確定の不変観測値（I-REC 内 atomic）、combo = 後追い additive の独立台帳エントリ（combo_bonus、結果整合冪等）と定義分離。**I-ADD を訂正**: 「再導出可能」要求は状態を持たない効果（ミッション完了フラグ等）に限定、状態を持つ台帳事実（streak/combo 付与点）は冪等付与で守ると明記 | §3.2（streak = 観測値）/ §5 I-STREAK-VS-COMBO I-ADD 訂正 / §4.3 |
| **8** | 派生値ポリシーの非一貫（残高のみ派生・XP/習熟/連続は確定値）。総和として定義される全派生量に統一ポリシー + retention 保存則一般化 | **I-DERIVED（派生量統一則）** 新設: 総和/畳み込みで定義される全量（残高 / 累計 XP / 習熟回数）はイベント履歴のフォールドに等しい。間引き時は要約事象（carryover / 履歴チェックポイント）で総和保存。**materialize 有無は M3 判断**とし「残高だけ派生・他は確定値保持」の非対称を撤廃。streak は「総和でなく記録時確定の観測値」と分類（I-DERIVED の対象外）し混同を回避 | §5 I-DERIVED / I-BAL / §6 getter 化 / §10 M3 委譲 |
| **9** | Q-07 複数家族は「無痛」でない。I-CHILD-FAM は L-01 の要石。ER の user-membership M:N 図 vs 注記「1 user 1 family」の図文矛盾を解消 | ER を **1 利用者:1..N 所属（下限 1・現行上限 single）** に制約し図文一致。**§9「要石不変条件の反転影響」** を新設し、複数家族化の波及（所有一意性崩壊 / 保護者ゲート多重化 / 課金帰属曖昧化）を明記。I-CHILD-FAM に「反転は局所変更でない」を追記 | §3.1 ER 訂正 / §5 I-CHILD-FAM / §9 新設 |
| **10** | 削除カスケード/grace-period/ダウングレード archival 未モデル。AccountLifecycle 状態機械 + I-PURGE + ダウングレード archival | **AccountLifecycle**（active→soft-deleted(grace)→{restored\|purged}、猶予日数はプラン層）を C1 に追加。**I-LIFECYCLE / I-PURGE（他家族非到達）/ I-DOWNGRADE** を §5 新設。**裏取り訂正**: ダウングレード archival は**自動でなく保護者選択制**（上限内に収まる選択のみ成立）と実装事実で訂正 | §3.1 / §5 I-LIFECYCLE I-PURGE I-DOWNGRADE / §6 AccountLifecycle / §7 L-21 |
| **11** | Q-05 スタンプカード同一性の留保が L-12 自然識別を破壊。季節カードを scope 外確定して I-CHECK-1WK を現行不変条件に採る（推奨） | **推奨採用**: 季節カードを Pre-PMF scope 外と確定（§7 L-13）、**I-CHECK-1WK を現行不変条件に格上げ**（子供×週の自然同一性を保持）。I-STAMP-1DAY の多義化を回避 | §5 I-CHECK-1WK I-STAMP-1DAY / §7 L-12 L-13 / §8.1 Q-05 |
| **12** | 交換申請↔ごほうび: reward 側を任意参加に。I-REDEEM-CONSUME（承認=負 ledger 1 件）+ I-BAL-NONNEG（残高非負・承認は残高十分時のみ） | ER の SPECIAL_REWARD—REDEMPTION_REQUEST を **0..1:N（任意参加、削除後も申請存続）** に変更。**I-REDEEM-CONSUME（承認=種別 reward_redemption の負エントリ 1 件）/ I-BAL-NONNEG** を §5 新設。裏取り: 消費種別は `reward_redemption`、残高十分性を承認時に強制 | §3.4 ER + 注記 / §5 I-REDEEM I-REDEEM-CONSUME I-BAL-NONNEG / §6 RewardExchange |
| **13** | 関係欠落: CHECKLIST_OVERRIDE の対象(テンプレ/項目)+対象日 / PARENT_MESSAGE の送信者(parent/owner) | CHECKLIST_OVERRIDE を「子供×対象日の項目増減（操作/項目名/アイコン）」と §3.4 で明確化（特定テンプレに紐づかない子供×日の実効調整と確定）。PARENT_MESSAGE に **MEMBERSHIP(role=parent/owner) → 送信者** 関係を追加、**I-MSG-SENDER** 新設 | §3.4（override）/ §3.5（送信者）/ §5 I-MSG-SENDER |

---

## 2. [should] への対応

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| 契約状態遷移 I-SUB（trial→active→past_due→canceled、trialUsedAt 二度取り禁止） | **I-SUB** 新設（状態遷移系列 + トライアル二度取り禁止）。SUBSCRIPTION_STATE に契約状態 enum + トライアル使用日時 | §3.1 / §5 I-SUB / §6 SubscriptionState |
| User.provider の 'cognito' リテラル → 「認証プロバイダ（値集合）」概念語化 | §2 読み替え行追加。§6 で `provider: AuthProvider`（値集合）とし特定ベンダ名を概念から排除 | §2 / §3.1 / §6 |
| 「soft link」→「業務参照（弱い参照）」概念語化 | POINT_LEDGER_ENTRY の由来参照を「弱い業務参照」と表記 | §3.3 |
| I-CONS「物理消去は唯一の例外」の scope を consent 限定に明示（retention 衝突回避） | I-CONS に「物理消去はアカウント完全削除時の consent 消去に限る唯一の例外。retention は consent を対象にしない」を明記 | §5 I-CONS |
| webhook 冪等イベントを Q-01 材料として明示 | 課金イベント冪等観測点をグローバル参照に残し、Q-01 の将来課金複雑度材料として §8.1 に明記 | §4.1 §4.2 / §8.1 Q-01 |

---

## 3. 未決論点の決裁（board 収束）反映

| # | 決裁 | 反映 | 台帳注記 |
|---|---|---|---|
| Q-01 | A（契約=Family 属性 1:1） | §3.1 §4.2 §6 §8.1 | — |
| Q-02 | A（User 独立参照） | §4.2 §6 §8.1 | — |
| Q-03 | A（別概念）+ **N-1 BIRTHDAY_REVIEW 永続化裏取り** | §8.1 §8.2 / §7 L-20 | **裏取り結果: 未配線**（型 + 生成 DDL のみ、書込/読取ゼロ）→「将来概念（未実装）」として除外。実装済み誕生日概念は BirthdayBonus（台帳種別 birthday_bonus）と判明し §3.3 に反映 |
| Q-04 | A（単独参照/検索/集計 or 他概念参照で展開）+ 実 read 裏取り | §2 §7 L-04 L-18 §8.1 | settings 由来概念にも適用。証書付帯情報・戦闘ステータスは不透明で値オブジェクト |
| Q-05 | 季節カード scope 外で I-CHECK-1WK 採用 | §5 §7 L-12 L-13 §8.1 | [must]#11 と一体 |
| Q-06 | A（戦闘ステータス=値オブジェクト） | §3.4 §8.1 | — |
| Q-07 | A（現行 single、要石扱い） | §3.1 §9 §8.1 | [must]#9 と一体 |
| Q-08 | A（additive 欠落許容、再導出は状態なし効果に限定） | §5 I-ADD I-STREAK-VS-COMBO §8.1 | [must]#7 と一体 |
| Q-09 | A（同意 IP/UA 保持 + データ最小化注記） | §3.1 §5 I-CONS §8.1 §8.2 | 最小化は §8.2 残存論点（法務確認） |
| Q-10 | A（カテゴリ global 固定 5 軸） | §3.2 §4.2 §8.1 | — |

---

## 4. 実装裏取りで board 前提を訂正した点（誠実性の記録）

board の [must] のうち、実コード裏取りで**前提が実装と異なると判明**した 4 点は、指摘の趣旨（概念の欠落を埋める）を満たしつつ**事実側に訂正**して反映した（推測でなく実測を優先）:

| board 前提 | 実装事実（裏取り） | 反映 |
|---|---|---|
| ボーナスは POINT_LEDGER に `bonus` 種別を追加 | ボーナス点は独立台帳エントリでなく **activity エントリの額に畳み込まれる**（`bonus-hook-service` → `streakBonus`/multiplier 経由）。独立 additive 種別は combo_bonus/weekly_bonus/birthday_bonus | §3.3 種別集合 / §7 L-19 / §5 I-REC |
| ダウングレード超過は自動アーカイブ（クロス集約規則） | **保護者が選択したものだけ**をアーカイブ（`downgrade-service`、上限内に収まる選択のみ成立） | §5 I-DOWNGRADE / §7 L-21 |
| BirthdayReview は live 概念 | **未配線**（型 + 生成 DDL のみ、repo/schema/writer ゼロ）。実装済みは BirthdayBonus | §7 L-20 / §8.1 Q-03 / §8.2 |
| 保護者ゲート session を永続概念化 | 署名セッションは **無状態（cookie ベース）** で永続概念でない。永続するのは PIN 資格・ロック状態のみ | §2 注 / §7 L-14(c) L-15 |

---

## 5. DB 非依存制約の遵守確認

- テーブル/列/PK/索引/正規形/JSON/uuid/認証ベンダ名等の物理・ベンダ語をドメイン記述（§1〜§9 の ER・class・不変条件）に持ち込んでいない。
- 物理語が現れるのは §2 読み替え規則（物理→概念の対応表として）と §10 M3 委譲境界（意図的に「M3 の責務」として言及）に限定。
- `AuthProvider` は値集合の概念語で扱い、特定ベンダ名リテラルを排除。
