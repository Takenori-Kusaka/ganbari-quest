# 0040. 実行モード × ライセンス統括アーキテクチャ (Typed env + EvaluationContext + Policy Gate)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-19 |
| 起票者 | Takenori Kusaka |
| 関連 Issue | #1180（前身）、本 ADR で新設する Epic Issue |
| 関連 ADR | ADR-0024（プラン解決責務分離）、ADR-0025（License ↔ Stripe 因果）、ADR-0026（ライセンスキー）、ADR-0029（Safety Assertion Erosion Ban）、ADR-0034（Pre-PMF セキュリティ最小化）、ADR-0039（デモモード統合）|

## コンテキスト

本プロダクトは 5 つの実行モードで同じコードベースを駆動する。

| # | モード | 起動 | 認証 | データ永続化 |
|---|------|------|------|-------------|
| 1 | **build** | `npm run build` / SSR prerender | なし | なし |
| 2 | **demo** | `?mode=demo` / `gq_demo=1`（ADR-0039） | 非認証 | in-memory |
| 3 | **local-debug** | `npm run dev` / `npm run dev:cognito` | 自動認証 or Cognito mock | SQLite |
| 4 | **aws-prod** | Lambda + DynamoDB | Cognito + Google OAuth | DynamoDB |
| 5 | **nuc-prod** | ローカル NUC + SQLite | Cognito（オプションでライセンスキー） | SQLite + ライセンスキー検証 |

加えて、各モード内でユーザーのライセンスプラン（free / standard / family / trial-expired / ops）によって**機能ゲート・UI 差分・API 認可**が分岐する。

### 現状の問題（「実行モード × ライセンス」の散在）

`src/hooks.server.ts` + `src/lib/server/auth/**` + `src/lib/domain/license-*` + 各 route の `+page.server.ts` に分岐ロジックが散在している。以下の構造欠陥が観測される。

1. **env 参照の散在** — `process.env.NODE_ENV` / `AUTH_MODE` / `COGNITO_DEV_MODE` / `DEBUG_PLAN` / `APP_MODE` / `IS_NUC_DEPLOY` / `OPS_SECRET_KEY` 等が 30 箇所以上で直接参照される（type safety なし）
2. **モード × プランの組合せ test matrix が存在しない** — E2E は単一モード × 単一プランでしか走らない。`mode=nuc-prod × plan=family_monthly × licenseKey=expired` のような境界が未検証
3. **機能ゲート判断が 3 層に分離** — a) hooks の認可 / b) `+page.server.ts` の load ガード / c) Svelte コンポーネントの `{#if canXxx}`。SSOT が無い
4. **ADR-0024 のプラン解決ロジック**は整ったが、それを **"ある capability を行使できるか" に射影する関数**は存在しない
5. **ADR-0029（Safety Assertion Erosion Ban）が守りにくい** — required env がコードの任意箇所に `throw new Error('X required')` で散らばっているため、PR 差分から「新しい required env が増えたか」を機械判定しにくい

ADR-0039 でデモモードを "実行モード" として昇格させた。次のステップは**全 5 モード × ライセンスプラン**を同一フレームで統括することである。

## 検討した選択肢

### 選択肢 A: 現状維持（分散した条件分岐）
- メリット: 移行コストゼロ
- デメリット: 上記 5 点の構造欠陥が解消しない。ADR-0039 の効果が限定的。新機能追加ごとに分岐箇所が増える

### 選択肢 B（採用）: 3 層ハイブリッド（Typed env + EvaluationContext + Policy Gate）
内部アーキテクチャのみで解決する。外部 SaaS（Vercel Flags, LaunchDarkly, Stripe Entitlements）は導入しない。
- メリット: Pre-PMF（ADR-0034）と整合。NUC 本番（インターネット切断運用）でも動く。依存追加が Zod のみ
- デメリット: 設計・移行に 5 フェーズ必要

### 選択肢 C: OpenFeature SDK（標準仕様フル準拠）
- メリット: 将来 LaunchDarkly 等に差し替え可能
- デメリット: Pre-PMF で過剰。NUC モード（外部接続なし）で flag provider が動かないリスク

### 選択肢 D: CASL / Oso / Cedar などの capability-based authz ライブラリ
- メリット: policy が宣言的になる
- デメリット: 学習コストと「機能ゲート + UI 差分」の統一表現が難しい。Svelte 5 Runes との統合例が薄い

