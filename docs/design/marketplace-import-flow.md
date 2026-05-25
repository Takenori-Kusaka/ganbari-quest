# marketplace-import-flow.md — Marketplace 取込フロー sequence SSOT

| 項目 | 内容 |
|------|------|
| 関連 ADR | [ADR-0055](../decisions/0055-per-child-primary-data-model-pattern.md) (per-child 主軸 + 限定 family master) / ADR-0052 (Strategy + Registry) / ADR-0031 (ADR-0023 廃案 + 帰属マップ、tenant isolation 整合) |
| 関連 Issue | EPIC #2362 / 派生 I1 #2445 / I2 #2446 |
| 更新タイミング | 取込フロー変更 / 取込時の child binding ルール変更 / privacy 関連の URL/body 露出ポリシー変更時 |

---

## 1. 設計背景

### 1.1 privacy 要件 (CWE-598、User §7 直接指針)

User 直接判断 (`tmp/user-question/2026-05-23-customer-use-case-data-model-qa.md` §7.3):

> M1: 未認証で marketplace を browse、家族や子供情報は一切露出しない。これは必須。理由は LP からマーケットプレイスにどんなものがあるか、という紹介リンクがあるため
> M2: 認証後の marketplace でも、child name は URL/body に出さない。認証外で見れているマーケットプレイスに自分の子供の名前が出てきたらびっくりする。私なら直ちにアプリをアンインストールしデータ削除をクレームとして入れる

要求: **marketplace は public surface**。URL / body / query / response の **どこにも `childId` / `nickname` を露出させない**。`?childId=X` / `?presetId=Y&childId=Z` 等の URL パラメータも禁止。

### 1.2 UX 要件 (User §1 直接指針)

> 親管理画面で先にインポートしたい子供を選んでそこからみんなのテンプレートへ移動する、というフローをすると、誰を選んでいたのか忘れてしまいます。なのでマーケットプレイスから選んで親管理画面に戻ってきたときに、誰に追加するか、全員に追加するか、という選択肢がダイアログ上出て登録される、が望ましいのではないでしょうか

要求: **child 選択は marketplace 通過後の AdminApp 側ダイアログでのみ実施**。事前選択 → marketplace 巡回 → 戻り の動線は採用しない。

---

## 2. 設計原則

### 2.1 marketplace は child 情報を持たない (Bounded Context 分離)

| Context | scope | child 情報 |
|---|---|---|
| **Marketplace** | public discovery | **持たない** (CWE-598 排除) |
| **AdminApp** | family-scoped (PIN gate 通過後) | 取込ダイアログで child binding を決定 |
| **ChildExperience** | per-child (子供画面) | per-child instance として登録された後のみ表示 |

DDD Anti-Corruption Layer: Marketplace → AdminApp 遷移で Marketplace 側の `MarketplaceItem` 型 を AdminApp 側の `ImportedResource<T>` 型に変換。Marketplace 仕様変更が AdminApp に直接影響しない。

### 2.2 取込ダイアログの SSOT 化

「誰に追加 / 全員」のダイアログ UI は **AdminApp 側 1 箇所のみで実装** (PR-2 Framework で抽象化)。各 type の取込フロー (`activity-pack` / `reward-set` / `checklist` / `rule-preset` / `challenge-set`) は同じダイアログを呼び出す。

### 2.3 family master type の "全員" default 挙動

`checklist` / `rule-preset` 等の family master type も同じダイアログを表示。ただし default 選択を「全員」に置き、ダイアログ side で 1 record 登録に集約 (per-child instance type と同じ UX、内部は 1 record で済む)。

---

## 3. 取込フロー sequence

### 3.1 全 type 共通の取込フロー

```
[親管理画面 /admin/*]
    │ FAB「+追加」 → menu「みんなのテンプレ」
    ▼
[marketplace 一覧 /marketplace]
    │ child 情報なし (privacy 保証)
    │ search / filter / category 等のみ
    ▼
[marketplace 詳細 /marketplace/{typeCode}/{itemId}]
    │ child 情報なし
    │ 「取込」button (child 選択 UI 配置しない)
    ▼ クリック
[親管理画面に遷移 /admin/{type}?import={itemId}]
    │ ImportContext に tenantId のみ詰めて遷移
    ▼
[ダイアログ「誰に追加? / 全員?」表示]
    │ per-child instance type: child 選択必須
    │ family master type: 「全員」default、個別配信も選択可
    ▼ user 決定
[ImportStrategy.preview(payload, ctx)] (ADR-0052)
    │ N 件追加 / M 件重複スキップ を事前提示
    ▼ user 確認
[ImportStrategy.apply(payload, ctx)] (ADR-0052)
    │ per-child instance を登録 (or family master 1 record)
    ▼
[親管理画面で即一覧反映 + 成功 toast]
```

