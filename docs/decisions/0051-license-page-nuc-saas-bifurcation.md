# 0051. NUC-SaaS Bifurcation (license/billing 領域、Edition badge + 簡略表示型採用)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-20 |
| 起票者 | Takenori Kusaka |
| 関連 Issue | EPIC #2327 / #2328 / #2329 / #2330 / #2331 / #2333 |
| 関連 ADR | ADR-0040 (runtime-mode SSOT、archive) / ADR-0010 (Pre-PMF) / ADR-0013 (LP truth) / ADR-0014 (OSS 先調査) / ADR-0015 (年齢帯 variant、context 注入同型) / ADR-0045 (terms.ts atom/compound 2 階層) |

> **番号注記**: 当初 EPIC #2327 / #2333 では「ADR-0047」を指定していたが、ADR-0047 は別 EPIC (Demo / 本番 UI Contract SSOT) で既占有のため、次の空き番号 ADR-0051 に振り替え。

## コンテキスト

PO 報告 (2026-05-20、NUC <NUC_HOST>:3000 dogfood):

- 親管理画面 `/admin/license` (940 行メガファイル) が NUC ローカル版でも「決済機能は現在準備中です」placeholder / ライセンスキー入力 / 支払い履歴 等を表示し冗長
- header「ファミリープラン」と本文「無料プラン」の表示矛盾 (SSOT 2 系統: `planTier` resolveFullPlanTier 経由 vs `license.plan` Stripe subscription tier)
- 実行モード判定 (NUC / AWS) ロジック `/admin/license` 内に存在せず、既存 `src/lib/runtime/runtime-mode.ts` (ADR-0040) は整備済だが UI 層で未活用

## 検討した選択肢 (#1350 OSS 先調査)

### 選択肢 A: Plausible self-hosted 型 (画面ゼロ)

- 概要: NUC では `/admin/license` 自体を完全非表示
- メリット: 実装最小、業界 prior art (Plausible CE)
- デメリット: Edition 認知不能、ユーザーが「自分は何を使っているか」を判断不能
- 不採用

### 選択肢 B (採用): Mattermost Team Edition / Bitwarden self-hosted / GitLab CE 型 (Edition badge + 簡略表示)

- 概要: Edition badge + 利用状況 + サポート link の 3 セクション、冗長セクション (ライセンスキー / placeholder / 支払い履歴) は削除
- メリット:
  - 業界 prior art 3+ 件整合 (Mattermost / Bitwarden / GitLab CE)
  - ADR-0040 runtime-mode.ts 既存 SSOT を UI 層に活用 (新規 OSS 不要)
  - ADR-0015 年齢帯 variant context 注入と同型のパターン (`locals.runtimeMode` で SSR 時点 2 分岐)
- デメリット: メガファイルを 2 panel に分割するためテストとレビュー対象が増える
- Pre-PMF コスト: 工数 M (2 週間)、依存追加なし

### 選択肢 C: Sentry self-hosted 型 (cloud UI 痕跡)

- 概要: 現状維持
- メリット: 移行コストゼロ
- デメリット: PO 4 指摘 (表示矛盾 / 冗長 / placeholder / メガファイル) 全て未解消
- 不採用 (悪い見本)

## 決定

**案 B 採用**。

- `hooks.server.ts` で既に解決済の `event.locals.runtimeMode` (ADR-0040 SSOT) を `+layout.server.ts` (admin layout) 経由で全 admin route の `data` に配布
- `/admin/license/+page.svelte` は **薄いラッパー (25 行)** に縮小、`{#if data.runtimeMode === 'nuc-prod'}` で 2 分岐
- `NucLicensePanel.svelte` (~110 行): Edition badge (`NUC_EDITION_TERMS.selfHosted` atom) + 利用状況 dl (3 行) + サポート link (2 行)
- `SaasLicensePanel.svelte` (~580 行): 既存 AWS 用ロジック保持、`license.plan` → `data.planTier` SSOT 統一、`stripeEnabled` false 分岐 placeholder 削除

### NUC 表示の業界 prior art 整合

| サービス | Edition 表示 | 簡略表示 | 整合判定 |
|---|---|---|---|
| **Mattermost Team Edition** | "Team Edition" badge | License Settings 簡略 | ◎ |
| **Bitwarden self-hosted (Vaultwarden)** | Edition badge | Server stats のみ | ◎ |
| **GitLab Community Edition** | Edition 表示 | Enterprise CTA 別出 | ◎ |
| Plausible self-hosted | 画面ゼロ | — | × (A 型、認知不能) |
| Sentry self-hosted | 旧 cloud UI 残存 | — | × (C 型、現状の悪い見本) |

## 結果

### コード変化

| ファイル | 旧 | 新 | 増減 |
|---|---|---|---|
| `/admin/license/+page.svelte` | 940 行 | 25 行 | −915 行 |
| `NucLicensePanel.svelte` | — | 116 行 (新規) | +116 行 |
| `SaasLicensePanel.svelte` | — | 580 行 (新規) | +580 行 |
| **合計** | **940 行** | **721 行** | **−219 行 (23% 削減)** |

### Pre-PMF 整合 (ADR-0010 §3)

- Q1: NUC 表示違和感解消 + AWS 表示矛盾解消 + メガファイル保守性向上 = **三重価値**
- Q2: M3 (Retention、UX 信頼性) + M4 (Sustain、運用 SSOT)
- Q3: 不可能 (high) — 表示矛盾は data integrity リスク
- Q4: Yes (Settings EPIC #2319 / Parent-Gate EPIC #2310 と並列、SSOT 整理路線整合)
- Q5: 釣り合う (工数 M)

### トレードオフ

- **増えるもの**: 2 panel ファイル、ADR / 設計書、テスト 2 種 (Nuc / Saas)
- **減るもの**: メガファイル、NUC 冗長セクション、表示矛盾、placeholder
- **将来拡張**: 他 admin route で NUC/SaaS 分岐が必要になった際は本パターン (`locals.runtimeMode` 経由) を踏襲

### AN-5 補強 (#2180、Issue #2333 経由)

本 ADR の決定根拠から派生する 2 件の retrospective 補強:

1. **NUC / SaaS UI 分岐は `locals.runtimeMode` SSOT 経由で判定** (ADR-0015 年齢帯 variant 同型)
2. **OSS セルフホスト版業界 prior art 最低 5 件参照原則** (license / billing / edition badge / plan UX 領域)
