# Dialog Management Refactor — Phase Dialog Research (#2105 起点)

| 項目 | 内容 |
|---|---|
| 起票 | PO 報告 (2026-05-14) で TutorialOverlay の二重ダイアログ現象が再発 (#2105) |
| 補佐 deep research | 2026-05-14 完了 |
| 結論 | Tier 2 (TutorialOverlay) は独自維持 + 条件追加で本 Issue 内修正。構造的整理は Dialog-2 / Dialog-3 で別 Issue 化 |
| Related ADR | ADR-0019 archive (Dialog FSM Scrap and Rebuild) — 復活非推奨。本 research が ADR-0019 archive ステータスを再確認 |
| Pre-PMF 適合 | ADR-0010 (Bucket A、サインアップ離脱直結) + ADR-0014 (OSS 先調査原則) 双方を満たす |

---

## 1. リサーチ目的

PO 報告「ガイドモード (TutorialOverlay) で終了確認ダイアログ表示時に元のチュートリアル
本体が visible のまま被る」(#2105) の修正方針を、単発の条件追加で済ませて良いか、
それとも Dialog 管理機構全体の再構築 (archive ADR-0019 復活) が必要かを判断する。

軸:

- **A**: アプリ全体の Dialog コンポーネント横断分析 (どの component が独自実装 / どれが primitive 経由か)
- **B**: 二重ダイアログ 横展開リスク調査 (TutorialOverlay 以外に同一バグ予備軍がいるか)
- **C**: 構造的整理方針の候補比較 (OSS / 確立パターン / 自前 FSM / 単発修正の 5 候補)
- **D**: 起票単位の判断 (1 Issue で全部直すか、分割するか)

---

## 2. 軸 A: Dialog コンポーネント横断分析 (12 件 / 3 Tier)

`grep -r "Dialog" src/lib/ui/` および `<dialog>` / `role="dialog"` / open prop バインド箇所
を全件確認した結果、12 component を 3 Tier に分類できた。

### Tier 1: Ark UI Dialog primitive 経由 (20+ 件、`src/lib/ui/primitives/Dialog.svelte`)

設定ダイアログ群 / プラン変更モーダル / 子供削除確認 / 通知許諾 / FAQ モーダル等。
`open` prop と `onOpenChange` 双方向バインドで Ark UI が state 管理を担う。
**本 research の対象外** — 既存の primitive で排他制御は完結している。

代表箇所:

- (旧 `src/lib/ui/components/MonthlyRewardDialog.svelte` (`--z-reward`) は #2295 で撤去済 2026-05-19)
- `src/lib/ui/components/SwitchChildDialog.svelte`
- `src/lib/ui/components/TutorialQuickCompleteDialog.svelte` — Resume / QuickComplete / ExitConfirm の 3 つの Dialog を内包する**コンテナ**。**Dialog primitive 自体は Tier 1 だが、TutorialOverlay と組み合わさった上位 state machine は Tier 2**

### Tier 2: 独自 overlay (4 件、本 research 主対象)

`role="dialog"` を手書き、または overlay div を独自構成。primitive 移行を検討したが
spotlight / 演出 / 子供画面の z-index 整合性から独自維持判定。

| component | 用途 | z-index | 状態管理 |
|---|---|---|---|
| `TutorialOverlay.svelte` | チュートリアル本体 (spotlight + bubble) | `--z-tutorial=100` | `tutorial-step-controller.svelte.ts` (runes `$state`) |
| `PageGuideOverlay.svelte` | ページ別ガイド | `--z-tutorial=100` | 独自 store |
| `SiblingCheerOverlay.svelte` | 兄弟応援メッセージ | `--z-tutorial=100` | 独自 store |
| `SiblingCelebration.svelte` | 達成お祝い演出 | `--z-celebration=200` | 独自 store |

**#2105 該当箇所**: `TutorialOverlay.svelte` L43 の `{#if}` ガードに `showExitConfirm` が含まれて
いなかったため、`showExitConfirm=true` 遷移後も TutorialBubble が DOM に残り、
`TutorialQuickCompleteDialog.svelte` 内の ExitConfirm Dialog (Tier 1 primitive) と背景で
二重ダイアログ状態が成立した。

### Tier 3: debug / dev only (1 件)

`DebugPlanIndicator.svelte` (`--z-debug=9999`) — 本番 build では非表示。対象外。

---

## 3. 軸 B: 横展開リスク調査 (二重ダイアログ予備軍ゼロ確認)

`grep -rE "showExitConfirm|showQuickComplete|showResume" src/` で当該 state 名を全件確認、
さらに「overlay 本体の `{#if}` ガード句から exitConfirm / closing dialog 系の state が抜けている」
パターンを Tier 2 の 4 component 全てで検証。

結果:

| component | 終了確認 dialog | 本体 {#if} ガード | 重畳バグ予備軍 |
|---|---|---|---|
| `TutorialOverlay.svelte` | あり (TutorialQuickCompleteDialog 経由) | **`showExitConfirm` 抜け = #2105 該当** | YES (本 Issue で修正) |
| `PageGuideOverlay.svelte` | なし (×ボタンで即閉じ、確認 dialog 経由しない) | n/a | NO |
| `SiblingCheerOverlay.svelte` | なし (timer / tap で即閉じ) | n/a | NO |
| `SiblingCelebration.svelte` | なし (一定時間表示後 auto close) | n/a | NO |

**結論**: TutorialOverlay 単独。Tier 1 primitive 経由 dialog (旧 `MonthlyRewardDialog` 等、後者は #2295 で撤去済) は
Ark UI 側で `aria-hidden` / `inert` を自動付与するため同種バグは構造的に発生しない。
横展開影響なし、Phase Dialog 全体 refactor は不要。

---

## 4. 軸 C: 構造整理方針の 5 候補比較 (OSS / 確立パターン先調査、#1350 + ADR-0014)

### 案 1: Ark UI Dialog primitive の活用拡大 (採用、補完的)

- 概要: 既存 20+ 件で稼働、`zagjs` / Ark UI Svelte の自動排他 + focus trap
- メリット: bundle 増加ゼロ (既存依存)、`open` prop + `onOpenChange` の双方向バインド
- デメリット: TutorialOverlay の spotlight mask 機構 (SVG cutout) とは噛み合わない。
  外殻 (bubble + spotlight) は独自維持しつつ ExitConfirm 等の確認 dialog のみ primitive に
  逃がす現状運用が最適
- Pre-PMF コスト: 0 (既存活用)
- **採否**: 採用 (現状運用継続)。Dialog-2 / Dialog-3 で活用拡大を別 Issue 化

### 案 2: xstate / @xstate/svelte で Dialog state machine 化 (不採用)

- 概要: 公式 FSM ライブラリ、`@xstate/svelte` v3 で Svelte 5 Runes 互換
- 比較対象: stars 28k+ / weekly DL 2.5M / npm `xstate` + `@xstate/svelte`
- メリット: 状態遷移を宣言的に図示できる、parallel state / guards で重畳禁止を型レベル表現可
- デメリット: **+17KB gzipped (xstate コア 12KB + @xstate/svelte 5KB)**、学習コスト、
  TutorialOverlay 単独修正のためだけに導入するには重い。本研究の Tier 1/2 区分の中で
  独自 FSM が必要な component は Tier 2 の 4 件のみだが、いずれも線形 state で重畳なし
- Pre-PMF コスト: bundle +17KB は ADR-0010 Bucket A (転換率影響) で却下。サインアップ 20/月
  目標未達フェーズで LCP +0.1s レベルの負荷を払えない
- **採否**: 不採用

### 案 3: Svelte 5 Runes ベースの自前 Dialog Store (不採用)

- 概要: `$state` で `currentDialog: 'tutorial' | 'exitConfirm' | 'quickComplete' | null` の
  排他 enum を持つ store を自前実装
- メリット: bundle 増 0、Svelte 5 idiomatic
- デメリット: 独自実装過多防止違反 (memory `feedback_oss_first_principle`、ADR-0014 OSS 先調査
  原則)。既存 Ark UI primitive が同等機能を既に提供 (open prop バインドで排他)
- Pre-PMF コスト: 開発 1-2 日 + 既存 dialog 全箇所の移行 (20+ 件) で 5+ 日
- **採否**: 不採用 (案 1 で代替可)

### 案 4: vaul-svelte / svelte-headlessui の Modal Stack ライブラリ (不採用)

- 概要: vaul-svelte (stars 1.2k, drawer 寄り) / bits-ui (stars 1.5k, Radix 派生)
- メリット: Modal stack / nested dialog の closure 順管理が標準機能
- デメリット: +10-15KB bundle、Ark UI Svelte と機能重複 (既存依存と二重)、移行コスト
- Pre-PMF コスト: 二重依存で bundle 累積、ADR-0010 Bucket A 却下対象
- **採否**: 不採用

### 案 5: バグ単独修正 (L43 条件追加) (採用、本 Issue スコープ)

- 概要: `TutorialOverlay.svelte` L43 の `{#if}` ガードに `&& !showExitConfirm` を追加。
  追加で `handleOverlayClick` 側に `showExitConfirm / showQuickComplete / showResume` の
  いずれかが true の間は state 遷移しないガードを加える (FSM 排他原則を手書きで担保)
- 差分: 2 ファイル、+5 行 / -1 行
- メリット: bundle 増 0、PR レビュー単純、E2E 1 件で完全検証可
- デメリット: 「Dialog 排他原則」が文書化されないまま implicit 状態に残る (→ 本 research
  ドキュメント化 + ADR-0019 archive の存在を再確認することで補完)
- **採否**: 採用 (本 Issue)

---

## 5. 軸 D: 起票単位 (α 分割推奨)

| Issue | スコープ | 緊急度 |
|---|---|---|
| **#2105 (本 Issue)** | TutorialOverlay 単独修正 + 本 research commit | high (PO 報告 2 回目) |
| Dialog-2 (別 Issue 予定) | 独自実装 4 件の z-index 生数値 → `var(--z-*)` 化 (DESIGN §10 トークン整合) | medium |
| Dialog-3 (別 Issue 予定) | SiblingCheerOverlay / SiblingCelebration の Ark UI Dialog primitive 移行検討 | low (動作問題なし) |

**根拠**: 軸 B で「予備軍ゼロ」確認済のため、本 Issue 修正で再発リスクは消える。
Dialog-2 / Dialog-3 は構造整理だけで動作には影響しないため、Pre-PMF 段階 (#2105 close 後)
の余裕があるときに別 Issue 化する。

---

## 6. 採用方針 (本 Issue #2105)

1. **L43 ガード追加** (`TutorialOverlay.svelte`)
   - `{#if active && step && targetRect && !showQuickComplete}` → `&& !showExitConfirm` 追加
   - `getShowExitConfirm()` 既存 import 活用 (新規 import 不要)
2. **handleOverlayClick ガード追加** (`tutorial-step-controller.svelte.ts`)
   - 他 dialog 表示中は state 遷移しない (FSM 排他原則を手書きで担保)
3. **E2E spec 追加** (`tests/e2e/tutorial-double-dialog-bug-2105.spec.ts`)
   - dark backdrop click → 終了確認 dialog のみ visible / TutorialBubble は hidden
   - 「続ける」→ TutorialBubble 再表示 / 「終了する」→ チュートリアル終了
4. **本 research を `docs/reference/03-research-dialog-management-refactor.md` に commit** (本ファイル、AC1)
5. **既存 tutorial-* E2E 全 PASS 維持** (AC8 回帰なし)

---

## 7. 残懸念 (Dialog-2 / Dialog-3 で扱う、本 Issue スコープ外)

- 独自 overlay 4 件の z-index 生数値 (#1722 + DESIGN §10) — `var(--z-tutorial)` / `var(--z-celebration)` トークン化済だが、生数値 fallback が一部残存
- `SiblingCheerOverlay` / `SiblingCelebration` の primitive 化 — Ark UI Dialog 移行可否は
  演出系の focus trap / aria-modal 要件を別調査
- TutorialOverlay 全体の primitive 化 — spotlight mask 機構との整合で本 research では却下

これらは Dialog-2 / Dialog-3 で別 Issue 化 (#2105 が blocks する)。
