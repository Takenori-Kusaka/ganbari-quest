# Research 09: 子供画面チャレンジ達成通知 UX modernization 比較研究 (bell + dot badge + 年齢別 variant + history 拡張)

> **methodology**: `docs/reference/deep-research-request-methodology.md` §4.3 「大規模 (6 軸 Deep Research + 一次ソース 10 件確認)」
>
> **対象 EPIC**: #2167 (子供画面チャレンジ達成通知 UX modernization EPIC)
>
> **対象子 Issue**: #2168 (MN-1 bell + dot badge) / #2169 (MN-2 年齢別 variant + ひらがな統一) / #2170 (MN-3 history 4 タブ階層) / MN-4 (機能完成度 checklist 拡張)
>
> **実装 PR**: #2232 (MN-1 + 関連 z-index トークン化 / Dialog primitive 移行) / #2237 (MN-2 + MN-3 + Banner SSOT 整合)
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-17

---

## 1. 調査目的

子供画面のチャレンジ達成通知 (#1 種別、`MilestoneBanner`) が業界比較で著しく重要度過多・語彙混在の状態 (PO 報告 2026-05-17、SS 064956) を全面 modernization で解消する根拠を残す。本研究は以下 6 軸で 10 件 prior art を比較し、EPIC #2167 の方針 (bell + dot badge + 年齢別 variant + history 4 タブ + 機能完成度 checklist 拡張) を確定する。

- **軸 A**: 業界 prior art 10 件 (子供向け教育 SaaS 4 / デザインシステム 4 / ソシャゲ 2)
- **軸 B**: 通知 UI パターン (横長 banner vs bell + badge vs HUD corner)
- **軸 C**: 年齢別 variant 化方針 (ひらがな / 漢字混在解消)
- **軸 D**: history 画面拡張 (1 種類 → 4 タブ階層)
- **軸 E**: EPIC 分割粒度 (α 4 子 Issue + 並列 4 別 Issue / β 1 PR 統合 / γ 撤去)
- **軸 F**: 通知 3 種類整理 (#1 達成通知 / #2 Push / #3 メール)

---

## 2. 軸 A: 業界 prior art 10 件 (一次ソース確認済)

### 2.1 子供向け教育 SaaS 4 件

| サービス | 達成通知 UX 観察 | 一次ソース | 採用判定 |
|---|---|---|---|
| **Khan Academy Kids** | 3 色 checkmark (赤/青/緑) + sparkle particle + truck delivery animation (受取時)、画面占拠なし | Khan Academy zendesk ( https://help.khanacademy.org ) | **採用 (祝福演出は #2158 ごほうび側で対応済、本 EPIC は notification のみ)** |
| **Duolingo Kids** | XP 獲得時に小型 toast + キャラクター jump、ストリーク達成は header badge | Duolingo blog ( https://blog.duolingo.com ) | **採用** — toast + header badge 組合せ |
| **ABCmouse** (Ticket Town) | HUD top-right orange circle にチケット数表示、達成時は circle が pulse、Ticket Town 独立空間で詳細確認 | ABCmouse Help ( https://help.ageoflearning.com ) | **採用 (首位)** — HUD corner pattern (header bell + badge と整合) |
| **Adventure Academy** | キャラクターアバター + bubble notification (画面右下小型 popover) | Age of Learning 公式 ( https://www.ageoflearning.com/adventure-academy ) | **採用** — corner popover pattern |

**共通観察**: 子供向け教育 SaaS 4 件全てで「**横長 alert banner で画面占拠**」は採用していない。corner / HUD / popover 型が主流。

### 2.2 デザインシステム 4 件

| デザインシステム | 非緊急達成通知の推奨 | 一次ソース | 採用判定 |
|---|---|---|---|
| **NN/g (Nielsen Norman Group)** | 「非緊急通知は dot badge / corner popover が推奨。alert banner は緊急エラー専用」 | NN/g articles "Notifications" ( https://www.nngroup.com/articles/indicators-validations-notifications/ ) | **採用 (根拠)** |
| **Material Design 3** | "Snackbars" は一時的、"Badges" は header icon に dot で件数表示が標準 | Material 3 spec ( https://m3.material.io/components/badges/specs ) | **採用 (首位)** — bell + dot badge の SDK reference |
| **iOS Human Interface Guidelines** | "Badges" は app icon または tab bar item に dot / 数値で表示 | Apple HIG ( https://developer.apple.com/design/human-interface-guidelines/badging ) | **採用** — dot badge 業界標準根拠 |
| **Carbon Design System (IBM)** | "Notification" の inline 型は緊急エラー専用、非緊急は toast / badge | Carbon Design ( https://carbondesignsystem.com/components/notification/usage/ ) | **採用 (根拠)** |

**共通観察**: 4 件全てで「非緊急達成通知 = corner popover / dot badge」推奨、alert banner は緊急エラー専用と区別。

### 2.3 ソシャゲ 2 件 (参考と反面教師)

| 作品 | 達成通知 UX 観察 | 一次ソース | 採用判定 |
|---|---|---|---|
| **ポケモンユナイト** | 3 段階トロフィー段位 (Beginner / Great / Expert) + 達成時 modal 演出 (1-2 秒) | The Pokémon Company 公式 ( https://www.pokemonunite.jp ) | **採用 (MILESTONES thresholds 参考)** — 段階的しきい値設計 |
| **原神** (実績システム) | 詳細実績画面 + 達成時 toast 右上 + コレクション要素 | miHoYo HoYoLAB 公式 | **構造分解 (棄却)** — ADR-0012 不採用 (詳細実績 + コレクションは滞在延伸要素) |

---

## 3. 軸 B: 通知 UI パターン比較

### 3.1 候補 B1: 横長 alert banner (現状、棄却)

| 項目 | 内容 |
|---|---|
| 概要 | 画面上部に横長 alert (`<MilestoneBanner>` 旧実装) で達成通知表示 |
| メリット | 視認性高 |
| デメリット | **画面占拠** で本来の活動カード視認が阻害される (PO 2026-05-17 報告)、業界 prior art 8 件全件で不採用 |
| 採用判定 | **棄却 (本 EPIC の核心課題)** |

### 3.2 候補 B2: bell icon + dot badge (採用、首位)

| 項目 | 内容 |
|---|---|
| 概要 | Header に bell icon + dot badge で新着件数表示、click で history 画面遷移 |
| 1 次ソース | Material 3 Badges spec + iOS HIG Badging + ABCmouse HUD pattern |
| メリット | 画面占拠ゼロ / ADR-0012 anti-engagement 適合 / 子供向け教育 SaaS 業界標準 |
| デメリット | 件数 0 時は render skip (適切なフォールバック) |
| 採用判定 | **採用 (首位、#2168 で実装、PR #2232)** |

### 3.3 候補 B3: フルスクリーン modal + コンフェッティ (棄却)

| 項目 | 内容 |
|---|---|
| 概要 | 達成瞬間にフルスクリーン modal + 動画演出 3-5 秒 |
| デメリット | ADR-0012 anti-engagement 抵触、子供の作業中断を強制 |
| 採用判定 | **棄却** |

---

## 4. 軸 C: 年齢別 variant 化方針

### 4.1 現状の構造的欠陥

`MILESTONE_LABELS` で:
- `title: '5 かい きろく'` (ひらがな、preschool 向け)
- `description: '5 回の活動を記録できました'` (漢字、elementary 以上向け)

が同一カード内で混在。対象ペルソナが曖昧で UX 品質低下。

### 4.2 候補 C1: ADR-0015 年齢帯 variant パターン適用 (採用)

| 項目 | 内容 |
|---|---|
| 概要 | `getMilestoneLabel(id, { ageTier })` helper で preschool=ひらがな / elementary 以上=漢字 を解決 |
| 1 次ソース | ADR-0015 (年齢帯 variant 管理アーキテクチャ) — `getLabel(key, ctx)` パターン適用 |
| メリット | 文脈別使い分けルール (DESIGN.md §6) 整合、用語変更 1 箇所修正で全 callers に伝播 |
| デメリット | helper + 内部 HIRAGANA / KANJI map で行数増 (約 90 行) |
| 採用判定 | **採用 (#2169 で実装、PR #2237)** |

### 4.3 候補 C2: i18n ライブラリ (svelte-i18n / inlang) 導入 (棄却)

| 項目 | 内容 |
|---|---|
| 概要 | i18n フレームワークで locale = `ja-hiragana` / `ja-kanji` 切替 |
| デメリット | 単一言語内 variant に i18n は過剰、ADR-0014 (labels SSOT) と矛盾 |
| 採用判定 | **棄却 (Pre-PMF YAGNI)** |

### 4.4 「マイルストーン」カタカナ語彙の置換

子供向けに不適切 → `getMilestoneBannerTitle(ctx)` で「やったね！」(preschool) / 「達成しました」(kanji) を返す。Bell aria-label も「新着のおしらせ」に置換 (旧「マイルストーン N件」撤去)。

---

## 5. 軸 D: history 画面拡張 (1 種類 → 4 タブ階層)

### 5.1 現状の構造的欠陥

history 画面に活動ログのみ表示、達成履歴・購入履歴・マイルストーン達成履歴の時系列管理データ不在 (PO 指摘: 達成 / 購入履歴が扱えない)。

### 5.2 候補 D1: 単一リスト + フィルタ (棄却)

| 項目 | 内容 |
|---|---|
| 概要 | 1 つのリストに全 history を混在表示 + filter chip で絞込 |
| デメリット | 子供向け情報量過多、対象ペルソナと表示画面の整合困難 |
| 採用判定 | **棄却** |

### 5.3 候補 D2: 4 タブ階層 (採用、PO 判断 #3 = A)

| タブ | 子供向けラベル (preschool / kanji) | データソース |
|---|---|---|
| 活動 | かつどう / 活動 | 既存 activity 履歴 (変更なし) |
| 達成 | できたこと / 達成 | `getActiveChallengesForChild` (sibling-challenge service) |
| 交換 | こうかん / 交換 | `getRedemptionRequestsForChild` (reward-redemption service) |
| 記念 | やったね / 記念 | `getTenantValuePreview().children.find().milestones.filter(achieved)` |

| 項目 | 内容 |
|---|---|
| 1 次ソース | Ark UI Tabs primitive ( https://ark-ui.com/svelte/docs/components/tabs ) — WAI-ARIA tabpanel 準拠 |
| 並列取得 | `Promise.allSettled` で 4 source 並列、N+1 なし |
| URL 永続 | `?kind=...` search param、`onValueChange` で `goto({ replaceState: true })` (履歴汚染なし) |
| 採用判定 | **採用 (#2170 で実装、PR #2237)** |

### 5.4 各タブ empty state

- 活動: 既存 (変更なし)
- 達成: 「まだチャレンジきろくがないよ」 (variants で年齢別)
- 交換: 「まだこうかんしたごほうびがないよ」
- 記念: 「まだ記念がないよ」

---

## 6. 軸 E: EPIC 分割粒度

### 6.1 候補 E-α (採用): EPIC + 4 子 Issue + 並列 4 別 Issue

| 子 Issue | スコープ | 実装 PR |
|---|---|---|
| MN-1 (#2168) | bell + dot badge 化 | PR #2232 |
| MN-2 (#2169) | 年齢別 variant + ひらがな統一 | PR #2237 |
| MN-3 (#2170) | history 4 タブ階層 | PR #2237 |
| MN-4 | 機能完成度 checklist 拡張 | 別途 |

**並列起票 4 別 Issue**: ChallengeBanner vs MilestoneBanner 命名統一 (#2172) / #1600 親レポート別実装確認 / MILESTONES thresholds 妥当性 / 実績システム命名残存解消 route rename (#2175)

| メリット | デメリット |
|---|---|
| レビュー粒度小、リスク分散 | PR 数 2-3 (実装は #2232 + #2237 に統合) |
| 並列起票で本 EPIC scope を逸脱せず、関連課題を分離 | EPIC + 8 Issue で起票数増 |

**採用判定**: PO 確定

### 6.2 候補 E-β / E-γ (棄却)

- β (1 PR 統合): PR 規模過大、棄却
- γ (撤去 / Coming Soon): 達成通知はコア体験、棄却

---

## 7. 軸 F: 通知 3 種類整理

PO 整理 (2026-05-17):

| 種別 | 対象 | scope | 本 EPIC scope |
|---|---|---|---|
| #1 チャレンジ達成通知 (子供画面) | 子供 | bell + badge + history | **本 EPIC scope** |
| #2 Push 通知 | 子供 / 親 | 別 Phase (#2117 Push-3) | 別 Phase |
| #3 メール通知 | 家族 owner | weekly-report-service 別実装 | 別実装 |

本 EPIC は **#1 のみ** に focus し、#2 / #3 の動作確認は別 Phase で扱う (scope creep 防止)。

---

## 8. ADR 整合性確認

- **ADR-0010**: Pre-PMF scope 判断 — bell + badge は Bucket A (コア体験品質改善)、history 4 タブは Bucket A、i18n ライブラリ導入は Bucket B (棄却)
- **ADR-0012**: Anti-engagement — alert banner 画面占拠 / フルスクリーン modal はいずれも棄却
- **ADR-0013**: LP truth — LP 側に bell + badge / history 4 タブ訴求は追加せず、実装の事実のみ
- **ADR-0014**: labels / i18n 機構選定 (OSS 先調査) — i18n ライブラリ vs ADR-0015 helper パターンの選択 (後者採用)
- **ADR-0015**: 年齢帯 variant 管理アーキテクチャ — `getMilestoneLabel(id, ctx)` パターン整合

新規 ADR 起票は不要 (ADR 10 件超過状態)。

---

## 9. 実装結果サマリ (PR #2232 / #2237)

### PR #2232: bell + badge + z-index トークン化 + Dialog primitive 移行 (closes #2106 / #2107 / #2168 / #2175)

- `src/lib/features/value-preview/MilestoneBellButton.svelte` 新規 (151 行) — bell icon + dot badge、件数 0 で render skip、click で `goto('/${uiMode}/challenges')`
- `src/routes/(child)/+layout.svelte` — 旧 `<MilestoneBanner>` 撤去、Header の notificationSlot snippet 経由で bell button 配備
- `src/lib/ui/primitives/Dialog.svelte` — `zLayer` prop 追加 (`reward` / `tutorial` / `celebration`)、Sibling 2 件を Dialog primitive 化
- `src/lib/server/routing/legacy-url-map.ts` — `/achievements` → `/challenges` の 5 年齢モード分 redirect entry 追加
- 物理 rename: `src/routes/(child)/[uiMode=uiMode]/(character)/achievements/` → `challenges/`
- `tests/unit/routing/legacy-url-map.test.ts` (5 mode × find/rewrite cases) + `tests/e2e/legacy-url-redirect.spec.ts` (5 mode redirect + クエリ保持)

### PR #2237: MILESTONE_LABELS 年齢別 variant + history 4 タブ + Banner SSOT 整合 (closes #2169 / #2170 / #2172)

- `src/lib/domain/labels.ts` — `getMilestoneLabel(id, ctx)` + `getMilestoneBannerTitle(ctx)` helper 追加 (約 90 行)、内部 `MILESTONE_HIRAGANA` / `MILESTONE_KANJI` map
- `src/routes/(child)/[uiMode=uiMode]/(character)/history/+page.{server.ts,svelte}` — 4 タブ階層 (活動 / 達成 / 交換 / 記念) + `Promise.allSettled` で 4 source 並列取得
- `src/lib/features/child-home/variants/index.ts` — history 4 タブラベル + empty state を variants 追加
- `tests/unit/domain/labels.test.ts` (8 cases 追加: 6 マイルストーン × 4 年齢 + AC2 カタカナ非含有 assertion)
- `docs/design/06-UI設計書.md` §18.9 / §18.10 + 1.25 履歴 — `MilestoneBanner` / `ChallengeBanner` / `MilestoneBellButton` 3 component の用途・依存関係・命名根拠を SSOT 化

### 設計書同期

- `docs/design/06-UI設計書.md` §18.9 (3 component SSOT) / §18.10 (history 4 タブ + bell click 連携)
- `docs/design/asset-catalog.md` — LP screenshot 撮影元 URL を `/elementary/challenges` に同期

---

## 10. 残課題 / 後続 Issue

- MN-4 (機能完成度 checklist 拡張) は ADR-0010 §7 拡張で別途進行 (RS-5 #2159 と統合、PR #2236 で完了)
- ChallengeBanner vs MilestoneBanner の物理 rename は #2172 で命名根拠を SSOT 化、実体 rename は将来判断
- #1600 親レポート別実装確認 (別 Issue 並列起票で扱う)
- MILESTONES thresholds 妥当性は #2174 で rationale 確認済 (PR #2242)

---

## 11. 参照

- EPIC #2167 本文 (AC1 で本 research doc commit を指定)
- 補足 research: `docs/reference/09b-research-milestone-notification-prior-art-primary-source.md` (一次ソース 10 件確認の詳細)
- ADR-0012: Anti-engagement 原則 — alert banner 画面占拠 / modal フルスクリーン棄却の根拠
- ADR-0015: 年齢帯 variant 管理アーキテクチャ — `getMilestoneLabel(id, ctx)` パターン整合
- ADR-0014: labels / i18n 機構選定 (OSS 先調査) — i18n vs helper 選択の根拠
- ADR-0013: LP truth — bell + badge / history 4 タブを LP 訴求しない方針
- 26-ゲーミフィケーション設計書.md §13: 実績システム廃止記録 (#404 / #1782)
- DESIGN.md §10: z-index トークン階層 (PR #2232 の z-index 生数値撤去根拠)
- `feedback_oss_first_principle.md` / `feedback_ssot_verification_before_proposal.md`
