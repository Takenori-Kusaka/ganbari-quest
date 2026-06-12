# NUC vs SaaS runtime bifurcation

> SSOT 起点: [ADR-0051 (NUC-SaaS Bifurcation)](../decisions/0051-license-page-nuc-saas-bifurcation.md) / [ADR-0040 (runtime-mode SSOT、archive)](../decisions/archive/0040-runtime-mode-license-unified-architecture.md) / EPIC #2327

## §1. 設計背景

### 1.1. この設計がなかった場合に何が困るか

がんばりクエストは同一コードベースで **5 つの実行モード** を駆動する (ADR-0040):

| Mode | 起動 | 認証 | データ永続化 |
|---|---|---|---|
| `build` | SSR prerender | なし | なし |
| `demo` | `?mode=demo` / `gq_demo=1` | 非認証 | in-memory |
| `local-debug` | `npm run dev` | local mock | SQLite |
| `aws-prod` | Lambda + DynamoDB | Cognito | DynamoDB |
| `nuc-prod` | ローカル NUC | Cognito | SQLite + ライセンスキー |

特に `nuc-prod` (家庭内 self-host) と `aws-prod` (SaaS subscription) は、**同じ UI コードが両方を駆動**する。
分岐ロジックを各 component に散在させると以下の構造欠陥が発生する:

1. **表示矛盾**: SSOT 2 系統 (`planTier` resolveFullPlanTier vs `license.plan` Stripe tier) で header / 本文が乖離
2. **冗長セクション**: NUC で意味のない「ライセンスキー適用 / 決済 placeholder / 支払い履歴」を表示
3. **メガファイル**: 1 component で全 mode の分岐を抱え 940 行に肥大化 (`/admin/license/+page.svelte`)
4. **業界乖離**: Sentry self-hosted (cloud UI 痕跡型) のような悪い見本に陥る

### 1.2. PO 報告 (2026-05-20) と業界調査

PO dogfood (NUC <NUC_HOST>:3000):

| PO Q | 業界調査回答 |
|---|---|
| Q1 「セルフホスト版でこのページ自体不要か」 | 業界 3 パターン (A 画面ゼロ / B Edition badge / C 完全コピー) の **B 型推奨** |
| Q2 「内容の冗長性」 | NUC で 5 セクション中 3 削除 |
| Q3 「意味のないセクション」 | 表示矛盾は SSOT 2 系統の構造問題 |

### 1.3. 業界 prior art (最低 5 件参照、AN-5 補強原則)

| サービス | self-hosted license 画面 | 分類 |
|---|---|---|
| **Mattermost Team Edition** | Edition badge + 簡略 License Settings | B 型 (採用整合) |
| **Bitwarden self-hosted (Vaultwarden)** | Edition badge + Server stats | B 型 |
| **GitLab Community Edition** | Edition 表示 + Enterprise CTA | B 型 |
| Plausible self-hosted | 画面ゼロ | A 型 (極端、不採用) |
| Sentry self-hosted | 旧 cloud UI 痕跡 | C 型 (悪い見本) |

## §2. 設計原則

### 2.1. runtime-mode SSOT の UI 領域伝播

```
hooks.server.ts (307 行)
  └─ event.locals.runtimeMode = resolveRuntimeMode(...)  ← ADR-0040 SSOT
       └─ +layout.server.ts (admin layout) で data.runtimeMode に転送
            └─ +page.svelte (薄ラッパー) で 2 分岐
                 ├─ {#if data.runtimeMode === 'nuc-prod'}
                 │    <NucLicensePanel {data} />          ← Edition badge 簡略
                 ├─ {:else}
                 │    <SaasLicensePanel {data} {form} /> ← AWS 用フルセット
```

### 2.2. 分岐は **page 層 1 箇所に集約**、component 内で `{#if mode === ...}` を散在させない

- ADR-0015 (年齢帯 variant) の context 注入と同型
- panel 内部では mode 分岐を持たない (`NucLicensePanel` は NUC 専用、`SaasLicensePanel` は SaaS 専用)
- 共有ロジック (例: `LICENSE_PAGE_LABELS`) は labels.ts SSOT で集約

