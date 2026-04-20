# ADR-0024: プラン解決 (resolvePlanTier) の責務分離パターン

> **archived (2026-04-20)**: no longer active-primary, kept for historical reference (#1262 sub-B)


| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-11 |
| 起票者 | Takenori-Kusaka |
| 関連 Issue | #748, #725, #726, #727, #728, #732, #788 |
| 関連 ADR | ADR-0003（設計書 SSOT）, ADR-0015（Repository パターン） |

## コンテキスト

`src/lib/server/services/plan-limit-service.ts` には、テナントの現在のプランティア（`free` / `standard` / `family`）を求めるための関数が **4 つ** 存在する:

| 関数 | 同期/非同期 | 引数 | 返り値 | 用途 |
|------|-----------|------|--------|------|
| `resolvePlanTier` | 同期 | `licenseStatus, planId?, trialEndDate?, trialTier?` | `PlanTier` | 低レベルな純粋関数（引数を全部渡す） |
| `resolveFullPlanTier` | 非同期 | `tenantId, licenseStatus, planId?` | `Promise<PlanTier>` | トライアル情報を DB から読んでから `resolvePlanTier` を呼ぶ高レベル関数 |
| `isPaidTier` | 同期 | `tier: PlanTier` | `boolean` | standard / family の判定 |
| `getPlanLimits` | 同期 | `tier: PlanTier` | `PlanLimits` | プラン別の制限値（maxChildren 等）取得 |

これらの使い分けが設計書・ADR で明文化されていなかった結果、以下の不具合・デグレが複数発生した:

### 過去の failure

| Issue | 問題 | 原因 |
|-------|------|------|
| **#725** | `admin/+layout.server.ts` で `resolvePlanTier` を呼ぶ際に `trialTier` 引数を渡し忘れ、トライアル中にファミリー体験ユーザーが standard 扱いになる | 低レベル API を直接呼んだ。trialTier が optional 引数のため型エラーが出なかった |
| **#726** | `admin/+page.server.ts` で `resolvePlanTier` の呼び出し自体が欠落 | どこで解決すべきか明文化されておらず、書き忘れた |
| **#727** | `/api/v1/activities/suggest` でプランチェックが無防備 | プランチェックが必要な API/action の一覧がない |
| **#728** | `admin/rewards` の action で 400 を返し、`tier` 情報なし | エラー形式が統一されておらず、どのヘルパーを使うべきか不明 |
| **#732** | ファイルごとに三項演算子のやり方が違う | 「プラン判定ロジックは関数を通す」という規約がない |

### 根本原因

1. **どの関数をどの層で呼ぶべきかの規約がない** — server load, action, service 内部、UI の 4 層でそれぞれ「正しい呼び方」が異なる
2. **trial_history の参照が複数箇所に散在** — `resolvePlanTier` 呼び出し側が `trialEndDate` / `trialTier` を取得するコードを重複実装している
3. **optional 引数による暗黙の fallback** — `trialTier?` を渡し忘れても型エラーにならないため、#725 のような事故が起きる
4. **「プラン判定が必要な箇所」のチェックリストがない** — 新規 API 追加時にプランチェックを忘れても CI で検知されない

## 決定

### 1. 層ごとの唯一の呼び出し API

各層で使う関数を **1 つに固定** する。他の関数を直接呼ぶことを禁止する。

| 層 | 使用可能な関数 | 禁止事項 |
|----|--------------|---------|
| **server load / action（`+page.server.ts`, `+layout.server.ts`, `+server.ts`）** | `resolveFullPlanTier(tenantId, licenseStatus, planId)` のみ | `resolvePlanTier` を直接呼ばない。`trialEndDate` / `trialTier` を呼び出し側で取得しない |
| **service 内部の判定（`$lib/server/services/**`）** | `resolveFullPlanTier` または `getPlanLimits(tier)` | 呼び出し側から tier を受け取るのが望ましい（テスト容易性）。service 内で再度 resolve するのは service 境界を跨ぐ判定のみ |
| **UI コンポーネント（`src/routes/**/+page.svelte`, `$lib/features/**/components`）** | props として `planTier: PlanTier` を受け取る | コンポーネント内でプラン解決をしない。`locals.context` などサーバー側 API を UI から触らない |
| **ヘルパー / 純粋関数内部** | `resolvePlanTier` 低レベル API | 引数を全て与えること。optional 引数に依存しない |

### 2. 単一ソース原則

- `trial_history`（`getTrialEndDate` / `getTrialTier`）の参照は **`resolveFullPlanTier` の内部でのみ** 行う
- 他のファイルから直接 `getTrialEndDate` / `getTrialTier` を呼ぶことを禁止する
- 理由: #725 のような「呼び出し側で trial 情報の取得を忘れる」事故を構造的に防ぐため

### 3. `resolvePlanTier` を直接呼ばない理由

低レベル API `resolvePlanTier` は以下の条件で **のみ** 直接呼んでよい:

- `resolveFullPlanTier` の実装内部
- Unit test での mock 経由の呼び出し
- すでに `trialEndDate` / `trialTier` が確定している純粋な値計算（例: スナップショットベースの判定）

それ以外の場所で `resolvePlanTier` を直接呼ぶ場合は、**必ず `resolveFullPlanTier` に置き換える**。ESLint カスタムルール（将来）で検知する。

### 4. プランチェックが必要な箇所のチェックリスト

新規 API / action / load 関数を追加するときは、以下の判定フローに従う:

```
テナントのデータを書き込む/読み込む？
  └─ Yes → プラン制限の対象？（無料プランには出せない機能？）
       ├─ Yes → load の冒頭で resolveFullPlanTier を呼び、getPlanLimits(tier) で判定
       │        制限超過なら error(403, { code: 'PLAN_LIMIT_EXCEEDED', currentTier, requiredTier }) を投げる
       └─ No → プラン解決不要
```

プラン制限の対象機能一覧は `docs/design/19-プライシング戦略書.md` の「プラン別機能表」が正。新機能追加時はこの表も同時更新すること（ADR-0003）。

### 5. エラー形式の統一

プラン制限超過時のエラーは `PLAN_LIMIT_EXCEEDED` コードで統一する（#744 で仕様化予定）:

```typescript
type PlanLimitError = {
  code: 'PLAN_LIMIT_EXCEEDED';
  currentTier: PlanTier;
  requiredTier: 'standard' | 'family';
  reason: string;
  upgradeUrl: '/admin/license';
};
```

`fail(400)` や生の `error(403, '...')` ではなく、この形式で返す。フロントが「どのプランにすればよいか」を表示できるようにするため。

## 結果

### 期待される効果

- #725 / #726 のような「引数忘れ」「呼び出し忘れ」の事故を構造的に防止
- 新規開発者・AI エージェントが「どの関数を呼べばよいか」で迷わない
- trial 情報の参照が 1 箇所に集約され、トライアル仕様変更時の影響範囲が限定される
- service 層のユニットテストが容易になる（tier を引数で受け取るパターン）

### トレードオフ

- 既存コード（`admin/+layout.server.ts`, `admin/license/+page.server.ts`）は依然として `resolvePlanTier` を直接呼んでいる。ESLint ルール導入までは規約依存で対処する
- `resolveFullPlanTier` は DB 2 往復（trial_end / trial_tier の fetch）が必須なため、パフォーマンス観点では低レベル API の方が軽い。ただし Pre-PMF 段階ではユーザー数が少なく、可読性・安全性を優先する
- 同一リクエスト内で複数の load/service から `resolveFullPlanTier` が呼ばれるため、本番 DynamoDB では N+1 になる懸念があった → **#788 で request-scoped memoize を導入し解決（下記追記参照）**

### 6. 同一リクエスト内の memoize パターン (#788)

**背景**: admin 配下では `(child)/+layout.server.ts` / `admin/+layout.server.ts` / `admin/**/+page.server.ts` / 内部サービスが独立に `resolveFullPlanTier` を呼ぶため、素朴に実装すると 1 リクエストで `trial_history` に 3〜6 回 SELECT が飛ぶ。本番 DynamoDB では RCU コスト・レイテンシの温床になる。

**採用した解決策**: `src/lib/server/request-context.ts` に `AsyncLocalStorage` ベースのリクエスト単位キャッシュを実装し、`hooks.server.ts` の `handle` 全体を `runWithRequestContext(...)` で包む。`resolveFullPlanTier` と `getTrialStatus` は呼ばれるたびに現在のコンテキストからキャッシュを引き、ヒットすれば DB を叩かない。

```text
handle
└─ runWithRequestContext(async () => {
       await resolveFullPlanTier(...)   ← 1回目: DB hit → cache set
       await resolveFullPlanTier(...)   ← 2回目以降: cache hit
       // layout / page.server / service のどこから呼ばれても同じ
   })
```

**キャッシュキー**:
- `getTrialStatus`: `tenantId`
- `resolveFullPlanTier`: `${tenantId}::${licenseStatus}::${planId ?? ''}`

**なぜ ALS なのか**:
- `event.locals` に planTier を先置きする案は、`resolveFullPlanTier` 呼び出し元 55 箇所すべてを「locals 経由に書き換える」必要があり、広大なリファクタになる。ALS は呼び出し元を一切変更せず透過的に最適化できる。
- action ハンドラは `parent()` アクセス手段がないので、どうしても `resolveFullPlanTier` を直接呼ばざるを得ない。ALS ならこのケースも同じリクエスト内ならキャッシュが効く。

**無効化**:
- `startTrial` で trial_history を insert した直後は `invalidateRequestCaches(tenantId)` でキャッシュを破棄。同一リクエスト内で startTrial → getTrialStatus の順で呼ばれても stale な値を返さない。
- `account-deletion-service` の trial_history 削除時も同様に invalidate（防衛的）。

**規約**:
- `resolveFullPlanTier` / `getTrialStatus` に新しい引数を追加する時は、`request-context.ts` のキャッシュキーにも反映すること。反映漏れは異なる引数で同じキャッシュを返す事故になる。
- trial_history に insert/update/delete を追加した場合、直後に `invalidateRequestCaches(tenantId)` を呼ぶ。
- バックグラウンドジョブ（cron、queue worker 等）からは ALS コンテキスト外で呼ばれるため、キャッシュは効かない（`getRequestContext()` が undefined を返し、キャッシュをスキップする）。これは意図した挙動。

### 既存呼び出しの段階的移行

- `resolvePlanTier` を直接呼んでいる既存ファイル（`admin/+layout.server.ts`, `admin/license/+page.server.ts`）は、別 Issue で `resolveFullPlanTier` に段階的に置換する
- ただし #725 の修正で `trialTier` 引数は正しく渡されているため、緊急度は低い

## 教訓

- **関数のオーバーロード（低レベル + 高レベル）は、どちらを呼ぶべきか明文化しないと必ず事故が起きる** — 型システムは「引数を渡し忘れた」事故を防げても「どちらの関数を選ぶべきか」は防げない
- **optional 引数は「忘れても動く」を生む** — 本来必須であるべき値を optional にすると、必ずどこかで渡し忘れる。型で必須化するか、別関数にする
- **「規約はコードで強制するまで信用しない」** — ADR で書いただけでは守られない。ESLint カスタムルール・テストヘルパー・CI チェックのいずれかで強制する仕組みが必要
- **DB 参照を含む判定は、層の境界で 1 度だけ行う** — load 関数で解決した tier を props として渡す方が、コンポーネントで再度 resolve するより安全かつ高速
