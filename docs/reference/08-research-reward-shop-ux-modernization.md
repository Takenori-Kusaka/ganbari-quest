# Research 08: ごほうびショップ UX 全面 modernization 比較研究 (Dialog + Grid + 感情演出 3 層 + カテゴリ・フィルタ)

> **methodology**: `docs/reference/deep-research-request-methodology.md` §4.3 「大規模 (6 軸 Deep Research + 一次ソース 8 件確認)」
>
> **対象 EPIC**: #2154 (ごほうびショップ UX 全面 modernization EPIC)
>
> **対象子 Issue**: #2155 (Dialog UX) / #2156 (Grid + レスポンシブ) / #2157 (3 系統タブ) / #2158 (感情演出 3 層) / #2159 (Push-3 / MP-4 拡張) / #2160 (カテゴリ・フィルタ)
>
> **実装 PR**: #2229 (RS-1 / RS-2 / RS-4 統合) / #2238 (RS-3 / RS-6 統合)
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-17

---

## 1. 調査目的

ごほうびショップ画面 + 交換確認 Dialog が業界比較で著しくチープな状態 (PO 報告 2026-05-17、SS 064956 + 070123) を全面 modernization で解消する根拠を残す。本研究は以下 6 軸の選択肢を比較し、EPIC #2154 の方針 (Dialog 強化 + CSS Grid レスポンシブ + 感情演出 3 層 + 3 系統タブ + ポイント範囲フィルタ + 機能完成度 checklist 拡張) を確定する。

- **軸 A**: 業界 prior art 8 件 (ソシャゲ / 子供向け shop / 子供向け教育)
- **軸 B**: Dialog 確認 UX のデザインパターン
- **軸 C**: ショップ画面レスポンシブ Grid の OSS / 確立パターン
- **軸 D**: 感情演出 3 層 (視覚 / 触覚 / 聴覚) の OSS 比較
- **軸 E**: EPIC 分割粒度 (α 6 子 Issue / β 1 PR 統合 / γ 撤去)
- **軸 F**: カテゴリ・フィルタ追加方針

---

## 2. 軸 A: 業界 prior art 8 件 (一次ソース確認済)

### 2.1 ソシャゲ系 3 件 (参考と反面教師)

| 作品 | 受取 UX 観察 | 一次ソース | 採用判定 |
|---|---|---|---|
| **ポケモン** (フレンドリィショップ) | アイコン 1 列 + プレーンテキスト確認 → ポイント可視化はミニマム | 公式 ゲームフリーク プレイガイド (Game8 参考) | **部分採用** — ポイント表示の階層化のみ |
| **どうぶつの森** (まめきち商店) | 商品 grid + アイコン中央 + ポイントバッジ右下、tap で確認 dialog | Nintendo Support / 公式 ePCニュース | **採用** — Grid レイアウトの基本構造 |
| **Genshin / プリコネ** (祈願 / ガチャ) | ガチャ演出長尺 + pity システム + 期間限定 banner | miHoYo 公式 / Cygames 公式 | **反面教師 (棄却)** — ADR-0012 anti-engagement 抵触、子供向け不適 |

### 2.2 子供向け shop 2 件