### 3.2 per-child instance type の登録挙動 (activity / reward / challenge)

ダイアログで child 選択 → 選択された各 child に対して `ImportStrategy.apply` が `childId` を `ImportContext` に詰めて呼ばれる:

```typescript
// 概念例 (実装は PR-3〜7 各 type 内)
for (const childId of selectedChildIds) {
  await strategy.apply(payload, { tenantId, childId, dryRun: false, presetId });
}
```

ダイアログ「全員」選択時は family の全 active child を順次 apply。

#### activity-pack 取込フロー (EPIC #2362 PR-3 Phase 5 で実装済)

activity-pack は `MarketplaceTypeDescriptor.requiresChildSelection: true` を宣言する代表 type。
本 PR の実装で以下の動線が CWE-598 整合となっている:

| user 状態 | marketplace 詳細 CTA href | 遷移先動作 |
|---|---|---|
| 未認証 | `/auth/login?next=/admin/activities?import=<itemId>` | login 後 admin/activities に遷移 → ChildSelectionDialog auto-open |
| 認証済 + 子供登録済 (≥ 1) | `/admin/activities?import=<itemId>` | admin/activities 上で ChildSelectionDialog auto-open (`?import=` query を `$effect` で検出) |
| 認証済 + 子供未登録 (= 0) | `/setup/children` | 子供登録後に再 visit する想定 |

**実装位置** (本 PR で更新):
- `src/routes/marketplace/[type]/[itemId]/+page.svelte` (activity-pack CTA 3 分岐)
- `src/routes/(parent)/admin/activities/+page.svelte` (`?import=<presetId>` → `bind:open` で ChildSelectionDialog auto-open、Phase 4 で実装)
- `src/routes/(parent)/admin/activities/+page.server.ts` action `importPackToChildren` (`dispatchImport` ctx に `childIds: 'all' | [n,...]` を注入、Phase 4)

**CWE-598 補強検証**:
- `tests/e2e/marketplace-activity-pack-no-childid.spec.ts` (Phase 5 新規、4 AC)
- `tests/unit/routes/marketplace-auth-redirect.test.ts` (Phase 5 で Phase 5 仕様に同期 + childId 0 件 grep 追加)

reward-set は per-child instance type だが、現状 (Phase 5 時点) marketplace 詳細で form の `childId` 受領が残っている。Phase 6/7 で activity-pack と同型の admin redirect 動線に統一する予定。