### 選択肢 E: Stripe Entitlements API
- メリット: ライセンス = capability を Stripe 側で管理可能
- デメリット: NUC モード（オフライン）で不可。ADR-0025（License ↔ Stripe 因果）の因果性を逆転させる

## 決定

**選択肢 B** を採用する。以下の 3 層で全モード × プランを統括する。

### 第1層: Typed Config Object（`src/lib/runtime/env.ts`）

全 env は **Zod schema 経由で一度だけ読む**。以下を厳格化する。

```ts
// src/lib/runtime/env.ts (設計のみ、実装は P1 で行う)
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_MODE: z.enum(['build', 'demo', 'local-debug', 'aws-prod', 'nuc-prod']).default('local-debug'),
  AUTH_MODE: z.enum(['auto', 'cognito']).default('auto'),
  COGNITO_DEV_MODE: z.coerce.boolean().optional(),
  IS_NUC_DEPLOY: z.coerce.boolean().optional(),
  DEBUG_PLAN: z.enum(['free', 'standard', 'family']).optional(),
  DEBUG_TRIAL: z.enum(['active', 'expired', 'not-started']).optional(),
  DEBUG_TRIAL_TIER: z.enum(['standard', 'family']).optional(),
  CRON_SECRET: z.string().min(32).optional(),
  LICENSE_KEY_HMAC_SECRET: z.string().min(32).optional(),
  // ... required は ADR-0029 に従い `scripts/check-new-required-env.mjs` で PR 検出
});

export const env = envSchema.parse(process.env);
export type TypedEnv = z.infer<typeof envSchema>;
```

- `process.env.X` の直接参照を CI で禁止（`scripts/check-no-direct-env-access.mjs` を追加）
- 唯一の例外: `src/lib/runtime/env.ts` 自身のみ
- ADR-0029 との連携: 新 required env を `env.ts` に追加する PR は `scripts/check-new-required-env.mjs` が PR 本文の「配布済み: ENV」証跡を強制する

### 第2層: EvaluationContext（`src/lib/runtime/evaluation-context.ts`）

OpenFeature の evaluation context 概念を参考にした**リクエスト単位の "文脈オブジェクト"**。

```ts
// src/lib/runtime/evaluation-context.ts (実装は P3 / #1215 で完了)
import type { RuntimeMode } from './runtime-mode';

export interface EvaluationUser {
  id: string;
  role: 'owner' | 'parent' | 'child';
  groups: readonly string[];
}

export interface EvaluationPlan {
  tier: 'free' | 'standard' | 'family';
  status: 'none' | 'active' | 'grace_period' | 'canceled';
  trialState: 'none' | 'active' | 'expired';
}

export interface EvaluationLicenseKey {
  valid: boolean;
  expiresAt: Date | null;
}

export interface EvaluationContext {
  /** 実行モード。env + URL + cookie から P2 の resolveRuntimeMode が決定 */
  mode: RuntimeMode;
  /** 認証結果。demo / build / 未ログインでは null */
  user: EvaluationUser | null;
  /** ライセンスプラン（ADR-0024 の resolvePlanTier 結果）。demo / 未認証は null */
  plan: EvaluationPlan | null;
  /** nuc-prod モードのみ ADR-0026 のライセンスキー検証結果が入る */
  licenseKey: EvaluationLicenseKey | null;
  /** 現在時刻（テストで固定化するためのファネル） */
  now: Date;
}

/** 純関数ビルダ。I/O は hooks.server.ts 側で行う */
export function buildEvaluationContext(input: {
  mode: RuntimeMode;
  user?: EvaluationUser | null;
  plan?: EvaluationPlan | null;
  licenseKey?: EvaluationLicenseKey | null;
  now?: Date;
}): EvaluationContext;

/** AsyncLocalStorage 外 (build script / 未ラップのテスト) では undefined */
export function getEvaluationContext(): EvaluationContext | undefined;

/** hooks.server.ts が 1 リクエスト 1 回だけ呼ぶ。AsyncLocalStorage 外では no-op */
export function setEvaluationContext(ctx: EvaluationContext): void;
```

- `hooks.server.ts` で **1 リクエスト 1 回だけ** 構築し、#788 で導入済みの `runWithRequestContext` (AsyncLocalStorage) に注入
- `getEvaluationContext()` で routes / services / components から参照
- `+page.server.ts` の load から client に渡すのは **必要な投影だけ**（ADR-0009 の教訓: server→client 全量露出しない）

