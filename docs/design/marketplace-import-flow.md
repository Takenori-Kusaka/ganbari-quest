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

#### 取込実行中の loading 表示 (#2632、NN/G #1 visibility of system status)

`ChildSelectionDialog` の取込確定ボタンは `confirmLoading` prop で「取込実行中」を visible 表示する。各 admin 画面 (`?import=` 受領) の `handleChildSelectionConfirm` は async 取込 fetch の await 中 `isImporting=true` を set し、`confirmLoading={isImporting}` + `closeOnConfirm={false}` で dialog を渡す。これにより:

- confirm ボタンが spinner + `disabled` + `aria-busy="true"` 化し「処理中である」を機械的に伝える (再クリック誤動作防止)
- 実行中は cancel / backdrop / Esc / ✕ による close を抑止 (`closable={!confirmLoading}`)、処理完了後 (finally) に親が `open=false` する
- 実体は `src/lib/ui/primitives/Button.svelte` (`loading` prop) + `ChildSelectionDialog.svelte` (`confirmLoading` prop) + 各 admin `+page.svelte` (`isImporting` state)。詳細は `docs/DESIGN.md §5`「Button の `loading` prop」参照

### 2.3 family master type の "全員" default 挙動

`checklist` / `rule-preset` 等の family master type も同じダイアログを表示。ただし default 選択を「全員」に置き、ダイアログ side で 1 record 登録に集約 (per-child instance type と同じ UX、内部は 1 record で済む)。

---

## 3. 取込フロー sequence

### 3.1 全 type 共通の取込フロー (5 type 統一、#2774)