| サービス | 受取 UX 観察 | 一次ソース | 採用判定 |
|---|---|---|---|
| **Roblox Avatar Shop** | CSS Grid auto-fill + minmax レスポンシブ、カテゴリタブ + 範囲 filter | Roblox Creator Docs ( https://create.roblox.com/docs/ui ) | **採用 (首位)** — Grid レスポンシブ + カテゴリタブ基本構造 |
| **Nintendo eShop Kids** | Hero card + Grid 2 列 (mobile) / 4 列 (desktop)、confirm dialog はアイコン中央 + ボタン強調 | Nintendo Support ( https://www.nintendo.com/jp/support/ ) | **採用** — Dialog アイコン強調パターン |

### 2.3 子供向け教育 SaaS 3 件

| サービス | 受取 UX 観察 | 一次ソース | 採用判定 |
|---|---|---|---|
| **Khan Academy Kids** | キャラクター rooms + sparkle 受取アニメ + truck particle (祝福 1-2 秒) + 受取音 | Khan Academy zendesk ( https://help.khanacademy.org ) | **採用 (首位、感情演出)** — 受取瞬間の祝福 1-2 秒パターン |
| **Duolingo Kids** | キャラクター jump + confetti + 効果音 (XP 獲得時) | Duolingo blog / iOS App Store description | **採用** — confetti + 効果音の組合せ |
| **ABCmouse** (Ticket Town) | チケット → 物理ごほうび交換、HUD top-right tickets + 専用 shop 空間 | ABCmouse Help ( https://help.ageoflearning.com ) | **部分採用** — チケット (= ポイント) HUD pattern (本実装は header に既存) |

**首位採用組合せ**: Khan Academy Kids (受取演出 1-2 秒) + Roblox Avatar Shop (CSS Grid auto-fill) + Nintendo eShop Kids (Dialog アイコン強調)

---

## 3. 軸 B: Dialog 確認 UX デザインパターン

### 3.1 候補 B1: プレーン白カード + テキスト (現状、棄却)

| 項目 | 内容 |
|---|---|
| 概要 | `<Dialog>` 内に `<p>このごほうびを受け取りますか？</p>` + 「はい/やめる」ボタン |
| メリット | 実装最小、a11y 既存 (Ark UI Dialog primitive) |
| デメリット | 感情演出ゼロ、コア体験 (L3 経済層) の達成感不在、業界水準と乖離 |
| 採用判定 | **棄却 (現状の構造的欠陥そのもの)** |

### 3.2 候補 B2: アイコン大表示 + 階層化テキスト + ボタン強調 (採用)

| 項目 | 内容 |
|---|---|
| 概要 | アイコン 64-96px + title heading + ポイントブロック (アイコン + 数値 + 「ポイント」) + 「はい」(size=lg, pulse keyframes) / 「やめる」(variant=ghost, size=sm) |
| 1 次ソース | Material Design 3 Dialog spec ( https://m3.material.io/components/dialogs/specs ) + Nintendo eShop confirm dialog 構造 |
| メリット | 視覚階層明確 / アイコンが「何のごほうび」を即座に伝達 / 「はい」強調が交換成立の達成感を演出 |
| デメリット | コンポーネント分離が必要 (ConfirmExchangeDialog.svelte) |
| 採用判定 | **採用 (#2155 で実装、PR #2229)** |

### 3.3 候補 B3: フルスクリーン modal + 動画演出 (棄却)

| 項目 | 内容 |
|---|---|
| 概要 | ガチャ演出のように画面全体を覆い、アニメ動画 3-5 秒 |
| デメリット | ADR-0012 anti-engagement 抵触、子供の集中を奪い長時間滞在に誘導 |
| 採用判定 | **棄却 (PO 確定: コレクション要素なし、滞在延伸禁止)** |

---

## 4. 軸 C: ショップ画面レスポンシブ Grid

### 4.1 候補 C1: CSS Flexbox row + wrap (棄却)

| 項目 | 内容 |
|---|---|
| 概要 | `display: flex; flex-wrap: wrap; gap: 16px` で card を並べる |
| デメリット | card 幅を個別指定する必要、年齢別タップサイズに自動追従しづらい |
| 採用判定 | **棄却** |

### 4.2 候補 C2: CSS Grid `auto-fill / minmax(280px, 1fr)` (採用)

| 項目 | 内容 |
|---|---|
| 概要 | `display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--reward-grid-min, 280px), 1fr)); gap: 16px;` |
| 1 次ソース | MDN CSS Grid Layout ( https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout ) + Roblox Creator Docs UI Grid |
| 採用実績 | CSS-Tricks 公式記事 "Auto-Sizing Columns in CSS Grid: `auto-fill` vs `auto-fit`" (2019、現在も標準) |
| メリット | 1 行で全 breakpoint カバー / 年齢別 `--reward-grid-min` CSS 変数で min 幅切替 (baby/preschool 320 / elementary 280 / junior/senior 240) |
| デメリット | IE11 非対応 (Pre-PMF スコープ外、許容) |
| 採用判定 | **採用 (#2156 で実装、PR #2229)** |

### 4.3 候補 C3: TanStack Virtual / virtualized list (棄却)

| 項目 | 内容 |
|---|---|
| 概要 | 仮想スクロール |
| デメリット | reward 数 ≤ 50 想定 (子供 1 人あたり)、virtualization は YAGNI |
| 採用判定 | **棄却 (ADR-0010 Pre-PMF 整合)** |

---

## 5. 軸 D: 感情演出 3 層 (視覚 / 触覚 / 聴覚)

### 5.1 視覚演出: canvas-confetti vs 代替

| OSS | 採用判定 | 理由 |
|---|---|---|
| **canvas-confetti** (24k stars / ~5KB gzipped / MIT) | **採用** | Pre-PMF 適合: 最小 bundle + 公式 `disableForReducedMotion` prefers-reduced-motion 対応 |
| tsparticles (~50KB) | 棄却 | 機能過多 / bundle 大 |
| react-confetti | 棄却 | React 専用 (Svelte 不適) |
| 自前 canvas 実装 | 棄却 | 車輪の再発明 (ADR-0014 OSS 先調査) |

**一次ソース**: canvas-confetti GitHub README ( https://github.com/catdad/canvas-confetti ) + npm trends 比較

### 5.2 触覚演出: navigator.vibrate vs Capacitor Haptics

| 手段 | 採用判定 | 理由 |
|---|---|---|
| **navigator.vibrate(200)** (Web 標準) | **採用** | Web 標準 + iOS Safari 制約は許容 (Android 主要、ガード `typeof navigator.vibrate === 'function'`) |
| Capacitor Haptics | 棄却 | PWA 範囲外、Pre-PMF YAGNI |

**一次ソース**: MDN Vibration API ( https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API )

### 5.3 聴覚演出: 既存 soundService vs 新規 OSS

| 手段 | 採用判定 | 理由 |
|---|---|---|
| **既存 soundService 再利用** (`static/sounds/purchase.mp3` + `special-reward.mp3`) | **採用** | 新規 asset 追加ゼロ、年齢別音量 SOUND_TIER_CONFIG 既存 (`src/lib/ui/sound/sounds.ts` SSOT) |
| Howler.js (~30KB 追加) | 棄却 | 既存 sound system で十分 |
| Tone.js (合成系) | 棄却 | 合成系は過剰 |
| 効果音ラボ素材新規調達 | 棄却 | 既存 purchase / special-reward で代替可、新規調達は別 Issue |

**一次ソース**: 効果音ラボ ライセンス ( https://soundeffect-lab.info/agreement/ ) 商用利用可確認 (将来追加時の参照)

---

## 6. 軸 E: EPIC 分割粒度

### 6.1 候補 E-α (採用): EPIC + 6 子 Issue

| 項目 | 内容 |
|---|---|
| 概要 | RS-1 Dialog / RS-2 Grid / RS-3 3 系統タブ / RS-4 感情演出 / RS-5 機能完成度 checklist / RS-6 カテゴリ・フィルタ の 6 子 Issue を EPIC 統括 |
| メリット | レビュー粒度小、リスク分散、回帰範囲明確 |
| デメリット | PR 数 2-3 (実装は #2229 + #2238 に統合) |
| 採用判定 | **採用 (PO 確定)** |

### 6.2 候補 E-β (棄却): 1 PR 統合

| 項目 | 内容 |
|---|---|
| 概要 | 6 軸全てを 1 PR で実装 |
| デメリット | PR 規模過大 (推定 +1500 / -500 行)、dogfood リスク高、レビュー困難 |
| 採用判定 | **棄却** |

### 6.3 候補 E-γ (棄却): 撤去 / Coming Soon 化

| 項目 | 内容 |
|---|---|
| 概要 | ショップ機能を一時撤去し再設計 |
| デメリット | L3 経済層はコア体験、撤去は Retention 阻害 |
| 採用判定 | **棄却 (PO 不採用)** |

---

## 7. 軸 F: カテゴリ・フィルタ追加方針

### 7.1 3 系統タブ (RS-3 / #2157)

26-ゲーミフィケーション設計書 §12 + #1336 で確立した「3 系統陳列」(実物 / お小遣い / 特権) を Ark UI Tabs primitive で UI 実装。`deriveShopCategory` ヒューリスティック (title / icon ベース) で reward を自動振分 (preset SSOT との 80% 以上一致を unit test で担保)。

| タブ | 子供向けラベル | 内容 |
|---|---|---|
| すべて | すべて | 全 reward |
| もの | もの | physical (物理ごほうび: お菓子・玩具) |
| おこづかい | おこづかい | money (お小遣い・お金) |
| とくべつ | とくべつ | privilege (特権: ゲーム時間・夜更かし等) |

**BusyKid / Greenlight 差別化**: 「特権 (privilege)」系統が独立タブとして提示されることで、日本家庭の「がんばり報酬」文化整合の訴求性が増す (海外プロダクトは money のみ扱う傾向)。

### 7.2 ポイント範囲 + 交換可能フィルタ (RS-6 / #2160)

Roblox Avatar Shop の filter 構造を参考に、子供向け情報量過多回避のため 2 軸のみ:

- ポイント範囲 (低 ≤ 100 / 中 101-500 / 高 ≥ 501) — checkbox group
- 「いまこうかんできる」 (residue >= cost、`data.balance >= r.points`) — single checkbox

フィルタ適用中は badge + リセット CTA を表示し、子供の self-recovery を支援。

---

## 8. ADR-0014 整合性確認

OSS 先調査原則 (#1350、ADR-0014) との整合:

- ✅ 業界 8 件 prior art 比較 (軸 A)
- ✅ Dialog UX 3 候補比較 (軸 B)
- ✅ Grid 3 候補比較 (軸 C)
- ✅ 感情演出 3 層 × 各 3-4 OSS 比較 (軸 D)
- ✅ 一次ソース 5 種補完 (Game8 / Nintendo Support / Roblox Creator Docs / Khan zendesk / 効果音ラボ規約)

新規 ADR 起票は不要 (ADR 10 件超過状態、PR body 内 + 本 research doc で OSS 比較を残す方針)。

---

## 9. 実装結果サマリ (PR #2229 / #2238)

### PR #2229: Dialog UX + Grid + 感情演出 3 層 (closes #2155 / #2156 / #2158)

- `src/routes/(child)/[uiMode=uiMode]/shop/ConfirmExchangeDialog.svelte` 新規 (148 行) — アイコン 96px wrap + 階層化テキスト + 「はい」pulse 強調
- `src/routes/(child)/[uiMode=uiMode]/shop/+page.svelte` — `.reward-list` を CSS Grid auto-fill / minmax(--reward-grid-min, 1fr) 化、年齢別 gridMin 切替 (320/280/240)
- `src/lib/features/reward-celebration/play-reward-celebration.ts` 新規 (85 行) — canvas-confetti + navigator.vibrate + soundService の 3 層モジュール、各層 ON/OFF + `prefers-reduced-motion` 対応
- `tests/unit/features/reward-celebration.test.ts` (7 cases) + `tests/e2e/child-shop-exchange.spec.ts` (2 cases 追加)
- `package.json` — canvas-confetti 1.9.4 + @types/canvas-confetti 1.9.0 追加

### PR #2238: 3 系統タブ + ポイント範囲フィルタ + 交換可能フィルタ (closes #2157 / #2160)

- `src/lib/domain/shop-category.ts` 新規 — `deriveShopCategory` ヒューリスティック (≤ 80 行)
- `src/routes/(child)/[uiMode=uiMode]/shop/+page.svelte` — Ark UI Tabs primitive で 4 タブ表示、`CHILD_SHOP_LABELS` に 14 ラベル追加 (tabAll/tabPhysical/tabAllowance/tabPrivilege/tabEmpty + filterPointsRange*/filterAvailable/filterBadge)
- `tests/unit/domain/shop-category.test.ts` (12 cases) + `tests/e2e/child-shop-tabs-filter.spec.ts` (6 cases)
- `docs/design/06-UI設計書.md` §14.5-§14.7 新設 + `26-ゲーミフィケーション設計書.md` §12 から相互参照

### 設計書同期

- `docs/design/06-UI設計書.md` §15.3.1 / §15.3.4 / §15.3.5 + 1.24 履歴 (PR #2229)
- `docs/design/06-UI設計書.md` §14.5-§14.7 + `26-ゲーミフィケーション設計書.md` §12 (PR #2238)

### Pre-PMF 整合 (ADR-0010)

- canvas-confetti / shop-category ヒューリスティックともに OSS 先調査済 (本 research doc 軸 D / 軸 F)
- DB schema 拡張は意図的に見送り (`shop_category` 列追加は将来の dogfood 結果次第)
- 新規 ADR 起票なし (ADR 10 件超過、本 research doc + PR body 内 OSS 比較で代替)

---

## 10. 残課題 / 後続 Issue

- 効果音ラボ素材新規調達 (将来 dogfood で「purchase.mp3 が地味」フィードバック発生時)
- DB schema `shop_category` 列追加 (ヒューリスティック → 明示指定への移行)
- RS-5 (#2159) 機能完成度 7 層 checklist の ADR-0010 §7 拡張 (本 research doc とは独立に進行)

---

## 11. 参照

- EPIC #2154 本文 (AC1 で本 research doc commit を指定)
- 補足 research: `docs/reference/08b-research-reward-shop-prior-art-primary-source.md` (一次ソース 8 件確認の詳細)
- ADR-0014: labels / i18n 機構選定 (OSS 先調査) — OSS 先調査原則の確立
- ADR-0012: Anti-engagement 原則 — ガチャ演出 / pity 棄却の根拠
- ADR-0013: LP truth — 実装の事実を SSOT、LP に未実装演出を訴求しない
- ADR-0010: Pre-PMF scope 判断 — 新規 DB schema 拡張見送りの根拠
- 26-ゲーミフィケーション設計書.md §12: 3 系統陳列原則
- `feedback_oss_first_principle.md` / `feedback_ssot_verification_before_proposal.md`
