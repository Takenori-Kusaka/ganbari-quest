# M1 概念モデル Round 2 レビュー 応答台帳

> **目的**: M1 レビュー Round 2 board（3 独立観点）の finding に対し「どう対応し、どこに反映したか」を 1:1 でトレースする。
> **対象成果物**: `docs/design/dsql/m1-conceptual-model.md`（Round 2 rework）。
> **前提**: Round 1 の [must]13 は全解消確認済、事実訂正 4 点も裏取り一致（board 評価）。Round 2 は rework が成長経済領域に生んだ新規 [must] + 過剰主張 1 件が対象。
> **凡例**: 反映箇所は §番号 / L番号（§7）/ I番号（§5）。

---

## 0. 構造アンカー（[must]1〜3 連鎖解決）

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| **PointLedger を Child スコープ直下の独立集約に昇格**（「台帳=GrowthJournal 所有」を廃止）。消費（負）は PointLedger 内同期整合＝overspend 不能、付与（正）は結果整合、I-BAL/I-BAL-NONNEG を PointLedger に一本化。§4 集約横断=結果整合 総則 ⇄ I-BAL-NONNEG の矛盾を解消 | §4 全面に PointLedger 独立集約を新設。GrowthJournal から点数を分離（成長状態=記録/ステータス/習熟のみ）。**消費=同期・付与=結果整合**の分離を §4 intro / §4.2 / §4.3 / §5 I-BAL-NONNEG / §6 class に明記 | §4.1 §4.2 §4.3 / §5 I-BAL I-BAL-NONNEG / §6 PointLedger class / §3.3 |

---

## 1. [must]（Round 2、3 観点統合）への対応

| # | [must] 指摘（観点） | 対応内容 | 反映箇所 |
|---|---|---|---|
| **1** | [skeptic B + DA A] ポイント台帳の越境整合矛盾 → PointLedger 独立集約化。§4/§4.3 に「消費は PointLedger 内同期／付与は結果整合」明記 | PointLedger を独立集約に昇格。**consume（reward_redemption/convert）= 残高読取→負エントリ append を集約内 atomic ＝ overspend 不能**（I-BAL-NONNEG は PointLedger 強不変条件）。**award = 各衛星集約から結果整合で要請**（非負制約なし）。§4.3 で I-REC から点数を外し「付与要請」に変更 | §4 intro / §4.2（PointLedger 行 + GrowthJournal 縮小行）/ §4.3 / §5 I-BAL I-BAL-NONNEG / §6 |
| **2** | [skeptic A + domain A] 台帳種別 taxonomy の実装乖離 + 虚偽の「裏取り済」ラベル。全種別を実 grep で網羅列挙 or「代表例・完全集合は M3」と明記して過剰主張撤回。C7 由来点数事象を no-silent-gap で記述 | **実 grep（`src/lib/server/services` + `db`）で網羅列挙**: 付与14（activity/combo_bonus/weekly_bonus/birthday_bonus/login_bonus/checklist/stamp_card/stamp_instant/child_challenge/daily_mission/focus_bonus/must_completion_bonus/cheer/initial_setup）+ 消費3（reward_redemption/convert/cancel・checklist_cancel）+ 繰越1（carryover）。**「この grep scope での網羅であり taxonomy freeze は M3」と明記**し「裏取り済=完全」の過剰含意を撤回。C7 習慣装置由来（stamp/checklist/login/challenge/mission/focus）を PointLedger 付与事象として全列挙 | §3.3 種別集合（全面書き換え）/ §3.3 mermaid enum |
| **3** | [domain B] convert を「表示上の換算」に矮小化。convert は残高不足チェック + 負 convert エントリの実消費オペ。C6 に消費オペとして概念化、PointConversionPolicy は表示/レート方針として分離 | **ポイント換金（convert）を第 2 の消費オペレーションとして概念化**（reward_redemption と並ぶ）。残高不足拒否 + 負エントリ 1 件 + PointLedger 経由。**PointConversionPolicy は換金額算定の入力（別概念）と分離**、実残高を減らすのは換金オペと明記。I-CONVERT-CONSUME + I-CONSUME（消費経路統一則）新設 | §3.4（convert 消費オペ + PointConversionPolicy 分離）/ §5 I-CONSUME I-CONVERT-CONSUME / §6 |
| **4** | [DA B] Family 巨大集約（解体原則の Family 不適用）。追記ログ + 独立ライフサイクル資源を Family 参照の衛星集約に降格。Family ルートは不変条件概念のみ。Child 衛星注記と対の Family 衛星注記を追加 | **Family を縮小**（不変条件概念のみ: 所属/招待/契約/保護者ゲート/同意現在値/家族方針）。**追記専用ログ（通知/利用/同意追記/トライアル/解約理由）+ 独立資源（購読/閲覧リンク/エクスポート/卒業同意）を Family 参照の衛星集約に降格**。§4.1 Family 行 + §4.2 Family 縮小行 + **Family 衛星集約注記（Child 衛星注記と対）** を追加。通知購読の membership 参照 / carryover は PointLedger 内 も明記 | §4 intro #4 / §4.1 / §4.2 Family 行 + Family 衛星注記 |
| **5** | [DA C] §9 図文一致の未完。mermaid が `USER \|\|--\|{ MEMBERSHIP`（1..N）で上限 1 を encode せず。`\|\|--\|\|` に直すか §9 文言を記法に合わせて修正 | §3.1 mermaid を **`USER ||--|| MEMBERSHIP`（1 利用者=ちょうど 1 所属）に修正**。§9 文言を「mermaid を `||--||` に修正して記法と文言を一致」に更新、将来 M:N は記法を緩めると明記 | §3.1 mermaid / §9 |

