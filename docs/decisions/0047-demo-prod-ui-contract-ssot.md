# 0047. Demo / 本番 UI Contract SSOT (ViewModel 型強制 + 禁止語 + 5 phase 分割)

> **Warning**: このドキュメントは現在の実装と乖離しており陳腐化（Deprecated）しています。



| 項目 | 内容 |
|------|------|
| ステータス | accepted (Phase 1 = 型 + ADR + 禁止語 SSOT のみ、Phase 2-5 は別 PR で実装) |
| 日付 | 2026-05-14 |
| 起票者 | Dev Agent (Issue #2097) |
| 関連 Issue | #2097 (6 回目の demo/本番統合要求 + deep research) / 過去 #531 / #561 / #562 / #563 / #566 / #2069 |

## コンテキスト

demo (`/demo/(child)/**`) と本番 (`/(child)/[uiMode]/**`) の child home UI 統合は **6 回目の指摘**として #2097 が起票された。
過去 5 回 (#531 / #561 / #562 / #563 / #566 / #2069) はすべて「Tier N で統合」「POC scope」「等価性維持」「足場として」「demo 寄せ統合」「snapshot patch」などの **逃げ語**で shim 完了報告 → 並行実装 2 系統が構造的に残存していた。

ADR-0046 (Service Interface + Context DI) で **データ取得層** は SSOT 化されたが、`DashboardView.svelte` と `ProdDashboardSections.svelte` の **2 ファイル並走**が解消されず、`PageData as never` キャストで「UI 設計 divergence」「機能セット divergence」が型レベル SSOT 化されていない問題が残った。

PO 直接指摘（スクリーンショット比較）: 「アプリ UI 設計が demo と違いすぎる」「snapshot 切出し→patch する haribote 修正では本質的解決にならない」。

深層調査 (`docs/research/2097-demo-prod-unification-architecture-deep-research.md`) で 8 OSS + 7 デザインパターン + SvelteKit 固有を比較し、PO 10 + 3 質問への回答を確定。
過去 7 回失敗の構造的原因は **「UI Contract が型として存在しない」** こと。Supabase Anonymous Auth (§1.3) / Stripe test mode (§1.8) / Khan Academy 公開 API (§1.2) の成功パターンは全て「UI と data の関係性を contract として定義 + data 層は環境別 swap」であった。

## 検討した選択肢（OSS / 確立パターン最低 2 件、深層調査 §5 を要約）

### 選択肢 A: 案 A「Contract 文書化のみ」(深層調査 §5 案 A)

- 概要: `docs/contracts/child-home-ui.md` を起票し、表示要素・interaction・mock data を文書 SSOT 化。コード変更なし。
- メリット: 追加コードゼロ、Pre-PMF 適合度◎、Contract 違反を機械検証なしで議論可能化
- デメリット: 文書 SSOT は風化リスク。PR レビューで「Contract に書いた / 書いてない」議論が延々発生。**過去 7 回の haribote 失敗を構造的に防げない** (型強制がない)
- Pre-PMF コスト: 1-2 日

### 選択肢 B: 案 B「Domain Service + UI Contract SSOT」(採用)

- 概要: ADR-0046 の上に **UI Contract 層**を追加。`ChildHomeViewModel` interface を SSOT として定義し、production / demo 両 Service が `toViewModel()` で同じ shape を生成。`DashboardView` は `ChildHomeViewModel` 以外の型を一切受け取らない (型強制)。
- 参照 OSS: Khan Academy 公開 API + 認証 API 分離 (§1.2)、Notion Block tree (§1.5)、MV-VI Pattern (§2.7)、DDD + ACL (§2.2)
- メリット: 型レベルで divergence を contract field に表現 (`progressDisplay.type` union)、`as never` キャスト排除、過去 5-7 回の言い訳パターンを型で構造的阻止
- デメリット: ViewModel 設計に PO 合意必須 (= §6 深層調査 13 質問への回答が前提)、200-300 行の型定義追加
- Pre-PMF コスト: 1-2 週間 (今回は 5 phase 分割で 2-3 週間総工数、各 phase 別 PR)

### 選択肢 C: 案 C「Server-side demo Drizzle」(深層調査 §5 案 C / Stripe test mode 流)

- 概要: demo も `/api/v1/...` を叩く、サーバ側で in-memory Drizzle を立てて同じ SQL ロジックを demo data に走らせる。
- 参照 OSS: Supabase Anonymous Sign-Ins + RLS (§1.3)、Stripe Test/Live mode (§1.8)
- メリット: divergence は構造的に発生しない (= 同じコード走る)、Service Interface すら不要に
- デメリット: serverless cold start で demo session 状態消失 → Anti-engagement (ADR-0012) 違反、Cognito bypass セキュリティ設計が必要、Pre-PMF 個人開発で過剰
- Pre-PMF コスト: 2-3 週間 (構造変更大)

## 決定

**選択肢 B を採用**。理由:

1. **過去 5-7 回失敗の構造的原因 (型不在)** を解消する唯一の選択肢。案 A の文書 SSOT では haribote 再発を構造的に防げない (PO の "snapshot+patch 禁止" 指示と矛盾)
2. **Pre-PMF 適合度** (ADR-0010 Bucket A: 二重実装 SSOT 化) に該当。案 C はサーバインフラ二重化で Pre-PMF 過剰
3. **ADR-0046 と整合**: Service Interface + Context DI の上に UI Contract 層を追加するだけで、既存機構を破壊しない
4. **PO 13 質問への回答が確定** (#2097 本文 §更新 2026-05-14 参照):
   - Q1 (demo goal): 子供画面=B (未認証で本番 UX を体験) / 親画面=A+D (LP 訴求 + 見るだけプレビュー)
   - Q2 (等価性): 子供は機能セット等価 (C) / 親は意図的 divergence (display only)
   - Q3 (永続化): A (sessionStorage 揮発、ADR-0012 整合)
   - Q4 (通貨): A (demo 固定 P)
   - Q5 (shop): B (子供側は買える / 親側は見せるだけ)
   - Q6 (Activity 数): B (production 同等の 51+ 件、マーケットプレイス pack 由来)
   - Q7 (5 年齢モード): C (全 5 モード提供、baby は ADR-0011 親準備モード)
   - Q8 (禁止語): 全 12 語禁止語化 + 救済策 (ADR 起票 or Issue 起票 + due date)
   - Q9 (同期コスト): A (production 変更時に CI で必ず demo 同期、本 ADR の型強制で機械検証)
   - Q10-13 (補足): 親画面は visible / no-op で contract レベル divergence 許容、shop は demo でも実購入動作 (sessionStorage)

### 確定した UI Contract (型 SSOT)

```typescript
// src/lib/services/types.ts に Phase 1 で追加

ChildHomeViewModel = {
  child: ChildHomeChild,                    // ChildDashboardHomeData.child の subset
  currency: { symbol: 'P'; code: 'POINTS' }, // demo 固定 P / production は設定追従
  progressDisplay: ProgressDisplayViewModel, // type union: 年齢/プラン状態で切替 (demo/prod identity 固定しない)
  activities: ChildHomeActivity[],           // 51+ 件 (marketplace pack SSOT)
  features: ChildHomeFeatureFlags,           // 9 feature の表示可否を contract で明示
  uiMode: 'baby' | 'preschool' | 'elementary' | 'junior' | 'senior',
  ageContext: ChildHomeAgeContext,           // baby = ADR-0011 親準備モード判定材料
};

ParentAdminViewModel = {
  isPreviewOnly: boolean,                    // demo = true / production = false
  previewNoticeMessage?: string,             // demo only: 「これは見るだけのプレビューです」
  presets: ReadonlyPreset[],                 // action 型を含めない (visible only)
  rewards: ReadonlyReward[],
  members: ReadonlyMember[],
  // ... 親画面で見せる要素を網羅、action signature は含めない (Q11=D)
};
```

### 実装フェーズ分割 (各 phase 別 PR)

| Phase | scope | PR | PO レビュー観点 |
|---|---|---|---|
| **Phase 1** | 型定義 + ADR-0047 + 禁止語 SSOT + Issue 本文確定 | 本 PR | 型設計 / contract 妥当性 |
| **Phase 2** | `DashboardView` を ViewModel のみ受取に変更、`ProductionDashboardService.toViewModel()` 実装 | 次 PR | 本番 degrade ないか |
| **Phase 3** | marketplace pack を demo seed として import、`DemoDashboardService.toViewModel()` 実装、5 年齢モード × 性別 variant で 51+ Activity 表示 | 次 PR | demo SS が本番 SS と機能等価か |
| **Phase 4** | `ParentAdminViewModel` 実装、demo /(parent) layout に notice バナー、全 button click no-op 化 | 次 PR | 親画面が「見せるだけ」か |
| **Phase 5** | `scripts/check-no-escape-language.mjs` 新設 + CI 組込、demo shop タブ + mock 商品買い flow、CLAUDE.md / PR template 禁止語追記 | 次 PR | 過去 7 回パターン構造的阻止 |

## 結果

- **過去 7 回失敗 80%** (深層調査 §4.3 / §6 Q8) の構造的原因「UI Contract が型として存在しない」が Phase 1-5 完遂で解消
- #2097 PR-B2 (#2187, 2026-05-17): demo POC `DashboardView.svelte` を撤廃完了。child home UI は `ProdDashboardSections.svelte` 単独構成へ統合済。`src/routes/demo/(child)/**` 14 file 撤去 + legacy redirect (`/demo/<5-mode>/<path>` → `/<uiMode>/<path>` / `/demo/checklist` → `/checklist`) で URL 救済。demo Lambda は本番 routes を AnonymousAuth + DATA_SOURCE=demo で host する設計に統一 (ADR-0048 整合)。型強制対象は `DashboardView` から `ProdDashboardSections` へ移行
- 旧 DashboardView は `as never` キャスト消失目標の対象であったが、撤廃により目標自体が消滅。今後の Phase 2-5 (toViewModel 実装) は `ProdDashboardSections.svelte` で実施
- 禁止語 SSOT (`docs/decisions/forbidden-escape-language.md`) + 救済策 (ADR 起票 or Issue 起票 + due date) で「逃げ語による完了報告」を機械検証 (Phase 5 で `scripts/check-no-escape-language.mjs`)
- `progressDisplay.type` の union 切替は「**子供の年齢 / プラン状態に応じて切替わる**」UX 法則に従わせ、demo / production の identity ではなく **コンテキスト** に紐付けることで案 B 失敗リスク (深層調査 §5 案 B) を回避
- Pre-PMF (ADR-0010) Bucket A 適合、二重実装メンテ負債を削減
- ADR-0046 は破壊しない (Service Interface + Context DI の上に UI Contract 層が乗る)
- 5 phase 累積 PR で 2-3 週間総工数、各 phase で PO 動作確認 → Ready 化 (auto-merge / Dev 自律 Ready 禁止)

## 関連

- ADR-0046 (Service Interface + Context DI) — 本 ADR は ADR-0046 の上に UI Contract 層を追加。ADR-0046「結果」セクションに本 ADR 参照を追記
- ADR-0045 (terms.ts SSOT 2 階層化) — 同じ atom / compound 責務分離発想を services 層に転用
- ADR-0011 (baby = 親準備モード) — `ChildHomeViewModel.ageContext` 設計に反映
- ADR-0012 (Anti-engagement) — `features` 連続演出禁止 + sessionStorage 揮発を contract field に表現
- ADR-0013 (LP truth) — demo SS は LP に貼られるため、demo data ≠ production data の divergence は **contract で明示**して透明化
- ADR-0010 (Pre-PMF) — Bucket A: 二重実装 SSOT 化に該当
- 深層調査: `docs/research/2097-demo-prod-unification-architecture-deep-research.md`
- 禁止語 SSOT: `docs/decisions/forbidden-escape-language.md`
- 失敗 memory: `feedback_demo_prod_ui_unification_blocker.md` / `feedback_no_escape_to_haribote_implementation.md`

## 1-in-1-out

本 ADR は active ADR を 33 → 34 へ増やす。README に明記の通り active 総数は既に TOP 10 ルール超過 (33 件) で別 Issue にて棚卸予定。本 PR では棚卸を扱わない (#1924 Phase 6 G3 系の継続)。