challenge-set は **#2362 PR-7 (ADR-0055、User §6) で activity-pack と同型の per-child instance + admin redirect 動線に統一済**:
- marketplace 詳細 `?marketplace-import=<presetId>` で `/admin/challenges` に遷移 (childId URL に出さず、CWE-598 整合)
- admin/challenges 側 `importMarketplaceChallengeSet` action が `childIds` body 必須 + ChildSelectionDialog 経由で per-child instance 作成
- `MarketplaceTypeDescriptor.requiresChildSelection: true` を challenge-set にも追加 (本 PR で flip)
- 同じ source preset から作成された複数 child instance は `source_template_id: 'challenge-set:<presetId>:<title>'` を共有し、admin/challenges 画面で `SiblingChallengeComparison.svelte` により兄弟連動表示される
- family-only plan-gate は本 PR 維持 (LP/pricing 整合性確認は別 PR #2457 plan-limit と連携)

#### reward-set 取込フロー (EPIC #2362 PR-4 で実装済)

reward-set も `MarketplaceTypeDescriptor.requiresChildId: true` を宣言する per-child instance type。本 PR の実装で以下の動線が CWE-598 整合となっている (activity-pack と同型):

| user 状態 | marketplace 詳細 CTA 押下後 | 遷移先動作 |
|---|---|---|
| 未認証 | `/auth/login?redirect=/marketplace/reward-set/<itemId>` | login 後 marketplace 詳細に戻る |
| 認証済 + 子供登録済 (≥ 1) | `/admin/rewards?import=<itemId>` | admin/rewards 上で ChildSelectionDialog auto-open (`?import=` query を `$effect` で検出) |
| 認証済 + 子供未登録 (= 0) | 「お子さま未登録」誘導表示 | 子供登録後に再 visit する想定 |

**実装位置** (本 PR で更新):
- `src/routes/marketplace/[type]/[itemId]/+page.svelte` (reward-set CTA: child 選択 UI を削除、submit のみ)
- `src/routes/marketplace/[type]/[itemId]/+page.server.ts` action `importRewardSet` (`?import=<itemId>` redirect、`childId` form data 受領撤去)
- `src/routes/(parent)/admin/rewards/+page.svelte` (`?import=<presetId>` → `bind:open` で ChildSelectionDialog auto-open)
- `src/routes/(parent)/admin/rewards/+page.server.ts` action `importPresetToChildren` (`dispatchImport` ctx に `childIds: 'all' | [n,...]` を注入)
- `src/lib/marketplace/strategies/reward-set-strategy.ts` (`narrowChildContext` で discriminated union `child-selection` / `legacy-single` に narrow)
- `src/lib/server/services/reward-set-import-service.ts` (`importRewardSetToChildren` で per-child fan-out)

**兄弟共通化 (PR-3 と同型)**:
- `src/lib/server/services/child-reward-copy-service.ts` (`copyChildRewardsToSiblings` / `copyChildRewardsToSibling`、source の reward 全件を target child に複製、同一 title は skip)
- admin/rewards 「他の子供から copy」 dialog から呼出

**CWE-598 補強検証**:
- `tests/e2e/admin-rewards-per-child.spec.ts` (本 PR 新規、child 排除 + per-child UX 検証)

### 3.3 family master type の登録挙動 (checklist / rule bonus)

ダイアログで「全員」default → 1 record として `ImportStrategy.apply(payload, ctx)` 呼出 (`ctx.childId` は undefined)。配信先 child は `checklist_template_assignments` 等の中間 table に書き込む (詳細は [data-model-resource-scope.md](data-model-resource-scope.md) §4.2)。

ダイアログで個別配信を選んだ場合は、family master 1 record + 配信先 child の assignment row のみ追加。

---

## 4. privacy 検証チェックリスト (各 PR で確認)

PR-2 (Framework) 以降、marketplace 関連 PR は以下を必ず確認:

- [ ] marketplace 系 URL (`/marketplace/**`) に `childId` / `nickname` パラメータが含まれていないこと (E2E spec で grep 検証)
- [ ] marketplace API response body に `childId` / `nickname` field が含まれていないこと (Valibot schema #2364 で禁止)
- [ ] marketplace 系 page の DOM に `data-child-id` / child name が出力されていないこと (Playwright で getByText 否定検証)
- [ ] AdminApp 遷移時の query string (`?import={itemId}`) には `itemId` のみで `childId` が含まれていないこと
- [ ] 取込ダイアログのみが `childId` を扱い、それ以前の routing / 状態管理に child 情報を露出させていないこと

CWE-598 (Information Exposure Through Query Strings in GET Request) 整合。

---

## 5. UnifiedImportHub との関係 (EPIC #2362 L2)

EPIC #2362 で実装済の `UnifiedImportHub` (#2370 / PR #2384) は **type 選択 + 取込実行 hub**。本ドキュメントの sequence は UnifiedImportHub 内でダイアログ表示を呼び出す形に統合される。

PR-2 (Framework) で取込ダイアログコンポーネントを `src/lib/marketplace/ui/` 配下 (既存 `UnifiedImportHub.svelte` / `UnifiedEmptyState.svelte` と並ぶ) に追加し、UnifiedImportHub から呼び出す。各 strategy はダイアログ完了後に `apply()` を実行。

---

## 6. 関連

- [ADR-0055](../decisions/0055-per-child-primary-data-model-pattern.md) (per-child 主軸原則)
- [data-model-resource-scope.md](data-model-resource-scope.md) (6 type scope SSOT)
- [marketplace-architecture.md](marketplace-architecture.md) (Strategy + Registry アーキ)
- [14-セキュリティ設計書.md](14-セキュリティ設計書.md) (CWE-598 / privacy 関連の全社方針)
- [parallel-implementations.md](parallel-implementations.md) (並行実装ペア一覧)
