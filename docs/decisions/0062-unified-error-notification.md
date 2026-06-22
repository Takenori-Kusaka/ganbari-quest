# 0062. 統一エラー通知設計（種別×手段マッピング + 内部例外非露出 + role/aria SSOT）

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-06-22 |
| 起票者 | Claude（補佐、PO 判断適用） |
| 関連 Issue | EPIC #3217 / P0 #3218 / 実例 #3186・#3204 |
| 関連 ADR | ADR-0010（Pre-PMF）/ ADR-0061（shift-left）/ DESIGN.md §5（Button loading / Toast 2 層） |

## コンテキスト

バックエンドエラー時（400/403/409/500 等すべて）に**ユーザに何も通知されず無反応になる silent-failure** が複数画面で反復した（#3186 通知ボタン → #3204 checkout → EPIC #3217）。根因は **統一エラー表示 helper の不在**で、各画面が `error`/`memberError`/`actionMessage`/`form?.*Error` を独自命名で散在実装し、`fetch` の `!res.ok`/catch や form action の `failure` を表示に繋ぐ規約が無かった。

サイレント失敗は **WCAG 2.2 の 3.3.1 Error Identification（A）+ 4.1.3 Status Messages（AA）の二重違反**（JIS X 8341-3:2016 一致規格、国内法令・公共調達観点でも不適合）。本 ADR で統一設計を SSOT 化し、機械防止（ADR-0061 shift-left）と合わせて反復を断つ。

## 検討した選択肢（OSS / 確立パターン）

### 選択肢 A: 統一 helper + primitive 改修 + ADR（採用）
- 概要: `$lib/ui/error-notify.ts` に `notifyApiError` / `notifyActionError` / `notifyNetworkError` を集約し、既存 `Toast` / `Alert` primitive を WCAG 準拠の role/aria に整える。文言は `labels.ts`（`ERROR_NOTIFY_LABELS`）に SSOT 化。
- メリット: 既存資産（DESIGN.md §5 Toast 2 層 / Button loading / Alert primitive）の延長。ツール費ゼロ。
- 根拠規格: WCAG 2.2 / JIS X 8341-3:2016 / デジタル庁導入ガイドブック / Material M3（snackbar/dialog 使い分け）/ Apple HIG（alerts）/ NN/g（error message guidelines）。

### 選択肢 B: 既製 i18n+toast ライブラリ（svelte-french-toast 等）導入
- デメリット: bundle 増 + 既存 Toast/Alert と二重管理。Pre-PMF 過剰（ADR-0010）。不採用。

## 決定

### 1. 種別 × 通知手段マッピング（「重要度・永続性・操作要否」の 1 軸）

| 種別（HTTP） | 手段 | role / aria-live | 自動消滅 |
|---|---|---|---|
| 一時的・回復可能（再試行で直る / 楽観更新の差し戻し） | Snackbar(Toast) + 再試行 → 永続なら Banner | `status`(polite) | 再試行ボタン保持中は不可 |
| 入力起因・バリデーション (400) | Inline（field 直下 + 集約サマリ）。`FormField` の `aria-invalid`/`aria-describedby` を活用 | field=`aria-invalid` / サマリ=`alert` | 不可（修正まで残す） |
| 権限・状態起因 (403/409) | Banner（状態 + 次アクション）。破壊的再操作は Dialog | `alert`(assertive) | 不可 |
| サーバ内部 (500) | Dialog/Alert（操作ブロック = 重大）。軽微非ブロックは Banner | `alert`(assertive) | 不可 |

### 2. 内部例外メッセージの非露出（セキュリティ + UX）

- **500 系はサーバ body の message を信用せず汎用文言**（`ERROR_NOTIFY_LABELS.server`）にする。生例外（DynamoDB / Stripe / SQL / スタックトレース / 例外クラス名）は **logger / 監視のみ**へ（`logger.ts` / `discord-alert.ts`）。
- サーバ層は `error(status,'UI 向け文言')` / `json({error:'固定文言'},{status})` を返し、`err.message` をそのままレスポンスに載せない（Apple HIG「コード羅列タイトル禁止」/ NN/g「専門用語禁止」）。

### 3. Toast の role / 自動消滅ルール

- `type='success'|'info'` → `role="status"`（polite）+ 3 秒自動消滅（操作不要・軽微通知、WCAG 2.2.1 例外）。
- `type='error'` → `role="alert"`（assertive）+ **自動消滅させず手動閉じ（× ボタン）**（WCAG 2.2.1 — 修正を要するエラーをタイマーで消すと情報喪失）。

### 4. 共通原則

- **色のみ依存禁止**（アイコン + テキスト併用、WCAG 1.4.1 / DESIGN.md §7）。
- **子供画面**はひらがな・責めない文言・必ず次アクション提示（DESIGN.md §6 / ADR-0012 anti-engagement）。
- **await を伴う全操作で `loading` 表示 + 確定フィードバック必須**（押して無反応 = 3.3.1 + 4.1.3 二重違反、CX-DoR #9）。

## 結果

- 統一 helper `error-notify.ts`（`notifyApiError`/`notifyActionError`/`notifyNetworkError`/`resolveApiErrorMessage`）+ `ERROR_NOTIFY_LABELS`（labels.ts）+ `Toast` role/自動消滅改修を P0（#3218）で実装。silent-failure を順次 helper 経由に統一（P1）、`fetch` 未処理検出の fitness を P2（ADR-0061 適用例）で機械化。
- **トレードオフ**: 既存散在 state（`*Error` 個別命名）の全面置換は段階的（P1）。Banner/Dialog 振り分けの完全自動化はせず、重大度は呼出側が helper 戻り値 + Alert/Dialog 併用で判断する。
- **10 枠ルール（README）**: 本 ADR 追加の 1-in-1-out は 2026-06 最終週の月 1 棚卸で archive 候補（proposed 据置 ADR-0014/0015/0016 等）と併せて消化する。
