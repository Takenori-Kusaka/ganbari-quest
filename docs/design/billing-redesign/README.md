# 課金/プラン体系 再設計 — Phase 1 要件定義 + Phase 2 UX ジャーニーマップ (Epic #2525)

| 項目 | 内容 |
|------|------|
| 上位 Epic | #2525 (課金/プラン体系の顧客体験+システム全体再設計、7 phase) |
| Phase 1 | #2526 (要件定義) — **完了** |
| Phase 2 | #2527 (UX ジャーニーマップ) — **完了 2026-05-28** |
| ステータス | Phase 2 完了 (7 ジャーニー、業界呼称 + Reverse Trial / Tier Change / Voluntary churn 整合 + mermaid 3 図 × 7 + 既存実装統合 + ADR-0012 / 特商法整合性チェック) |
| 作成日 | 2026-05-27 (Phase 1) / 2026-05-28 (Phase 2) |

> **位置づけ**: 全体計画 (要件定義 → UX → UI → 動線 → アーキ → 実装詳細 → 実装) の Phase 1 成果物。各要件は設計意図 + 根拠 (法令/Stripe 公式/業界標準の一次情報) 付き。Phase 2 (UX) 以降の土台。

## 基本方針

- **課金フローは差別化要素でない → 業界標準・Stripe 公式推奨をそのまま採択**
- **license key 撤廃 → Stripe Subscription をプラン状態の唯一 SSOT に** / **lifetime 廃止** (subscription 一本化、NUC は Edition 軸 ADR-0051)
- **account-first** (signup → login → checkout) / **webhook が権限付与 SSOT** / **任意タイミングトライアル**
- 詳細: [billing-redesign-policy.md](billing-redesign-policy.md)

## 10 機能領域の要件 (索引)

| 機能領域 | 孫 issue | 主要確定事項 | ファイル |
|---|---|---|---|
| 新規申込 | #2532 | account-first / signup 時は無料のみ / メール確認必須 / 子供プロファイルはオンボーディング / 対象=日本国内 / i18n 素地のみ | [signup](phase1-signup-requirements.md) |
| トライアル | #2533 | family 固定・7日・カード登録なし・cancel で無料復帰・1回制限 family-tenant | [trial](phase1-trial-requirements.md) |
| 有料化 | #2534 | 月/年トグル月額デフォルト・2ヶ月おトク・webhook SSOT・準備中表示+polling・重複防止 built-in | [checkout](phase1-checkout-requirements.md) |
| アップ/ダウングレード | #2535 | アップ即時/ダウン期末・超過アーカイブ・Product 構成 Phase 5 確認 | [plan-change](phase1-plan-change-requirements.md) |
| 解約・退会 | #2536 | 期末解約・解約理由は確定後任意(skip 可)・退会は全削除 | [cancellation](phase1-cancellation-requirements.md) |
| dunning | #2537 | past_due=grace(有料維持)・2週8回・canceled→無料 | [dunning](phase1-dunning-requirements.md) |
| データライフサイクル | #2538 | 「90日」2系統・予告後物理削除・ポイント残高不変・エクスポート UI 化・Customer 削除 | [data-lifecycle](phase1-data-lifecycle-requirements.md) |
| NUC | #2539 | 完全無料 OSS・信頼ベース(DRM なし)・family 固定 | [nuc](phase1-nuc-requirements.md) |
| セキュリティ | #2540 | webhook tenant 再検証・認可境界・PII/PCI 最小化・過剰防衛除外 | [security](phase1-security-requirements.md) |
| 法務 | #2541 | キー言及削除・特商法最終確認画面5項目・tokushoho 改訂・トライアル後自動課金なし整合 | [legal](phase1-legal-requirements.md) |

## Phase 2 — UX ジャーニーマップ (7 ジャーニー索引)

各ジャーニーは既存実装前提 + 業界呼称 + 感情曲線 (mermaid journey) + 状態遷移 (mermaid stateDiagram) + 動線/処理フロー (mermaid flowchart) + PO 既出指摘との整合性 (4 谷 / Reverse Trial / 文言 atom / ADR-0012 / 特商法 6 項目) を完備。

