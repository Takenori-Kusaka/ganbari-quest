# 0028. Pre-PMF 期 founder 直対応動線は LP 不要、footer mailto に集約

- **Status**: Accepted
- **Date**: 2026-04-30
- **Related Issue**: #1713 (R7)
- **Supersedes**: ADR-0023 §I8 (founder 1:1 ヒアリング動線、#1594)
- **Related ADRs**: ADR-0010 (Pre-PMF スコープ判断), ADR-0012 (Anti-engagement 原則), ADR-0013 (LP truth from implementation)

## 背景

#1594 で ADR-0023 §I8 として LP `site/index.html` に `<section id="founder-inquiry">` セクションを追加し、Pre-PMF 期に「founder（個人開発者）が初期 ~10 保護者契約まで全員と直接対話する動線」を提供する設計を採用した。"do things that don't scale" を LP に明示し、個人開発の強みとして訴求する意図だった。

しかし 2026-04-30 PO 再レビュー (`tmp/reviews/lp-2026-04-30/`) で以下の致命的問題が判明した:

1. **ADR-0013 LP truth 違反**: LP に「Pre-PMF」という内部用語を露出させていた。LP 訴求は実装の事実を SSOT とし、社内開発フェーズ用語を露出させるのは禁忌
2. **最終 CTA の分散**: `#founder-inquiry` セクションに「直接相談する（無料）」「メールで送る」の 2 CTA が並び、後続の `[09] 最終 CTA` 「無料で始める」と合わせて 3 CTA が縦に並列する。営業観点で致命的に散漫
3. **PO 対応キャパ超過**: PO 直判定 (2026-04-30): 「そんな対応する気はない」。個人開発のため founder 直対応の物理的処理能力が ~10 保護者契約規模を超えており、LP で動線を出すと対応しきれない
4. **lp-content-map.md §4.4 LP コンテンツ追加 gate 全項目不通過**: 顧客語彙 / 実装の事実 / 顧客価値の実証 / Anti-engagement 適合 の 4 項目すべて gate を通過していなかった（事後確認）

## 決定

### 1. LP `#founder-inquiry` セクション削除

- `site/index.html:1041-1049` の `<section id="founder-inquiry">` を全削除
- 関連 CSS (`.founder-inquiry` / `.founder-inquiry-inner` / `.founder-inquiry-heading` / `.founder-inquiry-cta`) も削除
- `LP_FOUNDER_INQUIRY_LABELS` (labels.ts) は #1770 で空オブジェクト化 → #1772 で完全削除（parseBlock を「定数不在時に空オブジェクトを返す」よう改修）

### 2. 連絡導線の集約

- 連絡導線は footer の `mailto:` リンク (`LP_FOOTER_LABELS.contactLink`) に集約
- Pre-PMF 期の「困った保護者」は footer mailto から連絡する。1 動線に絞ることで保護者の認知負荷も減る

### 3. `/inquiry/founder` ルート存続判定

- ルート自体は **存続**（admin sidebar / footer link 経由で利用可能）
- LP からの導線は外すが、admin 画面に既にリンクがあり、footer mailto では拾いきれないフォーム形式の問い合わせ用に残す
- `FOUNDER_INQUIRY_LABELS` (labels.ts) も維持（admin / `/inquiry/founder` ページで使用）

### 4. ADR-0023 §I8 supersede

- 本 ADR-0028 が ADR-0023 §I8 を supersede する
- ADR-0023 は ADR-0031 (#1780) で Deprecated 化され、`docs/decisions/archive/0023-marketing-policy-pre-pmf.md` にプレースホルダが配置済み。本 ADR-0028 を新たな SSOT とする
- 「Pre-PMF 期 founder 直対応動線は LP に出さない」を明示的方針として確立

## 検討した選択肢

| 案 | 内容 | 採否 |
|---|---|---|
| **案 A（採用）** | LP セクション削除 + footer mailto 集約 | **採用**: 最終 CTA 一本化 + 内部用語排除 + PO キャパ整合 |
| 案 B | LP セクション維持しつつ「Pre-PMF」表現を削除 | 棄却: 最終 CTA 分散の根本問題が解決しない |
| 案 C | LP セクション維持 + 受付状況メッセージ追加 (例: 「現在受付中: 残り 5 枠」) | 棄却: 在庫表現は ADR-0012 Anti-engagement と相性悪 + PO 運用負荷が増える |
| 案 D | LP セクション削除 + `/inquiry/founder` ルート自体も削除 | 棄却: admin 内導線で既に運用されており、admin 経由の問い合わせは引き続き受け付ける |

## 影響

### Positive

- **最終 CTA 一本化**: `[09] 最終 CTA「無料で始める」` のみに集中し、保護者の意思決定が明確化
- **mobileHeight 削減**: 200-600px 削減見込み（LP 縦長対策 #1737 と整合）
- **「Pre-PMF」内部用語の LP 露出ゼロ**: ADR-0013 LP truth 原則を遵守
- **PO 対応キャパ適合**: 個人開発の物理的処理能力に整合した設計

### Negative / Risk

- **保護者からの直接相談機会の減少**: footer mailto は CTA としての視認性が低い。但しこれは Pre-PMF 段階では PO 対応キャパに合わせる必要があり許容範囲
- **`/inquiry/founder` ルート未参照リスク**: LP からのリンクが消えるため、admin / footer mailto 以外からの導線が無くなる。admin に明示的リンクがあることを定期的に確認する必要あり

## 検証

- [x] `grep -n "founder-inquiry" site/index.html` → 0 件
- [x] footer の `mailto:` リンクが残存（連絡導線確保）
- [x] LP `#founder-inquiry` セレクタが DOM に存在しない
- [x] `LP_FOUNDER_INQUIRY_LABELS` 空オブジェクト化で generate-lp-labels.mjs が壊れない
- [x] `/inquiry/founder` ルートは存続（admin sidebar / footer link 経由で参照可能）

## 関連 ADR からの参照

- ADR-0010: Pre-PMF スコープ判断 — Pre-PMF 段階で対応キャパ整合性を優先
- ADR-0012: Anti-engagement 原則 — 「在庫表現」「受付残枠」のような射幸性を持ち込まない
- ADR-0013: LP truth from implementation — LP に内部用語（「Pre-PMF」等）を露出させない
