# SEO 戦略書

| 項目 | 内容 |
|------|------|
| 版数 | 1.1 |
| 作成日 | 2026-04-09 |
| 更新日 | 2026-04-11 (#832) |
| 作成者 | 日下武紀 |

---

## 1. 概要

LP（ganbari-quest.com）の検索エンジン最適化戦略を定義する。

---

## 2. ターゲットキーワード

### 2.1 主要キーワード

| キーワード | 検索意図 | 優先度 |
|-----------|---------|--------|
| 子供 ポイント アプリ | 比較検討 | 高 |
| お手伝い 記録 アプリ | 直接ニーズ | 高 |
| ゲーミフィケーション 子育て | 情報収集 | 中 |
| 子供 生活習慣 アプリ | ニーズ探索 | 中 |
| がんばりカード デジタル | 代替検索 | 中 |

### 2.2 ロングテールキーワード

- 「子供が自分から動くアプリ」
- 「お手伝いポイント制 デジタル」
- 「小学生 がんばり表 アプリ」

---

## 3. テクニカル SEO

| 項目 | 対応状況 | 対策 |
|------|---------|------|
| メタタグ (title, description) | ✅ | LP に設定済み |
| OGP (Open Graph) | ✅ | SNS シェア用画像設定済み |
| sitemap.xml (LP: www.ganbari-quest.com) | ✅ #832 | `site/sitemap.xml` に静的配置（7 URL: /, /pricing.html, /pamphlet.html, /terms.html, /privacy.html, /tokushoho.html, /sla.html） |
| sitemap.xml (App: ganbari-quest.com) | ✅ #832 | `src/routes/sitemap.xml/+server.ts` で動的配信 (prerender)。`/pricing`, `/auth/login` を列挙。`/legal/*` は LP への 301 のため LP sitemap 管理 |
| robots.txt (LP) | ✅ #832 | `site/robots.txt` で全許可 + Sitemap 指示 |
| robots.txt (App) | ✅ #832 | `static/robots.txt` で /admin, /ops, /api, /switch, /tenants, /setup, /demo/admin, /view, /uploads を Disallow |
| 構造化データ (JSON-LD) | ✅ #832 | `site/index.html` に `SoftwareApplication` schema 埋め込み (offers: フリー/スタンダード/ファミリー) |
| Core Web Vitals | → 37-パフォーマンス基準書 | LCP < 2.0秒 |
| モバイルフレンドリー | ✅ | レスポンシブデザイン |
| HTTPS | ✅ | ACM 証明書 |

### 3.1 Google Search Console 登録手順 (ローンチ時)

LP (`www.ganbari-quest.com`) と App (`ganbari-quest.com`) は別プロパティとして登録する。

**LP プロパティ (`https://www.ganbari-quest.com/`)**

1. [Google Search Console](https://search.google.com/search-console) → プロパティ追加 → URL プレフィックス
2. 所有権確認 → HTML タグ方式 → `site/index.html` の `<head>` に `<meta name="google-site-verification" content="...">` を追加 → GitHub Pages に main push
3. サイトマップ登録 → `https://www.ganbari-quest.com/sitemap.xml`

**App プロパティ (`https://ganbari-quest.com/`)**

1. プロパティ追加 → URL プレフィックス → `https://ganbari-quest.com/`
2. 所有権確認 → HTML タグ方式 → `src/app.html` に `<meta name="google-site-verification">` を追加 → Lambda デプロイ
3. サイトマップ登録 → `https://ganbari-quest.com/sitemap.xml`

**運用**

- カバレッジ / 検索パフォーマンスを 4 週間後にレビュー
- robots.txt テスター / URL 検査で `/admin`, `/ops` 等が Disallow されていることを確認

---

## 4. コンテンツ SEO

→ 38-コンテンツ戦略書 のブログ記事で対応

---

## 5. 計測

| ツール | 用途 |
|-------|------|
| Google Search Console | 検索パフォーマンス |
| Google Analytics 4 | ユーザー行動分析（将来導入） |