### 第3層: Policy Gate（`src/lib/policy/capabilities.ts`）

**`can(ctx, capability)` という純粋関数** で全ての機能ゲート判断を集約する。

```ts
// src/lib/policy/capabilities.ts (P4 実装済み / #1217)
export type Capability =
  | 'record.activity'
  | 'invite.family_member'
  | 'export.activity_history'
  | 'access.ops_dashboard'
  | 'view.ops_license_dashboard'
  | 'purchase.upgrade'
  | 'redeem.license_key'
  | 'manage.child_profile'
  | 'write.db' // mode が demo / build のとき、または nuc-prod かつ license invalid のとき deny
  | 'debug.plan_override';

export type DenyReason =
  | 'demo-readonly'
  | 'build-time-readonly'
  | 'unauthenticated'
  | 'role-insufficient'
  | 'plan-tier-insufficient'
  | 'license-key-invalid'
  | 'mode-mismatch'
  | 'dev-only'
  | 'ops-only';

export interface PolicyResult {
  allowed: boolean;
  reason?: DenyReason;
}

/** 純関数。I/O なし、時刻参照は ctx.now 経由 */
export function can(ctx: EvaluationContext, cap: Capability): PolicyResult;

/** denied なら SvelteKit error(403) を throw。route / action 先頭用 */
export function ensureCan(ctx: EvaluationContext, cap: Capability): void;
```

- **UI**: `{#if can(ctx, 'invite.family_member').allowed}` で表示制御
- **API**: route の load / action 先頭で `ensureCan(ctx, cap)` が 403 を throw
- **hooks**: `write.db` ゲート（ADR-0039 のデモ書き込み no-op もこれに吸収される）
- 純粋関数なので単体テストで全組合せをカバーできる

### ADR との関係

| ADR | 本 ADR での扱い |
|-----|---------------|
| ADR-0024 (プラン解決責務分離) | `resolvePlanTier` の結果が `EvaluationContext.plan` に注入される（既存関数は変更しない） |
| ADR-0025 (License ↔ Stripe 因果) | `EvaluationContext.plan.status` 決定の真実源。因果性は変えない |
| ADR-0026 (ライセンスキー) | `EvaluationContext.licenseKey` に nuc-prod モードのみ投影 |
| ADR-0029 (Safety Assertion Erosion Ban) | Typed env `src/lib/runtime/env.ts` の Zod required 定義で機械強制。supersede しない |
| ADR-0034 (Pre-PMF セキュリティ最小化) | 外部 SaaS （OpenFeature / Stripe Entitlements / LaunchDarkly 等）を明示的に不採用とする根拠 |
| ADR-0039 (デモモード統合) | `mode: 'demo'` が本 ADR の RuntimeMode のひとつ。`write.db` capability 判定に吸収 |

### 移行フェーズ（5 段階、Branch by Abstraction）

各フェーズは独立した PR で進める。**旧コードと新コードが並走する期間**を許容する（Fowler's Branch by Abstraction）。

