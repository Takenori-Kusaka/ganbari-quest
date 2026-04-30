# 0025. LP SSOT 注入機構の innerHTML 化 + XSS 設計（DOMPurify）

| 項目 | 内容 |
|------|------|
| ステータス | proposed |
| 日付 | 2026-04-29 |
| 起票者 | PO |
| 関連 Issue | #1683 / #1465 / #1346 |
| 関連 ADR | ADR-0009（labels SSOT 原則） / ADR-0014（i18n 機構選定） / ADR-0008（設計ポリシー先行確認） |

## コンテキスト

ADR-0009 で確立した「LP/Legal を含む全ユーザー露出文言の SSOT 化」を **100% 完遂**するために、現行の `site/shared-labels.js#applyLpKeys()` が抱える 3 つの構造的限界を解消する必要がある（Issue #1683 直前 Agent fail report でも identified）。

1. **textContent 注入は nested HTML を破壊する** — 現在の実装は `el.textContent = value` で値を流し込む。LP の `data-lp-key` 付き要素のうち **156+ 件**（`<strong>` / `<em>` / `<a>` / `<span class>` / `<br>` 等を内包する 178 行サンプル経由で確認）が nested HTML を持っており、SSOT 化したくても机上不可能。例:
   ```html
   <p data-lp-key="heroPriceBand.container"><span><strong>基本無料</strong></span>・月<strong>¥500〜</strong>…</p>
   ```
2. **法的文書（privacy/terms/sla/tokushoho 354 件）が SSOT 外** — `scripts/check-lp-ssot.mjs` で `EXCLUDED_LEGAL_FILES` として除外運用。PO 方針「SSOT 漏れのコンテンツは存在してはいけない」と直接矛盾。
3. **pamphlet.html は印刷専用の独自構造** — `window.print()` 起動前に SSOT 注入が完了していない場合、未注入のフォールバックテキストが印刷される懸念。