**取込 CTA 統一形式** (#2774 / #2775):

全 5 type (activity-pack / reward-set / checklist / rule-preset / challenge-set) の認証済
取込 CTA は **`<a href="/admin/<page>?import=${itemId}">`** 形式に**完全統一**する (marketplace 詳細 page の
server action は 0 件)。admin 側 server load は
**`?import=<presetId>` query** を一律に読取り、ChildSelectionDialog auto-open する。

| type | marketplace 詳細 CTA href | admin 側 query 読取り | testid (統一命名) |
|---|---|---|---|
| activity-pack | `/admin/activities?import=${itemId}` (+`indexes=` subset) | `?import=` | `activity-pack-import-cta` |
| reward-set | `/admin/rewards?import=${itemId}` | `?import=` | `reward-set-import-cta` |
| checklist | `/admin/checklists?import=${itemId}` | `?import=` | `checklist-import-cta` |
| rule-preset bonus | `/admin/settings/rules?import=${itemId}` | `?import=` | `rule-preset-import-bonus-cta` |
| rule-preset exchange (#2775) | `/admin/rewards?import=${itemId}` | `?import=` | `rule-preset-import-cta` |
| challenge-set | `/admin/challenges?import=${itemId}` | `?import=` | `challenge-set-import-cta` |

**rule-preset exchange 統一 (#2775、Issue #2774 Phase 2)**: special_rewards table への per-child
取込を admin/rewards 側 ChildSelectionDialog 経由で受領するよう mechanism を拡張済。`?import=` server
load が rule-preset (exchange) を判別し、`importPresetToChildren` action は item type を見て
reward-set Strategy (`dispatchImport`) または rule-preset Strategy (`rulePresetStrategy.applyRulePreset`)
に分岐する。**5 type 完全統一達成** = marketplace 詳細 page の server action は 0 件。

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
    │ `<a href="/admin/<page>?import=${itemId}">` 取込 CTA (child 選択 UI 配置しない)
    ▼ クリック (直接 navigation、server action 経由なし)
[親管理画面に遷移 /admin/{page}?import={itemId}]
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

##### #2745 (CX bug-5) 取込完了時 Toast feedback + 2 重防御 (2026-06-01)

POC #2693 EPIC #2724 Round 18 で「activity-pack 取込完了後に何のフィードバックも表示されない」(CX bug-5) が顧客指摘として記録された。これを構造的に解消するため、activity-pack 取込フロー完了時に以下 3 件を実装した。

| 項目 | 内容 | 実装 SSOT |
|---|---|---|
| **Toast success feedback** | 取込完了時に `Toast.svelte` primitive 経由で 3 秒自動消滅の success toast を表示 (`role="alert"`、ARIA live region)。本文は `ADMIN_ACTIVITIES_PAGE_LABELS.importSuccess(count)` / `.importAllDuplicates` (件数動的表示)。type は imported > 0 で `'success'`、dedup all skip で `'info'` | `src/routes/(parent)/admin/activities/+page.svelte` `handleChildSelectionConfirm()` 内 `showToast()` 呼出 |
| **2 重防御 (Toast + banner)** | Toast (`role="alert"`) が一次 feedback、in-page banner (`actionMessage` / `role="status"`、`data-testid="admin-activities-action-message"`) が同期 fallback。Toast は module-level `$state` push で reactive 更新されるが、`await invalidateAll()` 後の DOM 反映と micro-task chain race で E2E `expect(toast).toContainText(...)` が 5s timeout を踏むケースがあるため、同期 set される banner を保険として残す。a11y 上も alert / status の 2 live region で screen reader への確実な伝達を担保 | 同 page `actionMessage = message; showToast(message, ...)` の同期 2 重 set |
| **`x-sveltekit-action: true` header 必須化** | SvelteKit form action を `fetch('?/<actionName>', { method: 'POST', ... })` で叩く際は **`x-sveltekit-action: 'true'` + `accept: 'application/json'`** header 必須。これらを付与しないと SvelteKit が ActionResult 形式 (`{type: 'success', data: ...}`) ではなく HTML / redirect を返し、`deserialize(await resp.text())` が throw → 後続の showToast / dialog close / state reset が全て skip され dialog open のまま停止する dead-end になる (#2748 E2E #2745 fail 真因)。admin/rewards `importPresetToChildren` も同型のため、新規 marketplace 取込 callsite はこの 2 header を SSOT として必ず付与する | 同 page `fetch('?/importPackToChildren', { headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }, ... })` |

**safety net**: `try/catch` で SvelteKit deserialize / network exception を捕捉し、想定外 throw 時も `actionMessage = ADMIN_ACTIVITIES_PAGE_LABELS.importFailed` (in-page banner) + `finally` 内で `pendingImportPresetId = null; showChildSelectionDialog = false;` で dialog を必ず close する。これにより「動作したが結果不明」を残しつつ dead-end を回避 (Anti-engagement ADR-0012 整合)。

**他 type への波及方針**: reward-set (`admin/rewards/importPresetToChildren`) も既に `x-sveltekit-action` header + ActionResult deserialize の同型実装。checklist / rule-preset / challenge-set の admin 動線で fetch ActionResult 経由を採用する場合、本 SSOT 3 件 (Toast + 2 重防御 + `x-sveltekit-action` header) を必ず複製すること。

##### `?import=<presetId>` auto-open 後の dialog 再 open 防止 (consumed latch、#2773 後 bug1 spec 検出)

`?import=<presetId>` で `ChildSelectionDialog` を auto-open する `$effect` は `data.importPresetId`
(load 由来) を読む。confirm / cancel 後に **`await invalidateAll()` が `?import=` 残存 URL のまま
load を再走させると `data.importPresetId` が依然 truthy** のため effect が再発火し dialog が
即 再 open する (取込済なのに dialog が出続ける dead-end ループ)。これを防ぐため、auto-open する
admin page (`?import=` を `await invalidateAll()` と併用する page) は **`consumedImportPresetId`
ラッチ** を持ち、confirm / cancel 時に処理済 presetId を記録して同一 presetId の再 open を抑止する:

```svelte
let consumedImportPresetId = $state<string | null>(null);
$effect(() => {
	if (
		data.importPresetId &&
		data.importPresetId !== consumedImportPresetId && // 処理済 presetId は再 open しない
		!showChildSelectionDialog &&
		pendingImportPresetId === null
	) {
		pendingImportPresetId = data.importPresetId;
		showChildSelectionDialog = true;
	}
});
// confirm / cancel handler 冒頭: consumedImportPresetId = pendingImportPresetId;
```

実装位置: `src/routes/(parent)/admin/checklists/+page.svelte` (#2773 後 dead-end 再発を
`tests/e2e/demo-lambda/bug1-import-dead-end.spec.ts` の dialog close assert で検出)。`?import=` +
`invalidateAll()` を併用する他 admin page (rewards 等) で同パターンが必要になった場合は本ラッチを複製する。

##### Round 18 Cluster H (#13/#16/#20/#25/#28) subset 取込 (2026-06-02)

Round 18 Round 3 評価で「30 件一括取込で個別選択不可」「既存重複 activity の事前説明なし」「3 歳児親には 30 件は多すぎる」が 5 件 (Cluster H) 表面化した。これに対し、activity-pack 詳細での **subset 選択 UI + 既存重複 detection + 件数連動 CTA** を導入する (PR scope: activity-pack のみ、他 type は別 Issue)。

| 動線要素 | 修正内容 | 実装位置 |
|---|---|---|
| **既存活動 fetch** | marketplace 詳細 `load` で `type === 'activity-pack'` のときに `findActivities(tenantId)` を呼び、`existingActivityNames: string[]` を unique 集約して返す。`getAllChildren` 取得と同じ try/catch で囲み、tenant 解決失敗時は空配列 fallback | `src/routes/marketplace/[type]/[itemId]/+page.server.ts` `load` |
| **subset 選択 UI** | activity-pack の preview list 各行に checkbox を追加。既存活動と name match した行は default unchecked + 「登録済み」 badge (`MARKETPLACE_LABELS.detailActivityPackAlreadyExistsBadge`)、それ以外は default checked。「すべて選ぶ / すべて外す」ボタンで一括変更 | `src/routes/marketplace/[type]/[itemId]/+page.svelte` activity-pack branch |
| **件数連動 CTA** | `selectedCount` (`$derived`) を CTA 文言に反映 (`MARKETPLACE_LABELS.detailCtaImportActivityPackSelected(count)`)。`selectedCount === 0` のときは disabled (`MARKETPLACE_LABELS.detailActivityPackSelectedZero` 文言、誤遷移防止) | 同上 |
| **subset URL 渡し** | CTA href を `/admin/activities?import=<itemId>&indexes=<csv>` 形式に拡張。全件選択時 (`selectedCount === totalCount`) は `indexes` 省略で後方互換維持。CWE-598 (childId 露出禁止) は崩れない (`indexes` は SSOT 内 activity 配列の index = 機微情報ではない) | `importUrlWithSubset` `$derived` |
| **subset query 受領** | admin/activities `load` で `?indexes=<csv>` を parse し `importSelectedIndexes: number[] \| null` として返す。空 / 未指定 / 不正値は null (= 全件 / 後方互換) | `src/routes/(parent)/admin/activities/+page.server.ts` `load` |
| **subset action 送信** | ChildSelectionDialog confirm 時、`data.importSelectedIndexes` が空でなければ `selectedIndexes` (CSV) を `FormData` に追加して `?/importPackToChildren` に POST | `src/routes/(parent)/admin/activities/+page.svelte` `handleChildSelectionConfirm` |
| **subset payload slice** | `importPackToChildren` action で `selectedIndexes` を parse → unique 化 → `source.payload.activities` を index で slice してから `dispatchImport` に渡す。subset 結果が 0 件なら fail 400 (`'取り込む活動が選択されていません'`) | 同 `+page.server.ts` `importPackToChildren` action |

**dedup 連携**: subset で選んだ activity が target child 側で既に存在する場合、`activity-import-service.ts` の per-child dedup (`#2558`) で skip される。subset slice + per-child dedup の 2 段防御で、preschool 親「既存と重複する activity の事前説明なし」(Cluster H #25) と「個別選択不可」(#20) を同時解決する。

**CWE-598 整合性検証**:
- URL に乗るのは `import=<itemId>` (公開 SSOT 識別子) + `indexes=<csv>` (公開 activity 配列 index) のみ
- childId は依然として ChildSelectionDialog 経由でのみ確定 (URL/body 直接受領なし)
- subset slice 結果も payload 内に直接含まれ、URL に乗らない

#### per-child type の重複判定 (dedup) scope ルール (#2558、必読)

**per-child instance type (activity / reward / challenge) の import 重複判定は必ず child 単位で行う。** tenant 全体での dedup は禁止。

- **正**: 各 target child の既存 activity / reward 名 (title) を `findActivitiesByChild(childId, …)` / `findSpecialRewards(childId, …)` で読み、「その child に同名が既にある時だけ、その child への追加を skip」する。
- **誤 (退行)**: `findActivities(tenantId)` 等の tenant aggregate で名前 Set を作り、tenant 内のどこか 1 人でも同名を持つと全 child で skip する。これは **「1 人目に取込済のパックを 2 人目に取込むと全 skip → imported:0 → UI 上『追加を押しても無反応』」** という顧客クレーム退行を生む (#2558、`#2458-A1` の activity facade rewrite で混入した実害)。
- 各 type の dedup 実体:
  - `activity-import-service.ts` `importActivities` — `buildExistingNamesByChild()` で child ごとの既存名 Set を構築 (#2558 修正)。
  - `reward-set-import-service.ts` — `findSpecialRewards(childId, tenantId)` で child 単位 (元から正しい)。
  - `challenge-set-import-service.ts` `importChallengeSet` — そもそも import 段階で skip を発火せず常に per-child instance を child 数分作成する (#2488)。tenant-wide の重複検知は `previewChallengeSetImport` の表示集計のみで、import を block しないため本退行は起きない。
- **family master type (checklist / rule-preset) は tenant 単位 dedup が正しい** (per-child instance ではないため、§3.3 参照)。これは変更対象外。
- 回帰テスト: `tests/unit/services/activity-import-service.test.ts` §「#2558 per-child dedup 回帰」 + `tests/e2e/admin-activities-per-child.spec.ts` の goal 完遂テスト (1 人目に取込済 → 2 人目に取込 → 2 人目に活動が追加される)。

challenge-set は **#2362 PR-7 (ADR-0055、User §6) で activity-pack と同型の per-child instance + admin redirect 動線に統一済 + #2774 で query 名を 5 type 統一**:
- marketplace 詳細 `?import=<presetId>` で `/admin/challenges` に遷移 (childId URL に出さず、CWE-598 整合)
- admin/challenges 側 `importMarketplaceChallengeSet` action が `childIds` body 必須 + ChildSelectionDialog 経由で per-child instance 作成
- `MarketplaceTypeDescriptor.requiresChildSelection: true` を challenge-set にも追加 (本 PR で flip)
- 同じ source preset から作成された複数 child instance は `source_template_id: 'challenge-set:<presetId>:<title>'` を共有し、admin/challenges 画面で `SiblingChallengeComparison.svelte` により兄弟連動表示される
- family-only plan-gate は本 PR 維持 (LP/pricing 整合性確認は別 PR #2457 plan-limit と連携)

**#2554 follow-up CUJ-CH2 完全化 (本 PR、2026-05-29)**: 上記 #2362 PR-7 動線のうち、`/admin/challenges` 側の **ChildSelectionDialog auto-open 配線が長期未実装**だった (data.marketplaceImport を受領するが UI ハンドラ無し、CUJ-CH2 が partial だった構造的原因)。本 PR で activities/rewards と同型の以下を移植して完全化:
- `+page.svelte`: `ChildSelectionDialog` import + `?marketplace-import=<presetId>` を `$effect` で検出して auto-open + `handleChildSelectionConfirm` で `?/importMarketplaceChallengeSet` に CSV 形式で POST
- `+page.server.ts` load: `importPresetId` / `importPresetInvalid` を export (rewards `?import=` 同型、dialog auto-open trigger 用)
- `+page.server.ts` action `importMarketplaceChallengeSet`: CSV (`childIds=1,2,3` or `'all'`) 受領サポート追加 (旧 `getAll('childIds')` repeated 形式は後方互換維持) + **CWE-598 guard 追加** (`tenantChildren` の ID set に含まれない `childId` を 1 件でも検出すると 403 reject、admin-rewards `importPresetToChildren` 同型)
- CUJ-CH2 の E2E 検証 (旧 `admin-challenges-import-marketplace.spec.ts`) は CUJ-A3 / CUJ-R2 と同型の完全 terminal goal verify に upgrade されていた
- `src/lib/domain/labels.ts` `ADMIN_CHALLENGES_PAGE_LABELS`: `importSuccess / importAllDuplicates / importFailed / importDemo / importInvalidPreset` を追加 (admin-rewards 同型)

> **#2896 (2026-06-11 PO 判断)**: marketplace を活動 / ごほうび / チェックリストの 3 type に絞る方針に伴い、challenge-set は陳列対象外とし唯一の preset (japan-annual-events) を廃止した。これにより上記 marketplace 経由のチャレンジ取込 (CUJ-CH2) は撤去し、検証 spec も削除した。`challenge-set` の型 / schema / Registry 登録 / `?import=` 受領経路は互換のため残置 (valid preset 不在時は invalid guidance を表示)。チャレンジ機能本体 (自作 + auto-challenge) は `/admin/challenges` に保持。陳列方針・顧客価値は [44-チャレンジ設計書.md](44-チャレンジ設計書.md) を参照。

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

ダイアログで「全員」default → `ImportStrategy.apply(payload, ctx)` を `ctx.childIds = [全 child id]` で呼出 → family master 1 record + 配信先 child 全員分の `checklist_template_assignments` row を 1 transaction で作成。

ダイアログで個別配信を選んだ場合は `ctx.childIds = [選択された child id]` で同様、配信先 child の assignment row のみ追加。

ダイアログで誰も選ばなかった場合 (空配列) は family master 1 record のみ作成 (assignment 0 件)、後で admin/checklists の ChecklistDistributionDialog から配信先を設定可能。

#### 3.3.1 checklist 専用フロー (PR-5 Phase 2、ADR-0055)

```
marketplace/checklist/[itemId]
  ↓ submit (childId なし)
303 redirect: /admin/checklists?import=<itemId>
  ↓ admin load 時 ?import= query 検出
ChildSelectionDialog auto-open (allowMultiple=true)
  ↓ 「全員」or 個別 child 選択 → confirm
?/importPresetToChildren action (childIds='all' or CSV)
  ↓ dispatchImport('checklist', ctx={tenantId, presetId, childIds})
  ↓ checklistStrategy.apply()
importChecklistTemplateForFamily(presetId, tenantId, {childIds})
  ↓ family master template + assignments 一括作成 (1 transaction)
```

**CWE-598 / privacy 保護**: marketplace ↔ admin の遷移で childId / nickname が URL / form body に一切露出しない。child 情報は admin の ChildSelectionDialog 内のみで扱う。

**ctx.childId は受付撤去** (Phase 2): legacy-single-binding ctx は撤去済 (`checklist-strategy.ts` から `importChecklistTemplate` (per-child legacy API) call は削除)。新規 callsite は必ず `ctx.childIds` 経由で呼ぶ。

**配信先設定の事後変更**: admin/checklists の各 template card 内の「配信先を設定」ボタン → `ChecklistDistributionDialog` → `VisibilityChipGroup` で chip toggle → `?/syncDistribution` action で差分計算 (`syncDistribution()` service 経由) → assignment 追加/解除。

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

## 5. UnifiedImportHub との関係 (EPIC #2362 L2 / #2558 段階2 admin/activities / 段階3 残 4 type 撤去)

EPIC #2362 で実装済の `UnifiedImportHub` (#2370 / PR #2384) は **type 別の marketplace preset 一覧 (browse) + file source を埋め込む in-page hub**。

### 5.1 #2558 段階2 (activities) / 段階3 (残 4 type): 全 5 type で admin 内 browse UI 撤去 (マーケットプレイス一本化完遂)

顧客クレーム (bug-3「追加メニュー内に『パックから追加』という見知らぬ用語」/ bug-4「『パックから追加』がマーケットプレイスに行かず独自 UI を開く」+ User 直接指摘「親管理画面で簡単なマーケットプレイス画面があるなど見た瞬間に指摘される」) を受け、PO 方針「**マーケットプレイス (みんなのテンプレート) で内容確認 → インポート → 親管理画面に取り込み、に一本化する。親管理画面内にマーケットプレイス風の簡易画面を出さない (二重管理)**」に従い、**全 admin 画面 (`activities` / `rewards` / `challenges` / `checklists` / `settings/rules`) の in-page browse UI を撤去**した (DESIGN.md §10 構造的ルール明示禁忌)。

- 各 admin 画面の「みんなのテンプレートから探す」link / menu 項目は `/marketplace?type=<typeCode>` へ**画面遷移**する (§3.1 の正規 sequence に合流)。in-page の marketplace 風ブラウズ UI は出さない。typeCode 対応: activities → `activity-pack` / rewards → `reward-set` / challenges → `challenge-set` / checklists → `checklist` / settings/rules → `rule-preset`。
- 旧 `UnifiedImportHub` の **file source セクション (`?/importFile` による JSON/CSV 復元)** は marketplace とは別概念のため、admin/activities では `︙` overflow menu の「バックアップから復元」項目 + 専用ダイアログとして**独立保持**した (`OVERFLOW_MENU_TERMS.itemRestore` 経由)。他 admin 画面では現状 file 復元 UI を提供していない (必要に応じて follow-up Issue で同 pattern 横展開)。
- `UnifiedImportHub.svelte` component 自体は **本 PR の admin 画面群からは参照されなくなった** が、Storybook story / unit test (`tests/unit/marketplace/ui/UnifiedImportHub.test.ts`) / 将来の用途 (LP 経由公開ブラウズ等) のため component 自体は削除せず存続させる (knip での dead-code 検出が出るか別 Issue で判断)。

### 5.2 ChildSelectionDialog auto-open mechanism (5 type 共通の正規取込経路、#2774)

各 admin page の server load は **`?import=<presetId>` query を 5 type 統一で validation** (activities /
rewards / checklists / settings-rules / challenges) し、page svelte 側の `$effect` で
`ChildSelectionDialog` を auto-open する mechanism を保持する。全 5 type で `?import=` に揃っている (5 type 取込導線完全統一)。

Marketplace 詳細 → `<a href="/admin/<page>?import=${itemId}">` 直遷移 → admin 画面で
ChildSelectionDialog auto-open → child binding 決定 → server action へ POST、が正規経路 (§3.1)。
marketplace 詳細 page の server action は持たない (`<a>` 直遷移)。

---

## 6. 関連

- [ADR-0055](../decisions/0055-per-child-primary-data-model-pattern.md) (per-child 主軸原則)
- [data-model-resource-scope.md](data-model-resource-scope.md) (6 type scope SSOT)
- [marketplace-architecture.md](marketplace-architecture.md) (Strategy + Registry アーキ)
- [14-セキュリティ設計書.md](14-セキュリティ設計書.md) (CWE-598 / privacy 関連の全社方針)
- [parallel-implementations.md](parallel-implementations.md) (並行実装ペア一覧)
