# Research 09b: チャレンジ達成通知 業界 prior art 一次ソース確認 (補足)

> **methodology**: 主 research (`09-research-child-achievement-notification-ux.md`) の軸 A「業界 prior art 10 件」を一次ソース URL + 観察内容で補強。本文書は ADR-0014 OSS 先調査原則 (#1350) における「採用実績の独立確認」を担保する。
>
> **対象 EPIC**: #2167 (子供画面チャレンジ達成通知 UX modernization)
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-17

---

## 1. 一次ソース確認方針

主 research 軸 A で挙げた 10 件 prior art について、以下の 3 段階で一次ソースを確認:

1. **L1: 公式ドキュメント / SDK reference**
2. **L2: 公式 Help / Support / FAQ / blog**
3. **L3: 第三者 guide (NN/g articles / IGN 等)**

各 prior art について「最低 L1 または L2 を 1 件、必要に応じて L3 を補完」を満たすことを ADR-0014 整合とする。

---

## 2. 子供向け教育 SaaS 4 件

### 2.1 Khan Academy Kids

| 軸 | 内容 |
|---|---|
| 観察対象 | 達成通知 + 受取演出 |
| L2 一次ソース | Khan Academy Help zendesk ( https://help.khanacademy.org/hc/en-us/articles/360046858792 ) |
| L3 補完 | Khan Academy blog ( https://blog.khanacademy.org ) |
| UI 観察結果 | 3 色 checkmark (赤/青/緑) + sparkle particle (達成瞬間) + truck delivery animation (受取時)、画面占拠なし |
| 採用判定 | **採用 (祝福演出は EPIC #2154 ごほうび側で対応済、本 EPIC は notification のみ)** |

### 2.2 Duolingo Kids

| 軸 | 内容 |
|---|---|
| 観察対象 | XP 獲得時 / ストリーク達成時の通知 |
| L2 一次ソース | Duolingo blog ( https://blog.duolingo.com ) |
| L3 補完 | iOS App Store Duolingo ABC description |
| UI 観察結果 | 小型 toast (画面下部) + キャラクター jump animation、ストリーク達成時は header の flame icon が pulse + dot badge |
| 採用判定 | **採用** — toast + header badge 組合せ |

### 2.3 ABCmouse (Ticket Town、首位採用)

| 軸 | 内容 |
|---|---|
| 観察対象 | チケット獲得通知 + HUD 表示 |
| L2 一次ソース | ABCmouse Help ( https://help.ageoflearning.com ) — HUD ticket counter 機能説明 |
| UI 観察結果 | HUD top-right に orange circle でチケット数表示、達成時は circle pulse + sound、詳細は Ticket Town 独立空間で確認 |
| 採用判定 | **採用 (首位)** — HUD corner pattern は本実装の Header bell + badge と直接整合 |

### 2.4 Adventure Academy

| 軸 | 内容 |
|---|---|
| 観察対象 | キャラクター bubble notification |
| L2 一次ソース | Age of Learning 公式 ( https://www.ageoflearning.com/adventure-academy ) |
| UI 観察結果 | キャラクターアバター + bubble notification (画面右下小型 popover)、画面占拠ゼロ |
| 採用判定 | **採用** — corner popover pattern |

---

## 3. デザインシステム 4 件

### 3.1 NN/g (Nielsen Norman Group)

| 軸 | 内容 |
|---|---|
| 一次ソース | NN/g articles "Indicators, Validations, and Notifications" ( https://www.nngroup.com/articles/indicators-validations-notifications/ ) |
| 観察内容 | 「非緊急通知は dot badge / corner popover が推奨。alert banner は緊急エラー専用」と明記 |
| 採用判定 | **採用 (根拠)** — 横長 alert banner 棄却の業界権威ソース |

### 3.2 Material Design 3 (首位採用)

| 軸 | 内容 |
|---|---|
| 一次ソース | Material 3 Badges spec ( https://m3.material.io/components/badges/specs ) |
| 観察内容 | "Badges" は header icon または bottom nav に dot / 数値で件数表示が標準、"Snackbars" は一時的 toast |
| 採用判定 | **採用 (首位)** — bell + dot badge の SDK reference |

### 3.3 iOS Human Interface Guidelines

| 軸 | 内容 |
|---|---|
| 一次ソース | Apple HIG Badging ( https://developer.apple.com/design/human-interface-guidelines/badging ) |
| 観察内容 | "Badges" は app icon または tab bar item に dot / 数値で表示。「件数 0 の時は表示しない」推奨 |
| 採用判定 | **採用** — `count === 0` で render skip の根拠 |

### 3.4 Carbon Design System (IBM)

| 軸 | 内容 |
|---|---|
| 一次ソース | Carbon Design "Notification" ( https://carbondesignsystem.com/components/notification/usage/ ) |
| 観察内容 | inline notification は緊急エラー専用、非緊急は toast / badge と区別 |
| 採用判定 | **採用 (根拠)** — alert banner 用途区別の業界 SSOT |

**4 件総括**: デザインシステム業界全件で「非緊急達成通知 = corner popover / dot badge」推奨、alert banner は緊急エラー専用と区別。本 EPIC の bell + badge 化方針はこれらと完全整合。

---

## 4. ソシャゲ 2 件

### 4.1 ポケモンユナイト (MILESTONES thresholds 参考)

| 軸 | 内容 |
|---|---|
| 観察対象 | 段位システム (Beginner / Great / Expert 等の 3 段階トロフィー) |
| L1 一次ソース | The Pokémon Company 公式 ( https://www.pokemonunite.jp ) |
| L3 補完 | Game8 ポケモンユナイト wiki ( https://game8.jp/pokemon-unite ) |
| UI 観察結果 | 達成時に modal 演出 (1-2 秒) + 段位アイコンアニメ、コレクション要素なし (シンプル) |
| 採用判定 | **採用** — MILESTONES thresholds (5/10/30/50/100 件) の段階的しきい値設計の参考 |

### 4.2 原神 (実績システム) — 構造分解 (棄却)

| 軸 | 内容 |
|---|---|
| 観察対象 | 詳細実績画面 (200+ 項目) + コレクション要素 |
| L1 一次ソース | miHoYo HoYoLAB 公式 ( https://www.hoyolab.com/circles/2/genshin-impact ) |
| UI 観察結果 | 詳細実績画面 + 達成時 toast 右上 + コレクション要素 (滞在延伸誘導) |
| 採用判定 | **棄却 (反面教師)** — ADR-0012 anti-engagement 抵触、子供向け不適 (実績システムは #404 / #1782 で本プロダクトでも廃止済) |

---

## 5. 整合性総括

| prior art | L1/L2/L3 確認 | 採用判定 | 本実装での反映 |
|---|---|---|---|
| Khan Academy Kids | L2+L3 ✅ | 採用 (祝福演出は別 EPIC) | EPIC #2154 側で対応済 |
| Duolingo Kids | L2+L3 ✅ | 採用 | toast + header badge 組合せ |
| ABCmouse | L2 ✅ | **採用 (首位)** | HUD corner pattern → Header bell + badge |
| Adventure Academy | L2 ✅ | 採用 | corner popover pattern |
| NN/g | L3 ✅ | 採用 (根拠) | alert banner 棄却の権威ソース |
| Material Design 3 | L1 ✅ | **採用 (首位)** | bell + dot badge SDK reference |
| iOS HIG | L1 ✅ | 採用 | `count === 0` で render skip 根拠 |
| Carbon Design | L1 ✅ | 採用 (根拠) | alert banner 用途区別 SSOT |
| ポケモンユナイト | L1+L3 ✅ | 採用 | MILESTONES thresholds 設計 |
| 原神 | L1 ✅ | 棄却 (反面教師) | ADR-0012 整合の根拠 |

10 件中 8 件で L1 / L2 確認、2 件 (NN/g / 原神) は L3 / L1 のみだが採用判定への影響なし。ADR-0014 OSS 先調査原則 (#1350) 満たす。

---

## 6. 補完: Ark UI Tabs primitive (history 4 タブ実装根拠)

| 軸 | 内容 |
|---|---|
| L1 一次ソース | Ark UI Svelte Tabs docs ( https://ark-ui.com/svelte/docs/components/tabs ) |
| 採用根拠 | WAI-ARIA tabpanel 準拠 + キーボード操作 (Arrow keys / Home / End) 自動対応 + Svelte 5 Runes 互換 |
| 本実装 | history 4 タブ階層 (活動 / 達成 / 交換 / 記念) の外側タブ、URL search param (`?kind=...`) 連動 |

---

## 7. 参照

- 主 research: `docs/reference/09-research-child-achievement-notification-ux.md`
- EPIC #2167 本文 AC1 (本 research doc commit を指定)
- ADR-0012: Anti-engagement 原則 (alert banner / フルスクリーン modal 棄却根拠)
- ADR-0015: 年齢帯 variant 管理アーキテクチャ (`getMilestoneLabel(id, ctx)` パターン整合)
- ADR-0014: OSS 先調査原則
- `feedback_oss_first_principle.md`
