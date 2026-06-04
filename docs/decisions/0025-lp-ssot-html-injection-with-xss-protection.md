# 0025. LP SSOT 注入機構の innerHTML 化 + XSS 設計（DOMPurify）

| 項目 | 内容 |
|------|------|
| ステータス | **accepted (2026-04-30, #1683 完遂 + #1704)** |
| 日付 | 2026-04-29（accepted 昇格 2026-04-30） |
| 起票者 | PO |
| 関連 Issue | #1683 / #1465 / #1346 / #1704 (umbrella close) |
| 関連 ADR | ADR-0009（labels SSOT 原則、§例外「法的文書」を本 ADR が supersede） / ADR-0014（i18n 機構選定） / ADR-0029（LP CSP / CDN allowlist、表裏一体） |

## コンテキスト

ADR-0009 の「LP / Legal を含む全ユーザー露出文言の SSOT 化」を 100% 完遂するには、`site/shared-labels.js#applyLpKeys()`（旧実装）が抱える 3 つの構造的限界を解消する必要があった。

1. **textContent 注入が nested HTML を破壊する** — `el.textContent = value` 方式では `<strong>` / `<em>` / `<a>` / `<span class>` / `<br>` を内包する LP 要素（156+ 件）を SSOT 化できない。
   ```html
   <p data-lp-key="heroPriceBand.container"><span><strong>基本無料</strong></span>・月<strong>¥500〜</strong>…</p>
   ```
2. **法的文書（privacy/terms/sla/tokushoho 354 件）が SSOT 外** — `EXCLUDED_LEGAL_FILES` 除外運用が PO 方針「SSOT 漏れのコンテンツは存在してはいけない」と矛盾。
3. **pamphlet.html は印刷専用構造** — `window.print()` 起動前に SSOT 注入が完了していないと未注入フォールバックが印刷される懸念。

PO 判断 (#1683): architecture ADR 先行確定 → 1 系統で LP 339 + Legal 354 = 693 件全件 SSOT 化。本 ADR がその architecture を確定する。

## 検討した選択肢（OSS 先調査 — #1350 / ADR-0014 整合）

### 選択肢 A: DOMPurify による innerHTML 注入 + 許可タグ制限（採用）

- **概要**: [`DOMPurify`](https://github.com/cure53/DOMPurify) (v3.x、~22 KB gzip)。OWASP / Google / GitHub 採用の業界標準 HTML sanitizer。weekly downloads 6M+、MIT。
- **適用**: `applyLpKeys()` で `el.innerHTML = DOMPurify.sanitize(value, { ALLOWED_TAGS, ALLOWED_ATTR })` に置換。link の `target=_blank` には `rel=noopener noreferrer` を hook で強制。
- **メリット**: nested HTML を保持しつつ XSS を業界標準で防御。SSR 不要でビルドフロー追加なし。
- **Pre-PMF コスト** (ADR-0010): 導入工数 低（1 ファイル + 1 dep）、bundle 影響 軽（LP は CDN/static で訪問者のみロード）、長期保守性 高。

### 選択肢 B: nested tag を独立した `<span data-lp-key>` に分解

- **概要**: 葉まで `data-lp-key` で覆い textContent 維持。
- **却下理由**: HTML が読めなくなり（1 行に 5+ key）、labels.ts キー数が +200 肥大。SSOT の目的「変更容易性」と本末転倒。Issue #1683 直前 Agent も失敗した方式。

### 選択肢 C: LP 全体を SvelteKit `adapter-static` 化して `+page.svelte` に吸収

- **概要**: `site/**` を `src/routes/(marketing)/` に移し SSR/SSG、labels を直接 import。
- **却下理由**: アーキ大改修で ADR-0010 バケット C（Pre-PMF 過剰）判定済（#566 で見送り）。

### 選択肢 D: 自前 sanitizer 実装

- **概要**: 許可タグの正規表現でゼロ依存。
- **却下理由**: XSS 関連は確立 OSS 必須（#1350、10 行超）。長期保守でセキュリティリスク蓄積。

## 決定

**選択肢 A: DOMPurify を採用**。SSOT は `scripts/generate-lp-labels.mjs` の `applyLpKeys()` テンプレート（生成物 `site/shared-labels.js` を直接編集しない）。同テンプレートを innerHTML + DOMPurify sanitize に書換 → 再生成 → LP 339 + Legal 354 = 693 件すべてを `data-lp-key` SSOT 配下に統合する。

- **適用範囲（例外なし）**: LP 6 ページ + Legal 4 ページ（`privacy` / `terms` / `sla` / `tokushoho`、ADR-0009 §例外「法的文書」を本 ADR が supersede）。labels.ts に `LP_LEGAL_*_LABELS` / `LP_PAMPHLET_LABELS` / `LP_FAQ_BODY_LABELS` namespace を追加。
- **DOMPurify 配信**: `site/` は GitHub Pages static で npm bundle 経路を持たないため **CDN 必須**（`cdn.jsdelivr.net/npm/dompurify@3`、全 10 ファイルの `<head>`）。未ロード時は安全側で `textContent` フォールバック + console.warn。
- **DOMPurify 設定値 / pamphlet 印刷タイミング / LEGAL coverage check rework の実装詳細**は §詳細仕様の所在を参照。

## 結果

### 利点
- ADR-0009 の「100% SSOT」が真に達成（PO 方針充足）。nested HTML を保持し LP の表現力を犠牲にしない。
- XSS 防御を業界標準（OWASP 推奨）で実装、自前リスクなし。法的文書も SSOT 配下に入り文言ドリフトを構造的に防止。

### トレードオフ
- bundle に DOMPurify 22 KB gzip 追加（LP は 1 ロードのみ、許容範囲）。CDN ロード失敗時は textContent 劣化注入。
- ADR-0009 §例外「法的文書」を本 ADR が supersede。
- 実装は 693 件の移行で大規模（4 sub-PR に分割、各 sub は単独完遂・partial close 禁止で進行）。

## 詳細仕様の所在

実装詳細（DOMPurify config の ALLOWED_TAGS / ALLOWED_ATTR、pamphlet `beforeprint` 再注入、LEGAL coverage check の逆方向検証、対象 10 ファイル一覧、namespace key 数、sub-A〜D の Phase 区分）は以下の設計書 SSOT に集約済。本 ADR は意思決定の核のみを保持する。

- `docs/design/06-UI設計書.md` §19「LP / Legal 文言の SSOT 経路」 — SSOT 経路 / DOMPurify config / Table row 例外 / Print E2E
- `docs/design/22a-アイコン・ラベル統一規約.md`「LP / Legal SSOT 100% 達成」 — 対象ファイル / 削減数 / Phase 区分
- `docs/design/14-セキュリティ設計書.md` §7.1.2 / §7.2 — CSP allowlist（ADR-0029 連動） / DOMPurify を第一層とする XSS 多層防御

## 関連
- ADR-0009（labels.ts SSOT 原則）— §例外「法的文書」を本 ADR が supersede（履歴は archive/0009 内）
- ADR-0014（i18n 機構選定）— Paraglide 移行前の `shared-labels.js` 経路延命策
- ADR-0029（LP CSP / CDN SRI Strategy）— DOMPurify CDN allowlist の根拠と表裏一体
- Issue #1683（SSOT 100% 完全化）/ #1465 / #1346
- DOMPurify: https://github.com/cure53/DOMPurify