PO 判断 (#1683): **案 A** = architecture ADR 先行起票 → ADR 確定 → 1 PR で 693 件全件 SSOT 化。本 ADR はその architecture を確定する唯一の文書。

## 検討した選択肢（OSS 先調査 — #1350 / ADR-0014 整合）

### 選択肢 A: DOMPurify による innerHTML 注入 + 許可タグ制限（推奨）

- **概要**: [`DOMPurify`](https://github.com/cure53/DOMPurify) (v3.x、~22 KB gzip)。OWASP / Google / GitHub などが採用する業界標準 HTML sanitizer。weekly downloads 6M+、最終 commit 数日内、MIT。
- **適用**: `applyLpKeys()` で `el.innerHTML = DOMPurify.sanitize(value, { ALLOWED_TAGS, ALLOWED_ATTR })` に置換。`ALLOWED_TAGS = ['strong','em','a','br','span','sup','sub']`、`ALLOWED_ATTR = ['href','target','rel','class','aria-hidden']`、`ALLOW_DATA_ATTR = false`、リンクは `target=_blank` 時 `rel=noopener noreferrer` 強制（DOMPurify hook）。
- **メリット**: nested HTML を保持しつつ XSS を業界標準で防御、bundle 22 KB gzip は LP 規模で許容、SSR 不要のためビルドフロー追加なし。
- **デメリット**: 22 KB の bundle 増。pamphlet.html は印刷タイミングと注入完了の同期が必要（後述 §Migration）。
- **Pre-PMF コスト** (ADR-0010): 導入工数 低（1 ファイル + 1 dep）、学習コスト 低、bundle 影響 軽（LP は CDN/static、tree-shake 不要のメイン script は LP 訪問者のみ）、長期保守性 **高**。

### 選択肢 B: nested tag を独立した `<span data-lp-key>` に分解

- **概要**: `<p>...<strong>X</strong>...</p>` を全て葉まで `data-lp-key` で覆う。textContent 維持。
- **メリット**: 追加 OSS 不要、XSS リスクゼロ。
- **デメリット**: HTML が読めなくなる（1 行に 5+ key）。labels.ts キー数が現行 +200 程度に肥大、レビュー困難。Issue #1683 直前 Agent も失敗した方式。
- **却下理由**: 機構として OK でもコンテンツ保守性が破綻。SSOT は「変更容易性」が目的であり、本末転倒。

### 選択肢 C: LP 全体を SvelteKit `adapter-static` 化して `+page.svelte` に吸収

- **概要**: `site/**` を `src/routes/(marketing)/` に移し SSR/SSG。labels を直接 import。
- **メリット**: 型安全、runtime 注入不要、SEO 完全。
- **デメリット**: アーキテクチャ大改修（#566 で見送り、ADR-0010 バケット C 該当）、Pre-PMF 工数過大。
- **却下理由**: ADR-0010 で「Pre-PMF 過剰」判定済み。ADR-0014 でも回避方針確認済。

### 選択肢 D: 自前 sanitizer 実装

- **概要**: 許可タグの正規表現でゼロ依存。
- **却下理由**: XSS 関連は確立 OSS 必須（#1350 OSS 先調査ルール、10 行超）。長期保守でセキュリティリスク蓄積。

## 決定

**選択肢 A: DOMPurify を採用**。`site/shared-labels.js#applyLpKeys()` を innerHTML + DOMPurify sanitize に切り替え、**LP 339 件 + Legal 354 件 = 693 件すべて**を `data-lp-key` SSOT 配下に統合する。

### 適用範囲（PO 方針: 例外なし）

1. **LP**: `site/index.html` / `pricing.html` / `faq.html` / `selfhost.html` / `pamphlet.html` / `help/license-key.html`
2. **Legal**: `site/privacy.html` / `terms.html` / `sla.html` / `tokushoho.html`（**ADR-0009 §例外「法的文書」を本 ADR が supersede**）
3. **labels.ts namespace**: 既存 `LP_*_LABELS` に加え新規 `LP_PRIVACY_LABELS` / `LP_TERMS_LABELS` / `LP_SLA_LABELS` / `LP_TOKUSHOHO_LABELS` / `LP_PAMPHLET_LABELS` / `LP_FAQ_BODY_LABELS` を追加（Phase 4 多言語化時に PO/JSON へ抽出可能な flat 構造を維持）。

### DOMPurify 設定値（実装 Agent 直参照）

```js
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['strong','em','a','br','span','sup','sub','small','b','i'],
  ALLOWED_ATTR: ['href','target','rel','class','aria-hidden','aria-label'],
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ADD_ATTR: ['target'], // a[target] 許可
};
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});
```

### pamphlet.html の印刷タイミング

`<script src="shared-labels.js" defer>` で `DOMContentLoaded` までに注入完了を保証 + `window.print()` 直前に `applyAll()` 同期再実行（既に注入済みなら no-op）。テストは Playwright `emulateMedia({ media: 'print' })` で SS 検証。

## 結果

### 利点
- ADR-0009 が掲げる「100% SSOT」が **真に達成**（PO 強い方針の充足）
- nested HTML を保持できるため LP コンテンツの表現力を犠牲にしない
- XSS 防御を業界標準（OWASP 推奨）で実装、自前リスクなし
- 法的文書も SSOT 配下に入り、文言ドリフト（規約 vs プラポリ vs LP）を構造的に防止

### トレードオフ
- bundle に DOMPurify 22 KB gzip 追加（LP は 1 ロードのみ、許容範囲）
- ADR-0009 §例外「法的文書」項目を本 ADR が supersede（履歴は ADR-0009 内に追補）
- 実装 PR は LP 339 + Legal 354 = 693 件の手作業移行で大規模（後述 §Migration Plan）

### 移行計画（実装 Agent 引継ぎ）

| Phase | 作業 | 対象件数 | 想定 diff 規模 |
|-------|------|----------|---------------|
| M1 | `npm i dompurify` + `applyLpKeys()` を innerHTML+DOMPurify に書換 | shared-labels.js +50 行 | +50/-10 |
| M2 | `LP_*_BODY_LABELS` namespace 5 種追加 + 既存 LP_LABELS 補完 | labels.ts | +4,000 行 |
| M3 | site/*.html を順次 SSOT 化（**1 commit / file 推奨、1 PR 完遂**） | 6 LP + 4 Legal = 10 ファイル | HTML 約 5,000 行変更 |
| M4 | `scripts/lp-ssot-baseline.json` を `count: 0` に更新 + `EXCLUDED_LEGAL_FILES` 削除 | 2 ファイル | +5/-10 |
| M5 | 全画面 SS 撮影（`npm run capture`）で視覚回帰なし確認 | 10 ページ × mobile/desktop | docs/screenshots/ |
| M6 | 設計書同期: `docs/design/22a-アイコン・ラベル統一規約.md` / `06-UI設計書.md` / ADR-0009 §例外節 supersede 追補 | 3 ファイル | +30 行 |

**想定実装時間**: 8-16 時間（Agent 単独）。**partial PR 禁止 / follow-up Issue 起票禁止** (PO 方針)。

## 関連
- ADR-0009（labels.ts SSOT 原則）— 本 ADR 承認時に §例外「法的文書」を supersede 表記
- ADR-0014（i18n 機構選定）— Paraglide 移行前提として現 `shared-labels.js` 経路の延命策
- Issue #1683（SSOT 100% 完全化）/ #1465（LP SSOT Phase A baseline）/ #1346（labels 機構 Umbrella）
- DOMPurify: https://github.com/cure53/DOMPurify