| フェーズ | 成果物 | ゲート |
|---------|--------|-------|
| **P1** Typed env | `src/lib/runtime/env.ts` + `check-no-direct-env-access.mjs` | 既存 `process.env.X` を段階的に置換。CI で新規の直接参照を禁止 |
| **P2** RuntimeMode 解決 | `src/lib/runtime/runtime-mode.ts` + `resolveRuntimeMode(env, url, cookie)` | 5 モード判定が `hooks.server.ts` から分離 |
| **P3** EvaluationContext | `src/lib/runtime/evaluation-context.ts` + hooks 組立 + `runWithRequestContext` 拡張 | load fn / services から `getEvaluationContext()` で読める |
| **P4** Policy Gate | `src/lib/policy/capabilities.ts` + `can()` / `ensureCan()` + 既存分岐の段階的置換 | 主要 capability 10 件を `can()` 経由に置換。旧コードと並走 |
| **P5** テストマトリクス | `playwright.matrix.config.ts` の projects で `{mode} × {plan}` マトリクス + `DEBUG_LICENSE_KEY_VALID` env（dev-only）(#1221) | 代表 5 シナリオ（demo × free / local-debug × family / aws-prod × trial-expired / nuc-prod × license-valid / nuc-prod × license-expired）の E2E smoke が `npm run test:e2e:matrix` で緑 |

### 不採用事項（Pre-PMF 原則に従う）

- OpenFeature SDK 導入（ADR-0034 準拠）
- LaunchDarkly / Flagsmith 等の feature flag SaaS
- CASL / Oso / Cedar などの policy ライブラリ
- Stripe Entitlements API（ADR-0025 の因果性と衝突）
- 機能ごとの A/B テスト基盤（Pre-PMF で不要）

これらを再検討するのは、Product-Market Fit 以降、ユーザー数が自社運用困難な水準に達してからとする。その際は本 ADR を supersede する新 ADR を先に起票すること（ADR-0034 と同じ扱い）。

## 結果

- 全 5 モード × ライセンスプランが**同じフレーム**で駆動する（構造的乖離が再発不可能）
- `process.env.X` の散在が消える。新 env 追加が CI で可視化される（ADR-0029 強化）
- 機能ゲートの判断が `capabilities.ts` に集中し、「どの機能はどのモードで使えるか」の SSOT ができる
- Playwright projects で `{mode} × {plan}` マトリクスを回すため、境界ケースの自動検証が可能になる
- ADR-0024 / 0025 / 0026 / 0029 / 0034 を変更せず、上位レイヤから参照する
- 新機能追加時のチェックリストが「この機能は何の capability か」の 1 問に集約される

### リスク

- 移行期間中に旧分岐と新 policy が並走し、一時的に判断経路が増える → Branch by Abstraction で 1 フェーズ毎に旧経路を削除
- Zod schema の定義漏れで runtime error → CI (`check-no-direct-env-access.mjs`) で新規直接参照を検知。既存は段階移行
- NUC モード特有の境界（オフライン中のライセンス再検証等）の capability 表現が複雑化 → ADR-0026 のポリシーを `can()` に直接写像する

### 教訓

- **"実行モード" は第 1 級の概念として扱う** — env の二次的な導出物ではなく、型付けされた単一値として設計する
- **"機能が使えるか" は純粋関数で表現できる** — Side effect（認可エラー throw）は呼び出し側の `ensureCan()` に閉じ込める
- **Pre-PMF では外部依存より内部整理** — SaaS を入れる前に、自社コードの境界を整えるほうが ROI が高い（ADR-0034 と同じ哲学）

## 実装補正メモ (P1) — #1211

P1 実装 (PR #1204: `src/lib/runtime/env.ts`) 時点で、本 ADR 本文の擬似コードと実装に次の 2 件の差分が発生した。
**ADR-0003「設計書は Single Source of Truth」に基づき、本 ADR の擬似コードは実装側の記述を正とする**（本 ADR 本文は改訂せず、補足としてここに追認する — supersede ではない）。

| 項目 | 本 ADR 擬似コード | P1 実装 (`src/lib/runtime/env.ts`) | 採用 | 理由 |
|------|------------------|------------------------------------|------|------|
| `AUTH_MODE` enum | `['auto', 'cognito']` | `['local', 'cognito']` | **実装が正** | 既存コード (`src/lib/server/auth/`) が以前から `local \| cognito` を参照しており、`'auto'` を導入すると既存参照を全て書き換える必要がある。既存整合性を優先 |
| `COGNITO_DEV_MODE` schema | `z.coerce.boolean().optional()` | `booleanStringSchema` (`z.enum(['true', 'false']).transform(...)`) | **実装が正** | `z.coerce.boolean()` は `Boolean("false")` が JS 仕様で `true` になる落とし穴があり、`COGNITO_DEV_MODE=false` が truthy 判定される不具合を生む。`z.enum(['true', 'false']).transform((v) => v === 'true')` で文字列比較する方式を採用 |

### スコープ

本補正は ADR のヘッダ (`status: accepted`) を変更しない。supersede ではなく、P1 実装時点での「正仕様」を補足情報として記録する。今後の P2〜P5 でも類似の実装補正が発生した場合は本セクションに追記する。

## 参考

- Martin Fowler, "Branch by Abstraction" — https://martinfowler.com/bliki/BranchByAbstraction.html
- OpenFeature Evaluation Context 仕様 — https://openfeature.dev/specification/sections/evaluation-context
- [SvelteKit Hooks docs](https://svelte.dev/docs/kit/hooks)
- ADR-0039 (前身) — デモモードを実行モードとして統合
- ADR-0003 — 設計書は Single Source of Truth（本 ADR 補正メモの根拠）
