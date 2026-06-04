# 親管理画面ナビ階層 5 tab 化 + family カテゴリ新設 設計経緯

## 議論の発端

- **日時**: 2026-05-17 (PO 報告) → 2026-05-18 (実装)
- **発端 Issue / セッション**: EPIC #2176 / #2177 (NAV_CATEGORIES SSOT 改訂)
- **問題意識**: PO 報告「『こども』が『活動』配下にある違和感」+ 将来「家族グループ招待 / テナント名設定 / 家族プロフィール」配置先不在

過去経緯:

- #337 (2026-04-04): 4 カテゴリ設計 (みまもり/はげまし/カスタマイズ/設定)、こども = 設定配下
- #1396 (2026-04-27): 5 tab 実装 (home + 4 dropdown) を経て、admin-ia.md v1.0 (#1395) で 3 カテゴリ (活動/記録/設定) に整理。こども = 活動配下 (頻度ベース分類)
- 累積観察 5 件目: Push-3 #2117 / MP-4 #2139 / Phase Category-Collapsible #2148 / Phase Reward-Shop-UX #2154 / Phase Milestone-Notification-UX #2167 と同型の「設計優先度変更」パターン

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A (採用) | 5 tab + family カテゴリ新設、こども + メンバー を family 配下に subject-first 上位化 | PO 確定、Family Link / iOS HIG / Material 3 業界整合 |
| 案 B | 4 tab 維持、こども→記録 への移動 / カテゴリ名「家族」へリネーム等のタブ名工夫のみ | PO 違和感の根本「subject-first 不在」を解決しない |
| 案 C | 6+ tab 拡張 (家族 + こども + メンバー を独立 tab 化) | iOS HIG 5 tab 上限 / Material 3 3-5 destinations 仕様逸脱 |
| 案 D | 「みんなのテンプレート」を家族配下に移動 | Notion / Linear 等業界整合は「テンプレート = 活動配下」、subject 関係性が薄い |

## 棄却理由

- **案 B 棄却理由**: タブ名工夫だけでは「こども」「メンバー」が別カテゴリに分散したままで、family グループ概念が UI に表現されない。将来 aspirational (招待 / テナント名 / プロフィール) の配置先も不在のまま
- **案 C 棄却理由**: iOS HIG 「5 tab 上限」公式仕様。Material Design 3 も「3-5 destinations」明示。6 tab は label truncation で iPhone SE 375pt で破綻。tab bar は cognitive load 観点でも 5 上限が業界 prior art
- **案 D 棄却理由**: Phase C2 一次確認で Notion / Linear / GitHub / Stripe ともテンプレート機能を「活動 / 機能」配下に配置している。家族 (subject) 配下に置くと「他家族のテンプレートを家族の一員として扱う」誤解が生じる

## 採用案とその理由

### 採用案: 5 tab + family カテゴリ新設

```
ホーム (🏠、dropdown なし)
家族 (👨‍👩‍👧)     ← 新規
  こども
  メンバー
活動 (🎮)
  活動管理 / チェックリスト / イベント / チャレンジ / テンプレート
記録 (📊)
  レポート / グロースブック / アナリティクス / ポイント / おうえん / ごほうび
設定 (⚙️)
  設定 / プラン / 請求管理
```

### 採用理由

**1. 業界 prior art 9 件整合 (Phase Admin-Nav-Restructure research)**

- **親向け SaaS 5 件**: Family Link (subject-first 厳密) / Apple Family Sharing / Microsoft Family Safety / Bark / ClassDojo (hybrid)
- **一般 admin SaaS 4 件**: Stripe / Notion / Linear / GitHub (Settings 階層メニュー集約パターン)

Family Link 流の subject-first を最優先採用。理由: ターゲットユーザ (親) が「自分の家族 (subject)」を最初に意識し、その下に「家族で使う機能 (function)」を配置する mental model が業界標準

**2. iOS HIG / Material 3 仕様準拠**

- **iOS HIG**: tab bar 5 タブ上限、78pt/tab で iPhone 12 (390pt) ジャスト収容
- **Material Design 3**: bottom navigation 3-5 destinations 仕様化、container 80dp / icon 24dp / target 48×48dp
- **5 tab 採用 SaaS 6 件実機確認 (Phase C2)**: App Store / Instagram (2025) / X / LinkedIn / Roblox / Linear

**3. 将来拡張視点 (PO 拡張、`docs/design/family-group-management.md` aspirational)**

「招待 / テナント名 / プロフィール」が将来 committed 昇格時、family カテゴリ配下に追加するだけで違和感なく統合可能。v1.0 の頻度ベース分類だと「招待 = 設定配下 ?」「テナント名 = 活動配下 ?」と毎回再議論が必要

**4. ADR-0010 Pre-PMF 整合**

- Q1: P1 親「こども管理を上位タブで素早く見つける」体験向上 (subject-first)
- Q3: 不可能 (high 相当) — 親管理画面ナビは Pre-PMF コア体験、業界水準逸脱は離脱要因
- Q5: 釣り合う (工数 6-10h、長期 UX 改善 + 将来拡張視点)

## 残された懸念・フォローアップ

- [ ] 家族グループ招待リンク (aspirational → committed 昇格) の Issue 起票時期 — `docs/design/family-group-management.md §3.3` 参照
- [ ] テナント名 (家族グループ名) 設定 (aspirational → committed 昇格) の Issue 起票時期 — 同上
- [ ] family カテゴリ dropdown に items 2 件のみは少ない印象もあるが、aspirational 昇格で 3-5 件まで自然に育つ想定。Phase 1 では 2 件のまま許容
- [ ] iPhone SE 375pt で 5 tab + label が破綻しないかの実機検証 — #2178 で 3 breakpoint SS + responsive E2E で担保
- [ ] チュートリアル (tutorial-chapters.ts) のカテゴリ数言及があれば追従更新 — #2178 で同時対応

## 関連

- **議論源 Issue / PR**: #2176 (EPIC) / #2177 (NAV_CATEGORIES SSOT) / #2178 (AdminLayout 実装) / #2179 (family-group-management SSOT) / #2180 (checklist 拡張)
- **影響を受ける設計書**:
  - `docs/design/admin-ia.md` v1.0 → v2.0 (本 EPIC で改訂)
  - `docs/design/family-group-management.md` (本 EPIC で新設)
  - `docs/design/06-UI設計書.md` (link 追加)
- **関連 ADR**:
  - [ADR-0010 Pre-PMF scope 判断](../decisions/0010-pre-pmf-scope-judgment.md)
  - [ADR-0013 LP truth](../decisions/0013-lp-truth-from-implementation.md) — aspirational/committed 分離
  - 旧 ADR-0014 labels / i18n 機構選定（OSS 先調査整合、#2440 PR-A5 で削除。OSS 先調査ルールは [docs/decisions/README.md](../decisions/README.md) + issue-triage SKILL に移管、git 履歴参照）
  - 旧 ADR-0015 年齢帯 variant 管理（親管理画面は年齢非依存、#2440 PR-A5 で削除。variant 管理パターンは `src/routes/CLAUDE.md` §年齢帯 variant が SSOT、git 履歴参照）