| ジャーニー | 孫 | 業界呼称 | 主要発見 | ファイル |
|---|---|---|---|---|
| 新規申込 | #2546 | Activation funnel / PQL / Time-to-Aha | 主体は最後まで親、2 山構造 (中間山 setup 完遂 + 最終山 初回記録 親代行 OK)、マーケットプレイス推奨自動採用 + デフォルト表示選択は既存実装で概ねカバー | [signup](phase2-signup-journey.md) |
| トライアル | #2547 | **Reverse Trial** (4 核要素整合) | カスタマイズ持続性 = 課金 hook、ADR-0012 と本質的整合、follow-up: 7→14 日 A/B / Notion 型 read-only ADR 化 / PQL 計測 / 季節性更新 | [trial](phase2-trial-journey.md) |
| 有料化 | #2548 | Reverse Trial パターン C / 4 谷 | 4 谷統合 (プラン選択/金額/解約柔軟性/購入動線)、gate tooltip & LP 動線説明既存 ✅、ヘッダ有料時遷移のみ欠落 | [checkout](phase2-checkout-journey.md) |
| アップ/ダウングレード | #2549 | Tier Change / Expansion / Contraction / NRR | 超過リソース既に Notion 型 Pattern A 実装済、proration UX (Preview API) のみ新規必要、`PLAN_CHANGE_TERMS` atom 拡張案 | [plan-change](phase2-plan-change-journey.md) |
| 解約・退会 | #2550 | Voluntary churn / Save flow / Account deletion | 解約 = 無料に戻る・データ保持 / 退会 = 全削除、ADR-0012 引き止めない | [cancellation](phase2-cancellation-journey.md) |
| dunning | #2551 | Involuntary churn / Dunning mgmt / Stripe Smart Retries | 子供視点 zero touch、grace 2週移行、無料化新規 (Phase 1 確定) | [dunning](phase2-dunning-journey.md) |
| NUC | #2552 | Self-hosted / Edition Bifurcation / Trust-based (DRM-less) | 課金導線なし、ADR-0051 整合、NRR 計算外 | [nuc](phase2-nuc-journey.md) |

### Phase 2 横断確定事項

- **業界呼称の統一**: Reverse Trial / Tier Change / Voluntary・Involuntary churn / Edition Bifurcation を SSOT として確定
- **超過リソース処理 = Notion 型 Pattern A** (read-only + 復元可) を全領域共通方針として採用 (Reverse Trial 終了 ⇔ 手動ダウンを同一機構で実装、Phase 5 申し送り)
- **文言 atom 「失う/消える」排除原則** (Calendly 反面教師): `PLAN_CHANGE_TERMS` (changeVerb/archive/restore/protected/resumeReady) を terms.ts 拡張候補 (ADR-0045 整合)
- **子供 UI 完全 zero touch**: 全 7 ジャーニーで子供 UI に課金/プラン/dunning/trial 関連 UI 一切表示禁止 (ADR-0012 完全担保)

### Phase 3/4/5 申し送り (Phase 2 で抽出された改善要項目)

**Phase 3 (UI, #2528)** — 11 項目
- お勧めバッジ (standard に decoy 効果) / 比較表差分強調 / ROI framing (1 日 ¥16, 家族 1 人 ¥260) / `CANCEL_TERMS.anytimeOk` CTA 直下
- proration 差額 confirm モーダル (`create_preview` 結果表示) / DowngradeResourceSelector 文言 atom 化
- ヘッダ有料時 plan-badge クリック遷移追加 / 期末ダウン期間中 banner / archived の親画面 read-only + 上位プラン CTA
- success polling UI (Phase 1 FR-6) / 特商法最終確認画面 6 項目

**Phase 4 (動線, #2529)** — 5 項目
- LP→app 統一 CTA 文言 (`CTA_TERMS.freeTrialVerb` atom) / LP pricing FAQ 強化 / trial→in-app paywall (Reverse Trial パターン C) / One-click reactivation 常時表示 / アップ動線統一 CTA

**Phase 5 (アーキ, #2530)** — 8 項目
- `subscriptions.update` + `proration_behavior=always_invoice` (アップ即時) + `none + schedule_at_period_end` (ダウン期末)
- Preview API (`POST /v1/invoices/create_preview`)
- `archiveForDowngrade` を Reverse Trial 終了でも再利用 (共通機構化、`resource-archive-service.ts` 統合)
- `PLAN_CHANGE_TERMS` atom + `PLAN_CHANGE_LABELS` compound 追加
- Stripe Pricing Table vs 自前 Checkout の判断 / Customer Portal cancellation reasons 設定
- Product 構成 (1 Product 4 Price vs 4 Product) / webhook 冪等性 DB 新規

**Phase 1 からの申し送り (継続)**: Product 構成 (#2535→Phase 5) / 最終確認画面実装方式 (#2541→Phase 3/5) / judgment 保留テーブル (#2538→Phase 5)

## Phase 3-7 への接続

- **Phase 3 (UI, #2528)** / **Phase 4 (動線, #2529)** / **Phase 5 (アーキ, #2530)** / **Phase 6 (実装詳細, #2514)** / **Phase 7 (実装, #2531)**

## 横断確定事項

- **対象市場**: 日本国内のみ (PIPC、COPPA 適用外)。i18n は素地のみ (多言語実装は Pre-PMF 外)
- **Pre-PMF で作らない過剰防衛**: IP allowlist / Stripe Radar / WAF / 汎用監査ログ / DRM
- **データ削除順**: 退会時 Stripe (subscription cancel + Customer 削除) → DB 削除 (ADR-0022)
