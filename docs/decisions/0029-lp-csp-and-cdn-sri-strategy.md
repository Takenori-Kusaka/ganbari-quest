# 0029. LP CSP 多層防御 + CDN SRI / pin 戦略

| 項目 | 内容 |
|------|------|
| ステータス | **accepted (2026-05-01、2026-05-14 connect-src amendment #2068)** |
| 日付 | 2026-05-01 |
| 起票者 | PO |
| 関連 Issue | #1719 / #1683 / #1701 / #1705 / #2068 (connect-src amendment) |
| 関連 ADR | ADR-0010 (Pre-PMF スコープ) / ADR-0024 (インフラ PR baseline) / ADR-0025 (LP SSOT 注入機構 + DOMPurify) |

## コンテキスト

ADR-0025 により `site/*.html`（GitHub Pages 静的配信）は `cdn.jsdelivr.net/npm/dompurify@3` を CDN で読み込み、LP に流れる SSOT 文言を `el.innerHTML = DOMPurify.sanitize(...)` で注入している。PR #1705 の QM レビューで以下 3 点が観察された:

1. **DOMPurify CDN script に SRI が無い** — 同 LP 内の splidejs は SRI 付きで読み込まれているのに DOMPurify だけ SRI 無しという**一貫性の欠如**
2. **DOMPurify は `dompurify@3` major pin で運用** — patch を CDN 経由で自動取り込みする方針 (#1705)。SRI を `sha384-...` で固定すると CDN 配信物の bytes が変わった瞬間にロード失敗 → LP 全停止のリスクがある（major pin と SRI の両立は構造的に不可能）
3. **LP 全 10 ページに CSP (Content-Security-Policy) が無い** — 任意 origin からのリソース読み込みが許可されたまま。SvelteKit 側 (`hooks.server.ts`) は CSP を全レスポンスに付与済だが、`site/**` は SvelteKit 経由でない静的配信のため対象外

GitHub Pages では HTTP レスポンスヘッダーを制御できず、`<meta http-equiv="Content-Security-Policy">` で対応する必要がある（`frame-ancestors` / `report-uri` / `sandbox` は meta では効かないが、本 LP の脅威モデル = 静的配信 + analytics 無し + 認証無し では他指令で十分）。

## 検討した選択肢（OSS / 確立パターン調査 — #1350）

一次資料（OWASP CSP Cheat Sheet / MDN CSP meta tag・Subresource Integrity / GitHub Pages 公式 / jsDelivr Best Practices / OWASP WSTG-CONFIG-12）から、静的サイトでも meta tag CSP を最低限の防御として推奨、SRI は「特定バージョン pin の時のみ意味があり range pin とは両立不可」が業界合意であることを確認。

| 選択肢 | 概要 | 判定 |
|-------|------|------|
| **A: SRI 完全固定 + 手動更新** | `dompurify@3.4.5` 完全 pin + `integrity`。patch は手動 PR で取込 | **rejected** — sanitizer は CVE patch を自動取込したい。「patch 自動取込」(ADR-0025 amendment #1705) と矛盾 |
| **B: minor pin (`@3.4`) + SRI なし** | minor 単位 pin、SRI なし | **rejected** — SRI 無しの多層防御欠如が解消されない |
| **C: 自前ホスティング** (`site/vendor/`) | jsDelivr 依存排除、bundle 同梱 | **partially adopted (将来 fallback)** — 配布パイプライン追加コスト。DOMPurify ロード失敗時の `textContent` フォールバックは ADR-0025 で実装済のため、D 案で問題が出たら C 案へ移行と位置づけ |
| **D: CSP `script-src` allowlist + DOMPurify は major pin 維持** | LP 全 10 ファイルに CSP meta tag 追加、`script-src` allowlist で任意 origin script 注入を構造的に塞ぐ。pin 戦略は変えず実装は HTML 1 行追加のみ・bundle 影響ゼロ | **採用** — OWASP / Mozilla / GitHub の CSP 推奨と整合 |

## 決定

**選択肢 D を採用** + **C 案を将来のフォールバックとして文書化**。一貫した SRI / pin 方針を確立する。具体的な CSP 内容・指令根拠・SRI/pin マトリクスの SSOT は [`docs/design/14-セキュリティ設計書.md §7.1.2`](../design/14-セキュリティ設計書.md) に集約する（ADR は方針判断、設計書は実装仕様）。

### 1. LP 全 10 ページに CSP meta tag を追加

対象は `site/` 配下の全 10 ページ（対象ファイル一覧は設計書 §7.1.2 が SSOT）。`<meta http-equiv="Content-Security-Policy">` を `<head>` に追加し、`default-src 'self'` ベースで `script-src` / `style-src` / `connect-src` に `https://cdn.jsdelivr.net` を allowlist する。`object-src 'none'` / `base-uri 'self'` / `form-action 'self'` で攻撃面を絞る。`connect-src` の jsDelivr 許可は DevTools の sourcemap 取得 (#2068) のため。完全な content 文字列と各指令の根拠表は設計書 §7.1.2 が SSOT。

### 2. ライブラリ別 pin / SRI 戦略（多層防御の構造）

| ライブラリ種別 | pin 戦略 | SRI | CSP allowlist | 根拠 |
|---------------|---------|-----|---------------|------|
| **特定バージョン pin** (splidejs `@4.1.4` JS / CSS) | 完全 pin | **必須** (`sha384-...`) | 不要（補助） | bytes 固定で SRI が機能。改ざん耐性最強 |
| **major / range pin** (`dompurify@3` / `budoux@latest`) | major / range | **付与禁止** | **必須** | bytes が変わり SRI と両立不可。CSP allowlist で経路防御。DOMPurify は CVE patch 自動取込優先 (ADR-0025 amendment)、budoux は XSS 経路にならない補助 |
| **将来追加するライブラリ** | 原則「特定 pin + SRI」が第一選択。patch 自動取込が必要な sanitizer / linter 系のみ「major pin + CSP allowlist」を許容 | — | — | security critical なら patch 自動取込優先、そうでなければ整合性優先 |

多層防御は ① DOMPurify サニタイズ (ADR-0025) ② CSP allowlist (本 ADR) ③ SRI 付き完全 pin (splidejs) の 3 層で構成する。

### 3. 移行計画 / 適用順序

PR #1719 で 1 PR 全件適用: ① 全 10 ファイルの `<head>` に CSP meta tag 追加 ② `tests/e2e/lp-csp.spec.ts` 新規追加（全 10 ページで CSP meta tag 存在 + Console / Page error なしを検証）③ 設計書 §7.1.2 サブセクション追加 ④ `measure-lp-dimensions.mjs` の THRESHOLDS 非違反をローカル検証。

### 4. C 案 fallback への移行条件

以下が発生したら C 案（自前ホスティング）への移行を検討する。それまでは D 案を維持（Pre-PMF ADR-0010 スコープ最小化）:

- DOMPurify CDN が長時間落ちる事例（jsDelivr 障害が複数回）
- DOMPurify 配布物への改ざんが業界レベルで観測されたケース
- jsDelivr の TOS 変更で広告 / トラッカー注入が始まった場合

## 結果

### 利点

- LP 全 10 ページで CSP meta tag による多層防御を達成（DOMPurify サニタイズ + CSP `script-src` allowlist）
- pin 戦略を変えずに実装できるため bundle 影響ゼロ・runtime 影響ゼロ
- splidejs / DOMPurify / budoux で SRI / pin 戦略の根拠が明文化され、将来追加ライブラリも同じマトリクスで判断可能
- アプリ側 (`hooks.server.ts`) と LP 側で CSP 方針が一貫（`default-src 'self'` ベース、`script-src` allowlist が違うのは LP のみ CDN 利用のため）

### トレードオフ

- meta tag CSP は HTTP ヘッダーより一部指令 (`frame-ancestors` / `report-uri` / `sandbox`) が効かない。本 LP は static + auth 無しのため許容
- `'unsafe-inline'` を `script-src` / `style-src` に許可している（現行 LP の inline `<script>` / `style="..."` が多いため）。将来 inline を全排除した時点で削除し nonce 化を検討（追加 ADR で議論）
- DOMPurify は SRI なしのまま CDN 改ざん攻撃に対しては jsDelivr の信頼に依存（OWASP / Mozilla 推奨の中間ライン）

### 関連

- ADR-0010（Pre-PMF スコープ判断）— `report-uri` / nonce / hash CSP / WAF / 監査ログ DynamoDB 等は過剰防衛として不採用
- ADR-0024（インフラ PR baseline）— アプリ側 CSP は同 ADR 範疇。本 ADR は LP（静的サイト）側を補完
- ADR-0025（LP SSOT 注入機構 + DOMPurify CDN）— 本 ADR と直接連動
- [`docs/design/14-セキュリティ設計書.md §7.1.2`](../design/14-セキュリティ設計書.md) — CSP content / 指令根拠 / SRI・pin マトリクスの実装仕様 SSOT
- Issue #1719（本 ADR の起点）
