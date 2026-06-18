# 0055. Per-child 主軸 + 限定 family master データモデル原則 (6 type SSOT)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-23 |
| 起票者 | Dev session (Claude) |
| 関連 Issue | EPIC #2362 (PO 4 問題の構造的解決、CLOSED) / 派生 I1 #2445 / I2 #2446 / I3 #2447 / I4 #2448 |

## 1. コンテキスト

EPIC #2362 は `MarketplaceTypeRegistry + Strategy` の **実装統一** (ADR-0052) を解決したが、**5 type が "何 scope で持たれるか" のデータモデル原則は SSOT 化されていない**。実装現場では type ごとに per-child / family master が混在し、それぞれ歴史的経緯で選択されてきた:

| Type | 現状 scope | 経緯 |
|---|---|---|
| activity | family master + `age_min/max` で per-child visibility | 初期実装、「同年齢には同じ教育方針」前提 |
| checklist | per-child instance (#2137 MP-2) | #1755 (#1709-A) で持ち物純化、child 別 instance に固定 |
| reward (exchange) | per-child instance (`special_rewards.child_id` NOT NULL) | 子供別目標が自然、初期から per-child |
| rule (bonus) | family-wide tenant scope (`settings` KVS) | 家族共通 ルール、KVS で十分 |
| rule (exchange) = 特別ルール | per-child + プラグイン的拡張 | 機能未収束、Pre-PMF Bucket C |
| challenge | family-wide (`sibling_challenges`、全 child auto-enroll) | 兄弟前提の命名で 1 人っ子家庭に違和感 |

PO 集計 (`tmp/user-question/2026-05-23-customer-use-case-data-model-qa.md`、6 type × 各 3-8 use case で User 判定) の結果、**「親管理目線でもどこまでも子供主体であるべき」「年齢フィルタは marketplace 側のみで、親管理画面では子供別管理に統一」**が原則として確定した。本 ADR は 6 type すべてに対する scope 選択原則を SSOT 化し、後続 PR (PR-3〜7) の判断基準とする。

## 2. 検討した選択肢 (3 案、#1350 OSS / 確立パターン先調査整合)

### 選択肢 A (採用): Per-child instance 主軸 + 限定 family master pattern

- **OSS / 確立パターンの実装例**:
  - **Cozi Family Organizer**: <https://www.cozi.com/> — family share calendar に対して to-do / 買い物 list を「assigned to <member>」属性で per-child 化、家族共有と個別最適化を両立する 15 年運用 (3000 万家庭)
  - **Greenlight (子供向け fintech)**: <https://greenlight.com/> — chore / allowance は per-child instance、家族 master は決済ルールのみ。SAT 評価で 12 歳〜 18 歳の autonomy 育成を per-child 設計で実現
  - **Apple Family Sharing**: <https://www.apple.com/family-sharing/> — Screen Time / Ask to Buy / Apple Cash は per-child 設計、Music / Storage 等の "全員で 1 個" のみ family master
  - **DDD Vernon "Implementing Domain-Driven Design" Ch.10 Aggregates**: per-child instance = Aggregate Root with `childId` reference → 整合性境界が child に閉じる、cross-child invariant 不要
- **メリット**:
  - **customer use case 集計と一致** (User §1 直接指針)、6 type × 25 use case の判定で per-child 採用が family master を上回る (集計 §5)
  - **privacy 強化** (CWE-598 排除): marketplace 側に child 情報が一切流れない sequence を取れる (本 ADR §5 取込フロー参照)
  - **「他子のコピー」「全員に追加」等の bulk 操作で UI 工夫が可能** で、複数子家庭の煩わしさを solve できる
  - **DDD Aggregate Root が child に閉じる** → cross-child invariant 不要、Repository が単純化
  - **family master も限定 2 type (checklist template / bonus rule) で残す** → 「家族共通が自然な物」だけ master、無理に統一しない
- **デメリット**:
  - per-child instance 化で row 数増加 (1 人っ子家庭で 3 倍、5 人家庭で 15 倍 — 但し Pre-PMF 規模では絶対数小)
  - 「全員に同じ activity を一括追加」操作の UI 工夫が必要 (PR-3 で取込ダイアログに「全員」default option を実装)
- **Pre-PMF コスト (ADR-0010)**:
  - 機構コード ~150 行 (本 ADR は docs only、実 schema 変更は PR-3〜7)
  - bundle 影響ゼロ (DDD pattern application、追加 npm 依存なし)
  - 学習コスト 低 (per-child = `childId` FK 追加のみ、業界標準パターン)
  - **Bucket B** (動線改善 / customer use case 直結、ADR-0010 §3.2)

### 選択肢 B (棄却): 全 type family master + visibility chip

- 概要: 既存 `activities` model を 6 type 全てに横展開。`*_visibility` 中間テーブルで per-child ON/OFF を表現
- 採用実績: 一般的な multi-tenant SaaS (Slack channel / Notion page) で見られる pattern
- メリット: master 1 件追加で全 child に伝播、row 数を抑えられる
- デメリット:
  - User §1 直接指針「親は子供別カスタマイズしたい」と矛盾
  - visibility chip ≠ per-child custom: たろう用「バレエレッスン」を ひな に出さない設定はできるが、「たろう専用の point レート」「ひな専用の age 適合性微調整」等の per-child カスタマイズが master 構造では表現できない
  - cross-child invariant が master 側に bind され、1 子削除で master 整合性チェック発火 (子供卒業時の archive 操作が複雑化)
- Pre-PMF: **Bucket C** (visibility chip UI 実装コスト + cross-child invariant 維持の追加 service コードが overkill)

### 選択肢 C (棄却): Hybrid (master + per-child override)

- 概要: master を持ちつつ各 child が override row を追加する 2 層構造 (例: CMS の i18n base + locale override)
- 採用実績: WordPress multisite、Strapi localization
- メリット: master 共通 + 個別 override の両立
- デメリット:
  - **3 ラウンド連続誤実装の原因** (#2441 v1 / #2442 closed deep research / #2443 revert): 「family master 主軸 + override」を提案するたびに User が「親は子供主体で考える」と修正、framing bias が rationalization を生む
  - override row の管理が複雑 (delete master 時の cascade / override 残存の挙動が type ごとに変わる)
  - Pre-PMF 段階で必要十分な機能性に対して overkill
- Pre-PMF: **Bucket C** (override layer は PMF 後の bulk edit 要件が立ち上がってから検討)

## 3. 決定

**A を採用** (per-child instance 主軸 + 限定 family master pattern)。

### 3.1 6 type の scope 適用 SSOT

詳細は別 docs [data-model-resource-scope.md](../design/data-model-resource-scope.md) §1 を参照。本 ADR は原則のみ。

| Type | 採択 scope | aggregate root | 主根拠 (use case ID) |
|---|---|---|---|
| **activity** | per-child instance | `ChildActivity` | A1-A7 集計、親は子供別カスタマイズしたい |
| **checklist** | family master template + per-child progress | `ChecklistTemplate` (family) + `ChecklistProgress` (child) | C1-C7 集計、「保育園じゅんび」等 template は家族共有が自然 |
| **reward (exchange)** | per-child instance | `ChildReward` | R1-R7 集計、子供別目標 / 別レート / 独立 progress |
| **rule (bonus)** | family master (tenant scope) | `BonusRule` | RB1-RB3 集計、家族全体ルール (現状維持) |
| **rule (exchange) = 特別ルール** | **削除予定** (I1 #2445) | — | Pre-PMF Bucket C、複雑度 > 価値 (User §5 直接判断) |
| **challenge** | per-child instance + UI 工夫 | `ChildChallenge` | CH1-CH3 集計、1 人っ子家庭でも自然、「兄弟」表現を UX 工夫で再現 (I2 #2446) |

### 3.2 Marketplace 取込時の child binding ルール

- **marketplace 側で child 情報を一切持たない** (privacy CWE-598 排除、`?childId=X` 等 URL/body 露出 0)
- 「取込」button → 親管理画面遷移 → ダイアログ「誰に追加? / 全員?」表示 → per-child instance として登録
- family master type (checklist template / bonus rule) は「全員」default を選んでも 1 record で済む

詳細 sequence は別 docs [marketplace-import-flow.md](../design/marketplace-import-flow.md) §3 を参照。

### 3.3 既存 ADR との関係

- **ADR-0052 (Strategy + Registry)** と相補的: 本 ADR は **scope 選択原則**、ADR-0052 は **実装統一機構**。両者は直交し supersede しない
- **ADR-0046 (Service Interface + Context DI)**: per-child service が child 別 context 注入される際の DI パターンとして再利用
- **ADR-0047 (Demo / 本番 UI Contract)**: 実装 PR-3〜7 で demo 同期必須。本 ADR は docs only のため影響なし
- **ADR-0031 (ADR-0023 廃案 + 帰属マップ、tenant isolation 整合)**: per-child instance も `tenantId` 必須を維持 (Repository SSOT、ADR-0052 §「tenant isolation 強制」と整合)

### 3.4 UI 表示軸は 3 資源とも child 主軸に統一 (#3096 / #3098、データ scope とは別レイヤー)

データ scope (§3.1) は資源ごとに異なる (activity / reward = per-child instance、checklist = family master template + assignments) が、**admin 管理画面の UI 表示軸は 3 資源 (活動 / ごほうび / チェックリスト) すべて child 主軸 (`per-child-tabs`) に統一する** (NN/G #4 consistency、利用者 mental model の不統一を解消)。

- **UI 統一とデータ scope は別レイヤー**: checklist は family master template を維持したまま、「子供タブ = 選択中 child に配信済み (assignments) の template」を per-child view として表示する。template は tenant 1 レコードのまま (子ごとに重複作成しない)、assignments で表示を絞るだけ。
- **追加 / 取込導線**: 3 資源とも `ChildSelectionDialog`「どのお子さまに?」で配信 / 取込先の子供を選ぶ (`binding: 'child-selection-dialog'`)。checklist の VisibilityChipGroup は配信先編集 dialog の二次導線に降格 (page top の主軸入口には置かない)。
- **兄弟共通化**: 活動同様「別の子から取り込む」copy 導線 (= source child の配信 template を選択中 child の assignments に追加) で行う。
- UI 表示軸 / binding の宣言 SSOT は `src/lib/features/admin/admin-resource-model-registry.ts`、契約は `tests/e2e/admin-resource-layout-contract.spec.ts` (fitness function) が CI で照合する。

## 4. 結果

- 後続 PR (PR-3〜7) は本 ADR §3.1 表を参照して schema 変更方針を判定可能
- `MarketplaceTypeRegistry` (ADR-0052) に登録される各 Strategy は本 ADR の scope 選択と整合した `apply(payload, ctx)` を実装
- Pre-PMF (Bucket B): customer use case 起点で「親が子供主体で管理する」原則を SSOT 化、3 ラウンド連続誤実装 (#2441 / #2442 / #2443) の根本原因 (framing bias) を構造的に排除
- 1-in-1-out (README §10 枠超過時の義務): TOP 10 actual active 数は 27 件超で既に大幅超過、本 PR では追加のみ。1-in-1-out 履行は別 follow-up Issue (#1924 系の継続棚卸) で扱う

## 5. 関連

- EPIC #2362 (PO 4 問題の構造的解決、CLOSED)
- 派生 I1 #2445 (rule exchange 削除)、I2 #2446 (challenge per-child + LP)、I3 #2447 (祖父母 viewer)、I4 #2448 (複数 parent)
- ADR-0010 (Pre-PMF Bucket B)
- ADR-0052 (MarketplaceTypeRegistry + Strategy)
- ADR-0046 (Service Interface + Context DI)
- [data-model-resource-scope.md](../design/data-model-resource-scope.md) (6 type scope 表 SSOT)
- [marketplace-import-flow.md](../design/marketplace-import-flow.md) (取込フロー sequence SSOT)
