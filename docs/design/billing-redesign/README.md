# 課金/プラン体系 再設計 — Phase 1 要件定義 (Epic #2525)

| 項目 | 内容 |
|------|------|
| 上位 Epic | #2525 (課金/プラン体系の顧客体験+システム全体再設計、7 phase) |
| 本 Phase | #2526 (Phase 1/7 要件定義) |
| ステータス | Phase 1 完了 (10 機能領域の要件を deep-research 一次情報で自己検証 + PO 確定) |
| 作成日 | 2026-05-27 |

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

## Phase 2-7 への接続

- **Phase 2 (UX, #2527)**: 各機能領域のユーザージャーニーマップ
- **Phase 3 (UI, #2528)** / **Phase 4 (動線, #2529)** / **Phase 5 (アーキ, #2530)** / **Phase 6 (実装詳細, #2514)** / **Phase 7 (実装, #2531)**
- 後続 phase に申し送る論点: Product 構成 (#2535→Phase 5) / 最終確認画面実装方式 (#2541→Phase 3/5) / judgment 保留テーブル (#2538→Phase 5)

## 横断確定事項

- **対象市場**: 日本国内のみ (PIPC、COPPA 適用外)。i18n は素地のみ (多言語実装は Pre-PMF 外)
- **Pre-PMF で作らない過剰防衛**: IP allowlist / Stripe Radar / WAF / 汎用監査ログ / DRM
- **データ削除順**: 退会時 Stripe (subscription cancel + Customer 削除) → DB 削除 (ADR-0022)