---

## 2. [should] への対応

| 指摘 | 対応 | 反映箇所 |
|---|---|---|
| I-MSG-SENDER に intra-family 制約追加（送信者家族=受信子供家族、I-CHEER と対称） | I-MSG-SENDER に「送信者の所属家族＝受信子供の家族」を追加 | §5 I-MSG-SENDER |
| must_completion_bonus / masteryBonus の畳込み/独立の別を明記（masteryBonus は activity 畳込み、must_completion_bonus は独立 additive） | §3.3 種別集合で masteryBonus=activity 畳込み / must_completion_bonus=独立 additive と明記。I-REC 行にも同旨を追記（裏取り: activity-log-service:203 で masteryBonus は totalPoints へ畳込み、activity-service:408 MUST_COMPLETION_BONUS_TYPE は独立） | §3.3 / §5 I-REC |
| Evaluation を §4.2 集約一覧に Child 所有衛星として明示列挙 | Child 衛星注記に「週次評価（Evaluation、weekly_bonus を PointLedger へ要請）」を明示列挙 | §4.2 Child 衛星注記 |
| push subscription の購読元 membership 参照 / carryover を生む retention compaction を §4 に明記 / past_due を業務語に寄せる余地（note 級） | Family 衛星注記に「通知購読は購読元の所属（membership）を参照」「carryover を生む retention compaction は PointLedger 集約内の操作」を明記。past_due の業務語寄せを §8.2 残存論点（note 級）に追加 | §4.2 Family 衛星注記 / §8.2 |

---

## 3. 実 grep による裏取りの記録（過剰主張の是正）

Round 2 [must]2 の趣旨（「裏取り済/網羅」は実 grep 確認時のみ書く）に従い、以下を**実コード grep で確認**してから記述した:

| 確認事項 | grep 根拠 | 記述への反映 |
|---|---|---|
| 点数台帳 type の完全集合 | `src/lib/server/services` + `db` を `type: '…'` で全走査（activity-log/checklist/stamp-card/login-bonus/combo/daily-mission/evaluation/birthday-bonus/cheer/recommendation/point-service/reward-redemption/child-challenge/activity-service 各サービス）| §3.3 に「この grep scope での網羅、freeze は M3」と scope 明示。過剰含意撤回 |
| convert が実残高消費 | `point-service.ts:95-125`（残高不足 INSUFFICIENT_POINTS 拒否 + `amount: -amount, type: 'convert'` 挿入） | §3.4 convert=消費オペ / §5 I-CONVERT-CONSUME |
| masteryBonus 畳込み vs must_completion_bonus 独立 | `activity-log-service.ts:203`（totalPoints = base + streakBonus + masteryBonus）/ `activity-service.ts:408`（MUST_COMPLETION_BONUS_TYPE 独立エントリ） | §3.3 / §5 I-REC |
| carryover 生成元 | `dsql/point-repo.ts:176`（removedSum → 'carryover'、retention compaction） | §3.3 繰越 / §4.2 Family 衛星注記（PointLedger 内操作） |
| child_challenge が台帳 type | `child-challenge-service.ts:805`（type: 'child_challenge'） | §3.3 付与 14 種に含む |

**過剰主張を出さないための注記**: grep scope は services + db に限定したため、「この scope での網羅」と明記し、絶対的完全性（他レイヤ含む全数）は主張していない。taxonomy の恒久 freeze は M3 の責務と明示。

---

## 4. DB 非依存制約の遵守確認

- テーブル/列/PK/索引/正規形/JSON/uuid/認証ベンダ名等の物理・ベンダ語をドメイン記述（§1〜§9 の ER・class・不変条件）に持ち込んでいない。
- 物理語が現れるのは §2 読み替え規則と §10 M3 委譲境界に限定。
- 「網羅／裏取り済」は §3.3 で grep scope を明示した上でのみ使用（過剰主張禁止を遵守）。
