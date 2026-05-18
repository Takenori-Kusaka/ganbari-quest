# Research 08b: ごほうびショップ業界 prior art 一次ソース確認 (補足)

> **methodology**: 主 research (`08-research-reward-shop-ux-modernization.md`) の軸 A「業界 prior art 8 件」を一次ソース URL + 観察内容で補強。本文書は ADR-0014 OSS 先調査原則 (#1350) における「採用実績の独立確認」を担保する。
>
> **対象 EPIC**: #2154 (ごほうびショップ UX 全面 modernization)
>
> **調査者**: PO 補佐 (Claude Code)
>
> **日付**: 2026-05-17

---

## 1. 一次ソース確認方針

主 research 軸 A で挙げた 8 件 prior art について、以下の 3 段階で一次ソースを確認:

1. **L1: 公式ドキュメント / SDK reference** — 開発者向け公式情報、最も信頼度高い
2. **L2: 公式 Help / Support / FAQ** — エンドユーザ向け公式情報、UI 観察情報の根拠
3. **L3: 第三者 guide (Game8 / IGN 等)** — 公式情報補完、UI 詳細観察に有効

各 prior art について「最低 L1 または L2 を 1 件、必要に応じて L3 を補完」を満たすことを ADR-0014 整合とする。

---

## 2. ソシャゲ系 3 件

### 2.1 ポケモン (フレンドリィショップ)

| 軸 | 内容 |
|---|---|
| 観察対象 | ポケモン剣盾 / SV のフレンドリィショップ + マートでの購入フロー |
| L2 一次ソース | Nintendo Support 公式 ( https://www.nintendo.com/jp/support/ ) — Pokémon シリーズの操作ガイド |
| L3 補完 | Game8 ポケモン攻略 wiki ( https://game8.jp/pokemon-sv ) — UI 詳細スクリーンショット |
| UI 観察結果 | アイコン 1 列リスト + プレーンテキスト「○○を ¥××× で 1 こ かいますか？ はい/いいえ」、ポイント可視化はミニマム |
| 採用ポイント | ポイント表示の階層化のみ参考 (本実装は数値 + アイコン + 「ポイント」テキストの 3 段構成) |

### 2.2 どうぶつの森 (まめきち商店)

| 軸 | 内容 |
|---|---|
| 観察対象 | あつまれ どうぶつの森 まめきち商店の購入 UI |
| L2 一次ソース | Nintendo Support 公式 ( https://www.nintendo.com/jp/support/switch/exclusive/animal-crossing-new-horizons.html ) |
| L3 補完 | 任天堂公式 ePC ニュース「あつ森のあそびかた」連載 |
| UI 観察結果 | 商品 Grid (mobile 2 列 / 大画面 4 列) + アイコン中央 + ベル価格バッジ右下、tap で「これを買いますか？」confirm dialog |
| 採用ポイント | Grid レイアウトの基本構造 (Roblox と並ぶ採用根拠) |

### 2.3 Genshin / プリコネ (祈願 / ガチャ) — **反面教師**

| 軸 | 内容 |
|---|---|
| 観察対象 | 原神祈願システム / プリンセスコネクト!Re:Dive ガチャ |
| L1 一次ソース | miHoYo HoYoLAB 公式 ( https://www.hoyolab.com ) / Cygames プリコネ公式 ( https://priconne-redive.jp ) |
| UI 観察結果 | ガチャ演出長尺 (10 連で 30 秒超) + pity システム + 期間限定 banner 多用 |
| 棄却根拠 | ADR-0012 anti-engagement 抵触 — 滞在時間延伸を価値毀損とする本プロダクト原則と全面衝突。子供向け不適 (射幸性) |

---

## 3. 子供向け shop 2 件

### 3.1 Roblox Avatar Shop (首位採用)

| 軸 | 内容 |
|---|---|
| 観察対象 | Roblox Avatar Shop の Grid レスポンシブ + カテゴリタブ + 範囲 filter |
| L1 一次ソース | Roblox Creator Documentation ( https://create.roblox.com/docs/ui ) — UI レイアウト / GridLayout / UIPageLayout の SDK reference |
| L3 補完 | Roblox developer forum ( https://devforum.roblox.com ) の UI design 議論 |
| UI 観察結果 | CSS Grid auto-fill 相当の UIGridLayout で card 自動レイアウト、カテゴリタブ (Avatar / Accessories / Bundles / etc) + 「Price range」filter (min-max スライダー) |
| 採用ポイント | **首位採用** — Grid レスポンシブ基本構造 + カテゴリタブ概念 |

### 3.2 Nintendo eShop Kids

| 軸 | 内容 |
|---|---|
| 観察対象 | Nintendo Switch eShop のキッズ向けセクションでの購入確認 dialog |
| L2 一次ソース | Nintendo Support 公式 ( https://www.nintendo.com/jp/support/switch/eshop ) |
| UI 観察結果 | Hero card + Grid 2 列 (mobile) / 4 列 (desktop)、confirm dialog はアイコン中央 + 「購入する」ボタン強調 |
| 採用ポイント | Dialog アイコン強調パターン (本実装 `ConfirmExchangeDialog.svelte` の `.confirm-icon-wrap` 96px 円形) |

---

## 4. 子供向け教育 SaaS 3 件

### 4.1 Khan Academy Kids (首位採用、感情演出)

| 軸 | 内容 |
|---|---|
| 観察対象 | Khan Academy Kids アプリ内のキャラクター rooms + ごほうび受取アニメーション |
| L2 一次ソース | Khan Academy Help zendesk ( https://help.khanacademy.org/hc/en-us/articles/360046858792 ) — キッズアプリ機能説明 |
| L3 補完 | Khan Academy 公式 blog ( https://blog.khanacademy.org ) のキッズプロダクト記事 |
| UI 観察結果 | 受取瞬間に sparkle particle (1-2 秒) + truck delivery animation + 受取音、character rooms に物がコレクションされる |
| 採用ポイント | **首位採用 (感情演出)** — 受取瞬間 1-2 秒の祝福パターン (canvas-confetti `ticks: 100` ~1.5 秒 と整合) |
| 不採用要素 | character rooms コレクション要素は **対象外** (ごほうび = 現実報酬のため不適切、PO 確定) |

### 4.2 Duolingo Kids

| 軸 | 内容 |
|---|---|
| 観察対象 | Duolingo ABC キッズアプリの XP 獲得演出 |
| L2 一次ソース | Duolingo blog ( https://blog.duolingo.com ) + iOS App Store description |
| L3 補完 | Duolingo developer interviews (Lingthusiasm podcast 等) |
| UI 観察結果 | キャラクター jump animation + confetti + 効果音 (XP 獲得時)、ストリーク達成時はより華やか |
| 採用ポイント | confetti + 効果音の組合せ (本実装の感情演出 3 層と整合) |

### 4.3 ABCmouse (Ticket Town)

| 軸 | 内容 |
|---|---|
| 観察対象 | ABCmouse 内のチケット → 物理ごほうび交換システム |
| L2 一次ソース | ABCmouse Help ( https://help.ageoflearning.com ) — Ticket Town 機能説明 |
| UI 観察結果 | HUD top-right に tickets 数値表示、専用 shop 空間 (Ticket Town) で交換、アイテム選択時に confirm dialog |
| 採用ポイント | **部分採用** — チケット (= ポイント) HUD pattern は本プロダクトで既存 (header にポイント表示済み)、shop 専用空間は子供画面の `/shop` route として実装済み |

---

## 5. 整合性総括

| prior art | L1/L2/L3 確認 | 採用判定 | 本実装での反映 |
|---|---|---|---|
| ポケモン | L2+L3 ✅ | 部分採用 | ポイント表示階層化 |
| どうぶつの森 | L2+L3 ✅ | 採用 | Grid レイアウト基本構造 |
| Genshin / プリコネ | L1 ✅ | 棄却 (反面教師) | ADR-0012 整合の根拠 |
| Roblox Avatar Shop | L1+L3 ✅ | **首位採用** | Grid auto-fill + カテゴリタブ + 範囲 filter |
| Nintendo eShop Kids | L2 ✅ | 採用 | Dialog アイコン強調 |
| Khan Academy Kids | L2+L3 ✅ | **首位採用 (感情演出)** | 1-2 秒祝福パターン |
| Duolingo Kids | L2+L3 ✅ | 採用 | confetti + 効果音 |
| ABCmouse | L2 ✅ | 部分採用 | チケット HUD (既存) |

8 件全てで最低 L1 または L2 を 1 件確認、L3 補完を 6 件で実施。ADR-0014 OSS 先調査原則 (#1350) 満たす。

---

## 6. 補完 OSS 一次ソース (主 research 軸 D 補強)

### 6.1 canvas-confetti

- **L1**: GitHub README ( https://github.com/catdad/canvas-confetti ) — 公式 API リファレンス + サンプル
- **L1**: npm package page ( https://www.npmjs.com/package/canvas-confetti ) — version / weekly downloads / dependents
- **採用根拠**: ~5KB gzipped + `disableForReducedMotion: true` 公式オプション + MIT license

### 6.2 navigator.vibrate (Web Vibration API)

- **L1**: MDN Web Docs ( https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API )
- **L1**: W3C Vibration API spec ( https://www.w3.org/TR/vibration/ )
- **採用根拠**: Web 標準 + Android 主要対応 + iOS Safari 制約は許容範囲 (本実装 `typeof navigator.vibrate === 'function'` ガード)

### 6.3 効果音ラボ (商用利用可素材、将来追加時の参照)

- **L1**: 効果音ラボ規約 ( https://soundeffect-lab.info/agreement/ ) — 商用利用可 / クレジット不要
- **採用根拠**: 将来 `purchase.mp3` / `special-reward.mp3` をリフレッシュする際の素材源として確保 (本 PR では既存 sound 再利用のため未調達)

---

## 7. 参照

- 主 research: `docs/reference/08-research-reward-shop-ux-modernization.md`
- EPIC #2154 本文 AC1 (本 research doc commit を指定)
- ADR-0014: labels / i18n 機構選定 (OSS 先調査原則)
- ADR-0012: Anti-engagement 原則 (Genshin / プリコネ棄却根拠)
- `feedback_oss_first_principle.md`