### 2.3. NUC で削除する 5 セクション

| セクション | NUC で意味なし根拠 |
|---|---|
| ライセンスキー適用 | NUC = セルフホスト = キー入力意味なし |
| 「現在のプラン」(free/standard/family) | NUC = ファミリープラン自動格上げ、本文表示は混乱の元 |
| プラン管理 placeholder | NUC = 決済機能不要 |
| 7 日間 trial CTA | NUC = trial 不要 (全機能既に有効) |
| 支払い履歴 / 請求書 link | NUC = 課金なし |

### 2.4. AWS (SaaS) 側の修正点

1. 「現在のプラン」表示を `license.plan` → `data.planTier` (resolveFullPlanTier 経由) に統一 → header badge と一致
2. 「決済機能は現在準備中です」placeholder 削除 (stripeEnabled false 分岐は production で到達不能)

## §3. 仕様

### 3.1. ファイル構成

| ファイル | 行数 | 役割 |
|---|---|---|
| `src/hooks.server.ts` | (既存) | `event.locals.runtimeMode` 注入 (#2328 AC1 既存達成) |
| `src/app.d.ts` | (既存) | `App.Locals.runtimeMode: RuntimeMode` 型定義 (既存) |
| `src/routes/(parent)/admin/+layout.server.ts` | +5 行 | `data.runtimeMode = locals.runtimeMode` 配布 (#2328) |
| `src/routes/(parent)/admin/license/+page.svelte` | 25 行 (旧 940) | 薄ラッパー + 2 分岐 (#2331) |
| `src/lib/features/admin/components/NucLicensePanel.svelte` | 116 行 (新規) | Edition badge + 利用状況 + サポート link (#2329) |
| `src/lib/features/admin/components/SaasLicensePanel.svelte` | 580 行 (新規) | AWS 用、`planTier` SSOT 統一 + placeholder 削除 (#2330) |
| `src/lib/domain/terms.ts` | +25 行 | `NUC_EDITION_TERMS` atom (#2329) |
| `src/lib/domain/labels.ts` | +28 行 | `NUC_LICENSE_LABELS` compound (#2329) |

### 3.2. NUC Edition badge atom (terms.ts)

```typescript
export const NUC_EDITION_TERMS = {
	selfHosted: 'セルフホスト版',          // Mattermost "Team Edition" 整合
	fullAccess: '全機能利用可能',          // 最大特典
	unlimited: '無制限',                    // 利用状況 dl の値
	editionEmoji: '🏠',                    // 視覚 anchor
} as const;
```

### 3.3. data.runtimeMode の値 (ADR-0040 既存)

`'build' | 'demo' | 'local-debug' | 'aws-prod' | 'nuc-prod'`

`local-debug` および `demo` は `nuc-prod` ではないため SaasLicensePanel が表示される (本番 AWS と同等)。

### 3.4. 拡張ガイドライン

将来、他 admin route で NUC / SaaS 分岐が必要になった際:

1. **page 層 1 箇所** で `{#if data.runtimeMode === 'nuc-prod'}` 分岐
2. NUC 専用 panel と SaaS 専用 panel を `src/lib/features/<feature>/components/` に配置
3. NUC で削除すべきセクションを上記 2.3 と同型の表で先に整理
4. labels.ts に NUC 専用 namespace (例: `NUC_FOO_LABELS`) を terms.ts atom で組み立て (ADR-0045)
5. ADR-0051 を参照する派生 ADR を起票 (適用 route が 3+ に増えたら共通化検討)

## 関連

- ADR-0051: NUC-SaaS Bifurcation (license/billing 領域、Edition badge + 簡略表示型採用)
- ADR-0040 (archive): 実行モード × ライセンス統括アーキテクチャ
- ADR-0015: 年齢帯 variant アーキテクチャ (context 注入同型)
- ADR-0014: labels / i18n 機構選定 (OSS 先調査)
- ADR-0045: terms.ts SSOT 2 階層化原則
- EPIC #2327 + 子 #2328 / #2329 / #2330 / #2331 / #2333
