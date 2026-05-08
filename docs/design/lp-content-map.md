# LP Content Map — がんばりクエスト ランディングページ IA SSOT

> 本ドキュメントは `site/index.html` (がんばりクエスト LP) の **情報アーキテクチャ (IA) の単一情報源 (SSOT)** です。
> LP の構造・コピー・CTA・社会的証明・料金表示等を変更する際は、**必ずこのドキュメントを先に更新** してから実装に着手してください。
>
> **関連 Issue**: #1088 (LP 情報設計リストラクチャ)、#1158 (「楽しくなる仕組み」重複解消)、#1159 (企画書コア要素 LP 訴求追加)、#1163 (AC 再検証と未達完了)
>
> **関連 ADR**: ADR-0010 (Pre-PMF Issue 優先度)、ADR-0009 (labels.ts SSOT)

---

## 1. 目的とスコープ

### 1.1 本ドキュメントが解く問題

- LP のコンテンツ更新が場当たり的になり、類似機能が重複訴求される（例: 「5つのチカラチャート」と「成長記録 & 管理画面」が両方とも「親向けの成長可視化」）
- 企画書のゲーミフィケーション要素 (36+ 要素) のうち LP で訴求されているのは ~33% に留まる
- CTA 文言がページ内で 5 種類以上に散らばり、CVR 計測が混線
- Mobile ページ高が 22000px+ に肥大化してスクロール離脱を招いている
- AC 未達のまま closed されて品質劣化が累積する（#1088 の反省）

### 1.2 スコープ

- **対象**: `site/index.html`, `site/pricing.html`, `site/selfhost.html`, `site/pamphlet.html`, 関連フッター
- **対象外**: アプリ内 (`src/routes/`) の画面設計、SEO 文言詳細、広告クリエイティブ、`site/help/license-key.html`（既存ユーザーへの操作ガイドであり LP スコープ外。#1736 m-MIN-11）

---

## 2. ターゲットペルソナ

| コード | ペルソナ | 年齢 | 主関心 | LP での到達点 |
|---|---|---|---|---|
| **P1** | 3 歳児の親 | 28-35 歳 | トイトレ・生活習慣、スマホ依存への不安 | 「うちの子でもタップできる」「シール帳の代替」と確信 |
| **P2** | 小学生の親 | 30-45 歳 | 宿題・お手伝い習慣化、教育関心高 | 「ポイント・ウィークリーチャレンジで自走する」「親が褒める UI がある」と納得 |
| **P3** | 中学生本人 | 13-15 歳 | 自分で管理したい、RPG/ゲーム体験 | 「小学生から継続で使える」「プリセットが学年に合う」と認識 |
| **P4** | 高校生本人 / 保護者 | 16-18 歳 | 目標達成・奨学金・資格 | 「情報密度高い管理画面」と認識 |
| **P5** | 祖父母・おじおば | 50-70 歳 | 孫の成長を見守りたい | Family プランの「家族 6 人まで」で加入動機 |

---

## 2.1 年齢差別化軸ポリシー (2026-04-21 #1320 確定)

本プロダクトの年齢差別化軸は **UI 軸のみ** であり、機能差別化は現時点で存在しない。
LP で年齢別の「代表機能」を訴求する際は、この実装実体に整合すること (ADR-0013 LP truth 原則)。

### 実装実体

| 差別化軸 | preschool (3-5) | 小学生以降 (6-18) |
|---------|----------------|-----------------|
| 文字 | ひらがな | 漢字 |
| タップサイズ | 80px | 44-56px |
| fontScale | 1.2 | 1.0 |
| 演出 | 絵文字主体 | 情報密度 |
| FeatureFlags | FULL_FEATURES | FULL_FEATURES |
| 活動プリセット | preschool-* | elementary-* / junior-* / senior-* |

※ baby (0-2 歳) は ADR-0011 で「親の準備モード」として別軸扱い。

### LP での許容訴求

- ✅ **UI 軸**: 「ひらがなの幼児 UI」「情報密度を高めた小学生以降 UI」
- ✅ **活動プリセット差**: 「学年に合わせてプリセットが変わる」
- ✅ **15 年継続利用**: 「3-18 歳、家族で同じプロダクトを継続利用」
- ❌ **機能差別化訴求**: 「中学生から解放」「中高生専用機能」等は存在しないため LP で書かない
- ❌ **RPG バトル = upper 代表**: バトルは全年齢 (elementary+) 共通の daily trio の 3 つ目。upper の代表機能ではない

### 将来差別化の方針

upper 年齢 (junior/senior) の差別化実装候補は **文部科学省キャリア・パスポート家庭版** (6-18 歳 12 年 portfolio)。
国家制度整合の競合優位性が強いが、Pre-PMF + dogfooding 不可能性で現時点では実装しない。詳細は #1324 (B4+5-PENDING-CAREER) 参照。

実装を開始するまでは **LP で「upper 差別化」を訴求しない** (LP truth 原則)。

### RPG バトルの位置づけ

daily trio (stamp card / omikuji / battle) の 3 つ目。プレイ機能ではなく **累積努力の視覚化儀式**。
baby/preschool では 404、elementary+ で通常動作。詳細は #1323 (B4+5-BATTLE-UNLOCK) 参照。

ゲーミフィケーション設計書 `docs/design/26-ゲーミフィケーション設計書.md` §バトル (年齢帯解放仕様) も併読すること (実装実体の SSOT)。

---

## 3. サイトマップ（ページ役割分担）

### 3.1 ページ階層

```
/ (index)                ← LP トップ。体験を売る
├── /pricing             ← 3 プラン比較・FAQ・家族での使い方
├── /selfhost            ← OSS/技術者向け分離ページ
├── /pamphlet            ← 配布用 A4 PDF 化前提の静的紹介
├── /help/license-key    ← ライセンスキー購入者向け手順
├── /privacy             ← 法務: 広告なし・データ主権訴求を含む
├── /terms               ← 法務: 利用規約
├── /tokushoho           ← 法務: 特定商取引法
├── /sla                 ← 法務: SLA
└── /sitemap.xml         ← クローラ向け
```

### 3.2 各ページの役割と役割分担

| URL | 役割 | LP 本体との関係 |
|---|---|---|
| `/` | **体験を売る**: ヒーロー → ゲーム体験 → 社会的証明 → 料金サマリ → CTA の 10 セクション | 本ドキュメントで規定する IA |
| `/pricing` | **比較させて決めさせる**: 3 プラン詳細比較表 + 家族での使い方 + 料金 FAQ | LP 内の料金サマリから CTA で流す |
| `/selfhost` | **OSS/技術者向け**: 独立ページ。LP 本体では **footer テキストリンク** のみ | footer に 1 リンク。本文では訴求しない |
| `/pamphlet` | **配布用静的ページ**: A4 印刷/PDF 化前提。LP の「要約版」 | LP と別メンテナンス。LP IA 変更時は最低限の同期のみ |
| `/help/license-key` | **ライセンス購入者向け手順**: 自己申込み経路 | LP からは footer のみ |
| `/privacy` | **法務 + 安心訴求**: 「広告なし・家族限定・データ主権」 | LP [08] 安心訴求からリンク |
| `/terms` `/tokushoho` `/sla` | **純法務**: 契約根拠 | footer のみ |

### 3.3 LP 本体に載せない判断

- **セルフホスト/OSS 訴求**: 技術者向けの差別化であり、P1-P5 の CVR には寄与しない。footer リンクに留める
- **pamphlet の内容**: 重複するため LP 本体の要約として扱い、LP 更新時は pamphlet を事後同期
- **SLA の詳細**: 意思決定に使うユーザーは少数。footer からの参照で十分

---

## 3.5 LP セクション 魅せ方規範 § (#1789)

> **PO 直接指摘**: 「各セクションごとに魅せ方が全然違うのは統一しなくていいのですか？」「個人的には『お子さまの年齢で、画面とむずかしさが変わります』や『親が安心できる運用補助』のセクションが好み」（PO-A-1 / 主担当 finding C-CRT-1 / C-CRT-5 / U-MAJ-5 / U-MAJ-8）

LP 9 セクションが独立に最適化されて scrshot 配置・ベネフィット粒度・主語・カードレイアウトがバラバラに散らばる構造的問題に対し、PO お気に入り 2 セクション（[02b] age-panel / [05] soft-features）を **規範** として固定し、9 セクション全体の濃度を統一するための SSOT を本節で定義する。

### 3.5.1 規範 A: [02b] age-panel — 大 scrshot 1 + 親主語短文

| 項目 | 規範値 |
|------|--------|
| 構造 | 大 scrshot 1 + h3 親主語 1 行 + UI 軸特徴 1 行 + 学年訴求 1 文 + CTA |
| 情報密度 | **low** |
| scrshot 占有率 | **高** (≥ 35%) |
| 主語 | 親 |
| ブロック数 / カード数 | タブ 2 + 各タブ 4 要素 |
| ベネフィット行数 | 1 行 |
| 文字 px 占有率 | 30-40% |
| 色面積 | bg-white / 軽いグラデのみ、強いブランドカラー面積は最小 |

「短文 + 大 scrshot で意思決定を駆動する」原型。ペルソナ訴求セクション（[02][02b][05][05b]）はこの規範に整合させる。

### 3.5.2 規範 B: [05] soft-features — 並列 3 cards 完全均質化 (#1847 PO-N-5)

| 項目 | 規範値 |
|------|--------|
| 構造 | 並列 cards 3 (各 scrshot + h3 + 1 文) — featured 強調なし、3 cards 視覚均質 |
| 情報密度 | **mid** |
| scrshot 占有率 | **高** (≥ 30%) |
| 主語 | 親 (「親が安心できる運用補助」明示) |
| ブロック数 / カード数 | 3 cards (並列 3 / 均等幅) |
| ベネフィット行数 | 各 1 文 (≤ 2 行) |
| 文字 px 占有率 | 35-45% |
| 色面積 | 全 cards 中性面 (featured アクセント撤廃、視覚均質化) |

「3 cards の並列で機構を整然と提示する」原型。機構説明セクション（[03][04]）はこの規範に整合させる。
過去の featured 強調 (1 枚目だけ h3 拡大 + brand-700 色 / soft-shot max-height 拡大 / grid 1.2fr) は #1847 PO-N-5 (解釈 B 完全均質化) で完全撤去された。

### 3.5.3 4 トーンマップ

LP 9 セクションを 4 トーンに分類し、各トーンに「規範のどちらに整合するか」「許容濃度」を固定する:

| トーン | 該当セクション | 許容濃度 | 整合する規範 |
|--------|-----------|---------|-----------|
| 高度 0（最大訴求） | [01] hero | **high** | （規範対象外、ファーストビュー特例） |
| ペルソナ訴求 | [02] versus / [02b] age-panel / [05b] growth-roadmap | **low-mid** | 規範 A |
| 機構説明 | [03] core-loop / [04] machine-tour / [05] soft-features | **mid** | 規範 B |
| 信頼/法務 | [07] safety / [08] FAQ | **mid** | 規範 B（並列 cards または並列 Q&A） |

### 3.5.4 5 指標濃度ルーブリック

新規セクション追加時 / 既存セクション改訂時は、必ず以下 5 指標で濃度を測定し、規範 ±20% 以内に収まることを確認する:

| 指標 | 測定方法 | 規範 A (low) | 規範 B (mid) |
|------|---------|--------|--------|
| ベネフィット行数 | h3 + p の合計行数を実機 mobile 375px で目視カウント | ≤ 2 | ≤ 2 |
| scrshot 占有率 | scrshot 領域 px / セクション全縦 px | ≥ 35% | ≥ 30% |
| ブロック数 | h2/h3 で区切られたコンテナ数 | ≤ 4 | ≤ 4 |
| 主語統一 | h3 / p で「親が」「お子さま」の主語が一貫しているか | 親主語必須 | 親主語必須 |
| 文字 px 占有率 | テキストブロック全縦 px / セクション全縦 px | 30-40% | 35-45% |

濃度逸脱が出た場合は、(a) ブロック数を減らす / (b) scrshot を大きくする / (c) ベネフィット行を統合する のいずれかで規範に揃える。

### 3.5.5 9 セクション分の規範整合状態表

> 2026-05-01 #1789 確定時点。各 PR で本表を更新し、規範逸脱がないか確認する。

| # | セクション | 適用規範 | 濃度 | 整合状態 | メモ |
|---|---|---|---|---|---|
| 01 | hero | （規範外） | high | — | ファーストビュー特例 |
| 02 | versus | 規範 A (ペルソナ訴求) | low-mid | **改訂対象** (#1784 / C5) — 4 行 → 3 行 + scrshot 1 枚で規範 A 整合へ |
| 02b | age-panel | 規範 A | low | **規範本体** | PO お気に入り |
| 03 | core-loop | 規範 B (機構説明) | mid | **#1787 で 4 階層 → 1 階層 3 cards に圧縮** — summary 画像 + 3 cards で規範 B 整合 |
| 04 | machine-tour | 規範 B | mid | 整合 (2 cards、責務は補足機構) | [03] と重複しない補足機構のみ。**#1802**: H2「コアループに加えて — 朝の準備とクライマックスを支える機構」で sub-section 階層を明示し、[03]「3 つの仕組み〜」との連続「Nつの〜」H2 誤読を解消 |
| 05 | soft-features | 規範 B | mid | **規範本体** | PO お気に入り |
| 05b | growth-roadmap | 規範 A | low-mid | **改訂対象** (#1792 / M2) — 子ベネフィット行を hero / [02b] に統合 |
| 07 | safety | 規範 B | mid | 整合 (4 cards、信頼訴求) | |
| 08 | FAQ | 規範 B | mid | 整合 (Top 3 並列 Q&A) | |

### 3.5.6 連携 Issue

- Blocks: #1784 (C5 versus 改訂) / #1785 (C6 machine-tour 整合) / #1787 (C8 core-loop 圧縮) / #1792 (M2 growth-roadmap 改訂)
- 連携 ADR: ADR-0010 (Pre-PMF Permission marketing) / ADR-0013 (LP truth)

### 3.5.7 規範からの逸脱を許容するケース

- ファーストビュー [01] hero: 「2 秒で価値と CV 導線」が役割であり、濃度ルーブリックは適用外
- 法務系単独ページ (`/privacy` / `/terms` / `/sla` / `/tokushoho`): 法務文書の性格上、cards 構成より連続文体が適切

逸脱を許容する場合は、本表の「適用規範」列に「（規範外）」「（特例）」を明記し、理由を併記する。

---

## 4. LP トップページ IA（10 セクション構成）

> **競合調査根拠**: Greenlight (ダブルペルソナ構造)、ClassDojo + Plus (無料×有料の役割分担)、Finch (1メタファ一点突破)、BusyKid (価値の階段化)、みてね (日本親世代の信頼感) の 5 サイトをリスペクト。

### 4.1 セクション一覧と寸法目安

| # | セクション | 目的 | Mobile px (目安) | Desktop px (目安) |
|---|---|---|---|---|
| 01 | Hero | 2 秒で価値と CV 導線を提示 + 価格 anchor + 不安解消 + 仕様バッジ (#1625 R21 / #1626 R22 / #1628 R24) | 1300 | 800 |
| 02 | アナログ vs デジタル | 「シール帳でいい」離脱要因 #1 を 30 秒で反転（#1597 ADR-0023 I5 / #1614 R10） | 700 | 500 |
| 02b | 年齢スイッチャー | ペルソナ分岐（唯一地点） | 1500 | 900 |
| 03 | コアループ | 1 メタファで全体像を把握 + retention 統合 (#1621 R17) | 1700 | 950 |
| 04 | 機構ツアー | 補足機構 4 つ（[03] と重複しない長期/朝/夜/冒険） (#1622 R18 で 5→4 圧縮) | 2200 | 1300 |
| 05 | ソフト機能 | 親の安心（手間軽減、ゲームっぽさの中和） (#1623 R19 で責務分割) | 1300 | 800 |
| 05b | 年齢別成長ロードマップ | 卒業を最終地点として位置付ける (#1613 R9) | 1100 | 600 |
| 06 | 料金プロミスバンド | 1 バンドで価格プロミス提示 (詳細は /pricing) | 600 | 400 |
| ~~06b~~ | ~~習慣形成~~ | **#1621 R17 で削除し [03] L2 へ統合** | – | – |
| 07 | 安心訴求 | 広告なし/家族限定/カギ付き/公開（モラル安心） (#1623 R19) | 800 | 500 |
| 08 | FAQ | Top 3 のみ (残りは /faq) | 1200 | 700 |
| 08b | founder 直接相談 (#1594) | Pre-PMF 期 founder と直接対話する入口 | 600 | 400 |
| ~~09~~ | ~~最終 CTA~~ | **#1838 で削除（選択肢 A）**。Success 像は hero / growth-roadmap [05b] に内在化、最終 CTA の機能は floating-cta + footer mailto / signup link に集約 | – | – |
| | **合計（実測 2026-04-29）** | | **~13662** | **~7458** |

> #1621 R17 で [06b] retention セクションを削除し、コア訴求（変動比率/射幸心 → 1 日 1 回まで・煽らない設計）を [03] コアループ L2 (習慣カード) へ統合した。
> #1622 R18 で [04] 機構ツアーを 5 → 4 カードに圧縮（[03] と重複する①おみくじを削除し、③コンボ系を旧ルーチン-CL に再定義、用語を ADR-0012 整合へ刷新）。
> #1708 R3-A で [04] 機構ツアーを 4 → 3 カードに再圧縮（旧 ③ ルーチン-CL カードを削除）。`activities.priority='must'`（今日のおやくそく）に役割移管したため LP 訴求を分離（ADR-0027 参照）。
> #1625 R21 / #1626 R22 / #1628 R24 で Hero に価格 anchor 1 行バンド + 不安解消 3 バッジ + 仕様起点 3 バッジを追加（PMF 後送り testimonial の代替）。
> #1627 R23 で Hero carousel の autoplay を停止し、`prefers-reduced-motion` を尊重。

> 旧 [06] 社会的証明 (Pre-PMF 4 点セット) は **#1282 で削除** した。β / 0-18 / 36+ / OSS の 4 数値は「自己言及的メタデータ」であり顧客にとっての社会的証明として成立せず、「使われていないサービス」という否定的シグナルを逆に強調していたため。PMF 到達後に「利用家族数 / 星評価 / 累計達成数 / 受賞」の 4 点セットを §4.3 の顧客価値 gate を通したうえで再投入する（§4.2 の旧 [06] 仕様をアーカイブとして残す）。

> 閾値 **Mobile ≤15000px / Desktop ≤8000px** (`scripts/measure-lp-dimensions.mjs` 実測値で CI ゲート)

### 4.2 セクション詳細

#### [01] Hero

- **H1**: 「やりなさい」を「やりたい！」に変える家族の冒険アプリ（#1899: IT リテラシーなし親対応で旧「家族 RPG」から書換え。RPG はサブ訴求 / meta description で SEO 維持）
- **Sub**: 3-18 歳の毎日の習慣を、ゲームのように楽しめる仕組みに変える
- **CTA 2 つ**: `無料で始める`（プライマリ）/ `デモを見る`（セカンダリ）
- **補足テキスト**: 「家族何人でも無料ではじめられます / クレジットカード登録不要」
- **ビジュアル**: ヒーローイラスト + アプリスクショ（モバイル/デスクトップで切替）
- **PC 横長レイアウト** (#1617 R13 / Phase 5 P2):
  - `<br>` 強制改行は使わず `text-wrap: balance; word-break: auto-phrase;` (ADR-0016) で自然折り返し
  - `h1` の `max-width` は 1200px、PC (≥1024px) では `font-size: 2.9rem` / `padding: 80px 24px 64px` に拡大
  - `hero-sub` は `max-width: 780px` / `font-size: 1.12rem` (PC のみ)

> 注: 旧 [01b] StoryBrand Guide ブロック (#1784 で導入) は **#1843 で完全 revert** した。PO-N-1 指摘「タイトルと内容が乖離した一番上にくるセクション不適切」を受け、Hero 直後 30 秒離脱判断ゾーンに「理念」セクションを置く構成自体を不適切と判断。同じ訴求軸（Anti-engagement / 3-18 歳 / 家族限定）は trust + growth-roadmap で既に伝わるため情報欠落は発生しない。IA は Hero → versus 直行に戻した。

#### [02] アナログ vs デジタル — シール帳・ホワイトボードと何が違うのか（#1597 ADR-0023 I5 / #1614 R10 / #1784 vc-digital scrshot 配置）

##### §1. 設計背景（why）

ADR-0023 §5 I5 / C-Q10 で特定された **LP 離脱要因 #1 = 「LP で価値が伝わらない」**。
親 P1（35 歳共働き）が LP に来て 30 秒で離脱判断する直前、「シール帳・ホワイトボードでも代用できそう、わざわざアプリにする必要ある？」という疑問に直面する。
アナログは子供のユーザビリティ（パッと見・即アクション）が高いことを認識した上で、**デジタルだけが提供できる価値（自動集計・卒業設計・年齢別 UI 継続・場所自由）を 4 行比較で訴求**することで、離脱の臨界点で態度を反転させる。

ADR-0013 LP 実装 SSOT（Committed のみ訴求）/ ADR-0012 Anti-engagement（卒業ゴール）/ ADR-0011（コアターゲット 3-18 歳）と整合し、StoryBrand 7 要素の **Problem（顧客が直面する障害）と Plan（解決策の提示）** の橋渡しを担う。

##### §2. 設計原則（rules）

1. **アナログを否定しない**: 「わかります。私たちもまずは紙で試しました」と共感から入り、アナログ運用の正しさを認めた上で「3-18 歳・家族・継続」の三軸ではデジタルが届く差を提示する。比較対象を貶める表現は禁止（プロダクトの誠実性を損なうため）。
2. **4 行に圧縮、5 行以上は禁止**: ADR-0023 §5 I5 で示された 4-5 個の優位点を **4 行** に確定する（自動集計 / 3-18 歳継続 / 卒業設計 / 場所自由）。「親の負担軽減」は他セクションで重複訴求されるため本セクションでは外し、認知負荷を最小化する（離脱の臨界点で 30 秒読みに 4 行が上限）。
3. **配置はヒーロー直下固定**: P1 が hero でファーストインプレッションを得た直後、「で、結局シール帳と何が違うの？」という疑問が立ち上がる位置に配置する（[01] Hero 直後・[02b] 年齢スイッチャーの直前）。
4. **比較表構造で視覚的対比を成立させる**: 各行は `analog → digital` の 1:1 対応で構成し、矢印（→）で「アナログの限界 → デジタルの解」の論理を視覚的に表現する。アナログ側は事実のみ短く、デジタル側はタイトル + 1 文の説明で「具体的に何が変わるか」を読み手に想起させる。
5. **アイコンは置かない（#1723 R10 で削除）**: 各行のアイコン（`📊` / `🌱` / `🎓` / `📍`）は LP 全体の装飾アイコン総量削減（28 件 → 12 件）の方針で削除した。比較表は `vc-tag` (シール帳・紙 / がんばりクエスト) + 太字タイトル + 1 文補足の構造のみで対比意図が伝わる。視覚ノイズを取り除くことで scrshot とコピーへの集中を阻害しない。同方針で `[04] machine-tour` の `tour-emoji` / `[05] soft-features` の `soft-icon` / `[03] core-loop` の `cls-icon` も削除済み（scrshot で機能を語る）。
6. **対比視覚は arrow 記号のみで簡潔に**: ブランドキャラ画像はこの位置に配置すると「比較表本体への視線誘導」が阻害され、LP メトリクスへの負荷も大きい。`versus-arrow` (→) の単純記号で「アナログ → デジタル」の対比視覚を成立させる（#1723 R10 でアイコン絵文字も廃止）。
7. **ラベル SSOT 準拠 (ADR-0009)**: 全文言は `LP_VERSUS_LABELS`（`src/lib/domain/labels.ts`）→ `site/shared-labels.js` 経由で `data-lp-key="versus.*"` で注入。本 HTML 内に日本語直書きを残さない。
8. **メトリクス維持**: 本セクション分の追加で `mobileHeight ≤ 15000` / `desktopHeight ≤ 8000` / `forbiddenTerms = 0` / `ctaVariants ≤ 3` を維持する。CTA は本セクション内に追加せず、Hero / NAV / floating-cta / footer signup に集約（#1838 で旧 [09] 最終 CTA を削除）する（CTA 数を侵食しない）。

##### §3. 仕様（what）

- **配置**: `<section id="versus" class="section bg-white">` を `[01] Hero` 直後・`[02b] 年齢スイッチャー (#age-panel)` 直前に配置（`site/index.html` `LP-LANDMARK:versus`）
- **H2**: 「シール帳・ホワイトボードでは届かない 4 つの差」（`data-lp-key="versus.sectionTitle"`、#1844 PO-N-2 で投げかけタイトル「いいんじゃない？」を撤去 → 事実言い切りの体言止めに変更）
- **サブ**: 「わかります。私たちもまずは紙で試しました。でも「3 歳から 18 歳まで」「家族みんなで」「ずっと続ける」には、デジタルだから届く差があります。」（`data-lp-key="versus.sectionDesc"`）
- **構造**: `.versus-grid > .versus-row` の 4 行構成。各行 `.versus-row > .vc-analog → .versus-arrow (→) → .vc-digital`
- **4 行内訳**（#1723 R10 で各行のアイコン絵文字を廃止 / #1844 で digital desc を「ですます」→「体言止め」へ完全統一）:

| 行 | analog 側（事実のみ短文） | digital 側 タイトル + 体言止め補足 |
|----|---------------------------|--------------------------------|
| 1 | 集計が手作業で計算ミスが起きがち | **自動集計でいつでもポイントが見える** — 「あと 50 ポイントでごほうび」を子供自身が計画 |
| 2 | 年齢が変わるたびに冊子を買い替え | **3 歳から 18 歳まで同じアプリで継続** — 15 年分の成長履歴がひとつに |
| 3 | 続けることが目的になりがち | **子供が自律したらアプリは不要** — 「使わなくなる」が成功のゴール — 卒業を最終地点として設計 |
| 4 | 家を離れると続けられない | **旅行先・祖父母宅でも続けられる** — スマホ・タブレットで連続記録が途切れない |

- **ラベル管理**: 全 H2 / サブ / 4 行 × (analog title / digital title / digital desc) は `LP_VERSUS_LABELS`（`src/lib/domain/labels.ts`）→ `shared-labels.js` 経由で `data-lp-key="versus.*"` で注入
- **CSS スタイル**: `#versus` セクション全体は `padding:20px 16px`、`.versus-card.vc-analog` は `var(--gray-50)` 背景、`.vc-digital` は `linear-gradient(135deg, var(--brand-50) 0%, #fef9e7 100%)` でブランドカラーへのグラデーション、`.versus-arrow` は `var(--brand-700)` 色の `→`。モバイル (`<640px`) は `grid-template-columns: 1fr 18px 1.3fr`、デスクトップは `1fr 22px 1.4fr`
- **アイコン配置**: 廃止 (#1723 R10) — `vc-icon` 要素は site/index.html / labels.ts / shared-labels.js から削除。比較表は `vc-tag` + タイトル + 説明の 3 要素構成のみで対比を成立させる
- **vc-digital scrshot 配置 (#1784)**: 各 4 row の `.vc-digital` 内にテキスト直下で `.versus-shot` (`<picture>` + WebP) を縦積み配置し、各行で別々のアプリ画面 scrshot を表示する。撮影元の対応:
  - row1（自動集計）: `feature-point-level{,-desktop}.webp` (`/demo/lower/home`)
  - row2（年齢継続）: `age-kinder{,-desktop}.webp` (`/demo/kinder/home`)
  - row3（卒業）: `growth-stage-graduate{,-desktop}.webp` (`/demo/lower/achievements`)
  - row4（場所自由）: `feature-cheer-message{,-desktop}.webp` (`/demo/lower/home` — モバイル portable scrshot)

  `.versus-shot` は **実装が SSOT** (`site/index.html` `.versus-shot` 定義が一次情報): `aspect-ratio: 16/9` 固定 + `max-height: 70/80/90px` (≤640px/default/≥1024px) で行高さを揃え、新規撮影はせず既存 9 種から流用する（ADR-0013 LP truth）。`alt` 属性は `LP_VERSUS_LABELS.row{1..4}ShotAlt`（`src/lib/domain/labels.ts`）を SSOT として持つが、現状の `site/index.html` は `<img alt="...">` 直書きで同一文字列を保持している（`data-lp-key-attr` 機構は本 LP では未導入。labels.ts 側が SSOT、HTML 側が同期コピーの 2 系統管理）
- **CTA 非設置**: 本セクションには CTA を配置しない（Hero / NAV / floating-cta / footer signup に集約（#1838 で旧 [09] 最終 CTA を削除））。`ctaVariants ≤ 3` 制限を侵食しない
- **同期対象**: `site/pamphlet.html` には現時点で本セクションを反映しない（pamphlet は evaluate モード用 / A4 印刷前提のため要約版を維持。LP 本体の versus 比較は discover モード用）

#### [02b] 年齢スイッチャー (改訂後: 2 パネル構成 #1320)

- **目的**: P1-P4 の **ペルソナ分岐をこのセクションに集約**（他の場所では分岐しない）
- **構造**: 2 パネル構成 — §2.1 年齢差別化軸ポリシーに準拠

| パネル | 対象 | 代表訴求 |
|-------|------|---------|
| **kinder** | 幼児 (3-5 歳) | ひらがな + 大タップの幼児 UI、絵文字主体の優しい演出 |
| **primary-plus** | 小学生以降 (6-18 歳) | 漢字 + 情報密度高め、学年別プリセットで 15 年継続利用 |

- **各パネル内容**: 該当 UI 軸のスクショ 1 枚 + UI 軸上の特徴 + 「この年齢帯でこう使える」の一言
- **CTA**: `デモを見る`（該当 UI 軸のデモモードへ）
- ~~baby / lower / upper / teen の 4 タブ~~ は削除 (ADR-0011 で baby 排除、#1320 で lower/upper/teen を統合)

#### [03] コアループ (#1343: 3 層モデル刷新)

- **タイトル**: 3 つの層で、毎日のがんばりが本物の報酬になる
- **構造**: L1 アクション層 / L2 メタ習慣層 / L3 経済層 の 3 層縦積み + 親子両視点バナー (#1343、`LP_CORELOOP_LABELS`)
  - **L1 アクション層**: 活動を 2 タップで記録 → ポイント獲得
  - **L2 メタ習慣層**: 毎朝おみくじスタンプ（日 1 回 cap）→ スタンプカード完成（週次）
  - **L3 経済層**: ポイント蓄積 → ごほうびショップ（唯一の出口）で実物・お小遣い・特権と交換
- **訴求**: 親視点（プリセット設定 2 分・定量把握）と子供視点（活動→ポイント→ショップ交換）を同一セクション内で両面訴求
- **ごほうびショップ唯一の出口**: ポイントは「欲しいものと交換できる経済通貨」として機能し、子供の自律的目標設定を促す
- **禁句**: 「シールガチャ」(#1311 で撤回)、「UR を引く」等の射幸心文言 (ADR-0012 / ADR-0013)
- **PC 横長 2 カラムレイアウト** (#1619 R15 / Phase 5 P2):
  - `core-loop-2col` を 1024px+ で `grid-template-columns: minmax(0,1fr) 280px` に展開（左 text 8 / 右 aside 4）
  - 右側 `core-loop-aside` に screenshot を `position: sticky; top: 24px` で配置（スクロール中も見え続ける）
  - 1440px+ では aside 幅を 320px、`core-loop-section-inner` を 1360px max-width に拡張し screenshot を大きく訴求
  - mobile (<1024px) では従来通り 1 カラム縦積み（aside は `display: none`）

#### [04] 機構ツアー — 補足機構 3 つ（#1708 R3-A で 4→3 再圧縮）

#1622 R18 (アプローチ A): [03] コアループ 3 つの仕組みと重複しない **補足機構** に責務を圧縮した。
[03] L2 で既に語られる「おみくじ」カードを削除し、内部の「コンボ語彙」を ADR-0012 整合の表現へ刷新。
**#1708 R3-A**: ADR-0027 採用（旧ルーチン-CL 廃止 + 活動 priority='must' 移管）に伴い、旧 ③ 朝夜の習慣化カードを削除し 4 → 3 カードに再圧縮。
**#1782**: ADR-0012 §6（収集目的の独立 UI / 称号コレクション閲覧ページ / ミッションリスト UI 駆動導線 禁止）整合 + #404 廃止合意の revert 復活への対応として、旧 ① 「実績 & 称号」カードを削除し 3 → 2 カードに再圧縮。長期の達成感はチャレンジ機能 (`/admin/challenges`) のウィークリーチャレンジに統合された。
セクション wrapper に `data-testid="feature-section"` を付与し、各 tour-card にも testid で責務を明示する (#1164)。

1. **朝の準備をスムーズに** (`data-testid="feature-belongings-checklist"`, #1164): 持ち物チェックリスト（通学・習い事）
2. **冒険のクライマックス** (`data-testid="feature-rpg-battle"`): RPG バトル（#605 実装済み範囲）— daily trio (stamp card / omikuji / battle) の 3 つ目。elementary+ 全年齢共通の累積努力可視化儀式。upper 代表機能ではない (§2.1 参照)

> 用語は `CHECKLIST_KIND_LABELS` (#1168) に同期し、**同じ段落内で「持ち物チェックリスト」「やることリスト」を混在させない** こと（#1708 R3-A で旧ルーチン-CL 訴求は削除済）。
> 毎日のルーティン的訴求は `activities.priority='must'`（今日のおやくそく）に移管された。詳細は ADR-0027 / `marketplace-preset-checklist-audit.md` 参照。
> #1629 R25 で「コンボ」「ゲーミフィケーション全開」「変動比率」「射幸」「メタ層」「シールくじ」は禁止語彙とし `scripts/measure-lp-dimensions.mjs` の FORBIDDEN_TERMS で CI 検出（#1637 R34 で TARGET_HTML 配列化）。
> #1708 R3-A で旧ルーチン-CL の語彙も `FORBIDDEN_TERMS` に追加（旧ルーチン枠廃止に伴う再発防止）。

**PC 横長レイアウト** (#1618 R14 / Phase 5 P2 → #1846 PO-N-4 で 2 列中央配置に是正):

- 1024px+ で `grid-template-columns: repeat(2, 1fr)` の 2 列 + `grid-auto-rows: 1fr` で行高を揃える + `max-width: 960px; margin-inline: auto` で中央寄せ
  - 旧 `repeat(4, 1fr)` 4 列固定は PR #1812（実績削除）/ #1827（スタンプ移動）で 2 cards 化したあとの残骸として左寄り表示を引き起こしていたため #1846 で是正
- 画像有無で高さがバラつかないよう `tour-shot` / `tour-shot-placeholder` ともに `min-height: 200px`、`tour-card` は `min-height: 480px`（1024px+ では `min-height: 520px`）
- 1440px+ では `max-width: 1320px` / `gap: 24px` に拡張しゆとりを確保（2 列でも横幅を活用）
- mobile (<1024px) は `grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))` で 1〜2 列フルード（mobile 縦積み / tablet 横並び）

#### [05] ソフト機能（親の安心）— 3 カード構成（#1720 R4 で 4→3 圧縮、#1847 PO-N-5 で featured 強調完全撤去・3 cards 視覚均質化）

1. **成長の記録（月次レポート）** (`data-testid="feature-monthly-report"`): 月次レポートで活動・ポイント推移を可視化（`/admin/reports` 実装済み）
2. **家庭に寄り添う運用補助** (`data-testid="feature-auto-sleep"`): 自動スリープ + おうえんメッセージを統合した 1 カード。設定時間超過で自動スリープ（`src/lib/features/auto-sleep.ts` 実装済み, #1292）+ 必要時に親→子のおうえんメッセージ（Family プランで家族全員から送信可）
3. **設定の自由度** (`data-testid="feature-customization"`): 活動・ポイント配分・ごほうびをカスタマイズ可能
- → **意図的にゲーム要素を挟まない**。親が「これは遊びだけでは終わらない」と判断するセクション
- PC は 1 行 3 cards 並列（`grid-template-columns: repeat(3,1fr)`、max-width 1080px、#1847 PO-N-5 で `1.2fr 1fr 1fr` から完全均等幅化）。モバイルは 1 列縦積み
- 全 cards で h3 サイズ・色・soft-shot max-height が完全に同一（#1847 で `.soft-card--featured` class とその関連 CSS 4 ルールを撤去、視覚均質化）
- 旧カード「みんなのテンプレート」「親の作業は 1 日 5 分」は削除（[04] / 設定自由度カードに統合）。旧カード「おうえんメッセージ」は #1720 で「家庭に寄り添う運用補助」に統合

#### [05b] 年齢別成長ロードマップ — 卒業を最終地点として位置付ける (#1613 R9 / #1848)

##### §1. 設計背景（why）

3 歳児の親（P1）にとって「卒業」は時間軸が長すぎ（10 年以上先）、機能・特徴紹介レベルで訴求すると違和感を生む。
2026-04 マルチ Agent LP 仕上げレビューで法務 M-1 / 営業 T-6 / コンサル B-2 / PM ADR-0023 の 4 視点が同時に「卒業の自然な訴求文脈」の不在を指摘した。
PO 判断（2026-04-28）: 「卒業セクション」を独立で作るのは違和感。**プロダクトを通じた子供の成長物語として描き、その最終地点として「卒業」を自然に登場させる**ことで解決する。
ADR-0023 §3.8（卒業 = ポジティブな解約）/ ADR-0011（コアターゲット 3-18 歳）と整合し、StoryBrand 7 要素の **Success（成功した未来像）** を補完する役割を負う。

PO 判断（2026-05-02 #1848 PO-Cont-1）: LP 本体に 5 ステージを展開すると Hero〜soft-features の機能訴求 4 連発のあと急に理念セクションが来る IA 急展開で離脱誘発リスクがある（gr-shot 96px 過小・各カード本文長文 reading load）。**5 ステージ詳細を `site/graduation.html` 別ページに切り出し、LP 本体は CTA 1 行に短縮**することで、本体の最短経路化と詳細展開の両立を図る（gr-shot は別ページで 240px 以上に拡張可能）。

##### §2. 設計原則（rules）

1. **単独「卒業セクション」禁止**: 機能/特徴紹介レベルの卒業訴求は時間軸ミスマッチで違和感を生むため作らない。年齢別成長物語の最終 stage としてのみ登場させる。
2. **5 stage 構造で 15 年 + α を表現**: preschool (3-5) → elementary (6-12) → junior (13-15) → senior (16-18) → graduate（卒業）の 5 段階。最終 stage の `data-stage="graduate"` で「アプリが必要なくなる日」を Success として描く。
3. **ADR-0011 整合**: 4 コア年齢モード (preschool / elementary / junior / senior) を全て stage に登場させ、コアターゲット 3-18 歳を物語上で網羅する。0-2 歳 baby（準備モード）は LP の成長物語に含めない（baby は親の準備モードで、子供 UI ゲーミフィケーションが非適用のため）。
4. **Anti-engagement (ADR-0012) との整合**: 「使わなくなる」「卒業」をポジティブなゴールとして描く。「ずっと使い続けてもらう」訴求は禁止。滞在時間 = 価値毀損原則の延長で、ゴールから逆算した訴求文脈にする。
5. **LP truth (ADR-0013)**: 4 コアモードの UI 切替は実装済み（`src/lib/domain/validation/age-tier.ts`）。graduate stage の「データ書き出し」も実装済み（admin export）。Aspirational 機能を成長物語に書かない。
6. **メトリクス維持**: LP 本体は CTA 1 行のみとし `mobileHeight ≤ 15000`（Issue AC）/ `desktopHeight ≤ 8000`（ratchet）/ `forbiddenTerms = 0` / `ctaVariants ≤ 3` を維持する。CTA は本セクション内に追加せず、Hero / floating-cta / footer signup に集約（#1838 で旧 [09] 最終 CTA を削除）する。
7. **2 ページ構成（#1848）**: LP 本体 (`site/index.html`) は H2 + サブ + 「5 ステージの詳細を見る →」リンク 1 行のみ。5 ステージ詳細は `site/graduation.html` に集約する。両ページの SSOT は `LP_GROWTH_ROADMAP_LABELS`（`labels.ts`）→ `shared-labels.js` 経由で `data-lp-key="growthRoadmap.*"` で同期する。

##### §3. 仕様（what）

- **LP 本体配置（CTA 1 行）**: `<section id="growth-roadmap">` の中身は `growth-roadmap-cta` クラス + H2 + サブ + `<a href="graduation.html">` 1 行のみ（`site/index.html` `LP-LANDMARK:growth-roadmap-cta`）
- **詳細ページ配置**: `site/graduation.html` を新設し header / footer / CSP / shared-labels.js / auto-budoux.js を LP 共通テンプレ（`pricing.html` / `faq.html` 構成）に揃える。パンくず「ホーム → 成長ロードマップ」を Hero 直下に配置
- **gr-shot サイズ拡張（#1848 AC）**: graduation.html 内の `.gr-body .gr-shot` は `max-height:240px`（mobile）/ `max-height:320px`（desktop）。LP 本体（96px / 120px）から大幅拡張し、機能伝達不足を解消
- **navigable 担保**: graduation.html へは LP 本体 [05b] CTA リンク + 全 LP ページ footer（`graduationLink`）から到達可能
- **H2（LP 本体 + graduation.html 共通）**: 「3 歳から 18 歳まで、そして「卒業」へ」(`data-lp-key="growthRoadmap.sectionTitle"` / graduation.html では `pageHeroTitle` を併用)
- **サブ（LP 本体 + graduation.html 共通）**: 「お子さまの成長に合わせて UI と機能が変化。最後は「アプリを使わなくても自分で計画できる」自律へ。」
- **graduation.html 構造**: `.graduation-detail-inner > .gr-track > article.gr-stage[data-stage="..."]` の 5 stage 縦積み（mobile）/ 縦積み（desktop）。LP 本体の `desktop で横展開` レイアウトは別ページでは段組を圧縮しないため `gr-shot 240/320px` 拡張を許容
- **LP 本体 CTA リンク**: `.growth-roadmap-cta .growth-roadmap-link a[href="graduation.html"]` 1 行
- **5 stage 内訳（graduation.html 詳細）** (#1712 R5 で H3 を「親主語ベネフィット」にリフレーム):

| data-stage | 年齢ラベル | h2（親主語ベネフィット） | scrshot サムネ | 親が観測できること | 子供が体験すること |
|-----------|-----------|----------------------|--------------|------------------|------------------|
| `preschool` | 幼児 3-5 歳 | 「はをみがいてー」「おかたづけしてー」が要らなくなる | `growth-stage-preschool{,-desktop}.webp` | 「やって」と言わなくても、子供が自分で動き始める | 大きな絵文字ボタンを押すだけで褒められる達成感 |
| `elementary` | 小学生 6-12 歳 | 「宿題やった？」を聞かなくても、子供から見せてくれる | `growth-stage-elementary{,-desktop}.webp` | 声かけ回数が減り、子供から達成報告が来るようになる | ポイントとチャレンジが積み重なり、「次は何をやろう」と自分で計画する楽しさ |
| `junior` | 中学生 13-15 歳 | 部活と塾の両立を、子供が自分で計画する | `growth-stage-junior{,-desktop}.webp` | 時間管理を子供任せにできて、過干渉を手放せる | 月次レポートで自分のペースを見える化し、無理せず続けられる |
| `senior` | 高校生 16-18 歳 | 進路相談で「これだけやってきた」を子供自身が語れる | `growth-stage-senior{,-desktop}.webp` | 進路面談で子供自身が活動履歴を語れるようになる | 15 年分の積み重ねが履歴として残り、自分の自信になる |
| `graduate` | そして **卒業** | アプリを開かなくなった日 — それは家族の卒業式 | `growth-stage-graduate{,-desktop}.webp` | 子供が自律したことを、ログイン頻度の低下で確認できる | アプリを開かなくても自分で計画できる、大人になった実感 |

- **scrshot 配置原則 (#1707 R2)**: 各 stage に `<picture>` で `mobile` / `desktop` 両 viewport の WebP を配置（撮影元 URL は `docs/design/asset-catalog.md` 「LP スクショ」セクション参照）
- **「私たち」削除 (#1706 R1)**: graduate stage 訴求文の運営者主語「私たち」を全て削除し、「がんばりクエスト」（ブランド主語）に統一
- **ラベル管理**: 全 H2 / 訴求文 / 年齢ラベル / 親視点 / 子供視点ベネフィットは `LP_GROWTH_ROADMAP_LABELS`（labels.ts）→ `shared-labels.js` 経由で `data-lp-key="growthRoadmap.*"` で注入（並行実装チェックリストに準拠）。#1848 で追加された `linkLabel` / `pageTitle` / `pageHeroTitle` / `pageHeroLead` / `pageMetaDescription` / `breadcrumbHome` / `breadcrumbCurrent` / `ctaBottomTitle` / `ctaBottomDesc` も同チャネル
- **背景**: graduation.html では `bg-gray` 相当の `.graduation-detail` セクション（ソフト機能 [05] と同系統で「親の安心」文脈を継承）
- **CTA**: graduation.html 末尾に `.graduation-cta`（「無料で始める」 + 「ホーム」）を配置。LP 本体側 [05b] CTA リンクは `ctaVariants` カウント外（リンクテキストが「5 ステージの詳細を見る →」で signup CTA とは独立）。LP 本体の最終 CTA は #1838 で削除済（Hero / floating-cta / footer signup に集約）
- **同期対象**: `site/pamphlet.html` には現時点で本セクションを反映しない（pamphlet は evaluate モード用 / A4 印刷前提のため要約版を維持。LP 本体の成長物語は discover モード用）

#### [06] 料金プロミスバンド (#1293 で 3 カード比較から簡素化)

- **LP 内では 1 バンドのみ**: 「基本無料 ・ 有料は月 ¥500〜 ・ 7 日間無料トライアル ・ いつでも解約 OK」
- 3 カード比較表はトップから撤去し、`/pricing` に集約（evaluate モード用途にページを分離）
- 小補足: 「お子さま 2 人までは無料プランで全機能 / 3 人以上・長期履歴・AI は有料」1-2 行
- 単一 CTA: `料金の詳細を見る →`（`/pricing` への導線。`無料で始める` は末尾 CTA とヘッダーに集約）
- **配置原則 (#1293 合意)**: 下記「LP 料金情報配置の原則」を参照

##### LP 料金情報配置の原則 (B2 合意 / 2026-04-21 PO セッション)

**判断ロジック** (freemium における料金情報の配置は、実価格と顧客想像価格の大小関係で決める):

| 実価格と想像価格 | 最適な LP 配置 | 根拠・先行事例 |
|------------------|----------------|----------------|
| 実価格 > 想像価格 (高価格帯) | 価値訴求で埋めてから価格提示 (隠す) | Notion / Salesforce / 高単価 B2B SaaS |
| **実価格 < 想像価格 (低価格帯)** | **早期に数字を見せて誤認を解消する** | **がんばりクエスト (月 500 円 vs 競合 3,000 円)** |
| 実価格 ≈ 想像価格 | どちらでも誤差 | - |

**本プロダクト用 具体原則**:

- トップは「価格プロミス 1 バンド」で 4 要素を集約: 基本無料 / 月 ¥500〜 / 7 日間無料トライアル / いつでも解約
- 3 カード比較表・年額・feature 詳細は `pricing.html` に集約（evaluate モード用）
- 競合リファレンス価格帯が変わった場合（例: 値上げで実価格 > 想像価格になった場合）は本原則を再評価する
- freemium LP の訪問者は **discover モード**。比較表は evaluate モード用ツールのため、役割分離を明確化する

**この原則の対象外**:

- 料金 FAQ (`faq.html#pricing`) — 疑問解消が目的なので具体的な金額を明示する
- パンフレット `site/pamphlet.html` — 印刷版で evaluate モード用なので 3 カードを維持する

#### [07] 安心訴求（日本市場必須）

- **3 バッジ横並び**: 広告なし / 家族だけで閉じた空間 / 仕組みを全て公開
- 3 番目のバッジは `selfhost.html` へ「仕組みを詳しく知りたい方へ →」としてリンク（詳細ページは開発者向けの語彙で書く）
- LP 本文には「OSS / ソースコード / サーバー / 自前運用」を出さない（#1286、IT 非リテラシ親への伝達性を優先）。同語を記載したいページは `selfhost.html` 等の詳細ページに閉じ込める

#### [08] FAQ（#1291 で Top 3 + faq.html 導線に集約）

トップ LP は「最も多い 3 つ」に絞り、残りは専用の **FAQ ページ (`site/faq.html`)** に 5 カテゴリ × 計 24 項目で集約する（#1291 B1-LP-3）:

トップ LP に残す 3 件（トライアル障壁を下げる最小セット）:

1. 無料トライアルにクレジットカードは必要ですか？
2. 子供が勝手に課金してしまう心配はありませんか？（#1289 懸念 7 への応答）
3. サービスが終了したらデータはどうなりますか？（#1289 懸念 8 への応答）

FAQ 専用ページ (`/faq`) のカテゴリ構成:

| カテゴリ | 件数 | #1289 応答懸念 |
|---------|------|---------------|
| 1. トライアル・解約 | 5 | - |
| 2. 料金・課金 | 6 | 2 / 4 / 7 |
| 3. プライバシー・データ | 5 | 6 / 8 |
| 4. 対応年齢・使い方 | 5 | 1 / 3 / 5 |
| 5. 技術的なご質問 | 3 | - |

方針:
- トップ LP の FAQ は **3 問 + 「専用ページへ」** で CTA への集中を優先
- `pricing.html` の料金 FAQ（9 問）は **決済直前の障壁除去** という役割で温存（faq.html とは独立）
- `pricing.html` フッターと `index.html` フッターに `faq.html` への導線を追加
- Playwright smoke: `tests/e2e/lp-faq-page.spec.ts` で 5 カテゴリ描画 / Q&A 20 件以上 / details 展開 / 導線存在を保証

#### [08b] founder 直接相談 — #1713 R7 / ADR-0028 で削除

> **削除理由 (2026-04-30)**: PO 直判定により本セクションは LP から削除された。
>
> - 「Pre-PMF」内部用語を LP に出すのは ADR-0013 LP truth 違反
> - 営業観点で最終 CTA を 1 つに絞れず、旧 founder セクションの 2 つ + footer mailto + 最終 CTA「無料で始める」が並列することで導線が散漫化
> - PO の対応キャパ（個人開発）が初期 ~10 親契約規模を超えており、LP に founder 直対応動線を出すと処理しきれない
> - lp-content-map.md §4.4 LP コンテンツ追加 gate の 4 項目（顧客語彙 / 実装の事実 / 顧客価値の実証 / Anti-engagement 適合）すべて不通過
>
> ADR-0023 §I8 は ADR-0028 で supersede された。連絡導線は **footer の `mailto:` リンク** (`LP_FOOTER_LABELS.contactLink`) に集約。
> `/inquiry/founder` ルート自体は admin / footer mailto 経由で残置（form を必要とする保護者向けに保持、ただし LP 導線からは外す）。

#### [09] 最終 CTA — #1838 で削除（選択肢 A 採用）

- **削除日**: 2026-05-02（PR for Issue #1838）
- **削除理由**:
  - hero CTA / floating-cta と訴求が重複し、最終 CTA としての価値が分散（PO 直接判断 2026-05-02: 「あえて削除するセクションを考えるなら、一番最後のセクションである "無料で始める" を改めて表示しているセクションを削るべき」）
  - PR #1836 で desktopHeight ratchet 圧縮のため `.cta-bottom` padding を 28/36 にまで縮小していたが、本質的な訴求重複は CSS 圧縮では解消できなかった
- **#1797 で導入した Success 像の再配置（Plan/Success 役割分離の更新）**:
  - 旧 indexB.k79「アプリを開かなくなった日」が家族の最大の成功です — **hero 主訴求 + growth-roadmap [05b] graduate ステージ**に内在化
  - 旧 indexB.k80 3 歳から 18 歳までの 15 年。最後は子供が自分で計画できる自律へ — growth-roadmap [05b] が 5 stage で同じ Success 像を時系列に提示するため重複
  - 旧 k81 signup ボタン — hero CTA + floating-cta + footer signup link で常時アクセス可能
  - 旧 k82 mailto 注記 — footer の `id="contact-footer"` mailto に集約済（#1801 で先行実施）
  - 旧 cancelDisclaimerCta — `pricing.html` / `pamphlet.html` 等の他箇所 disclaimer は `cancelDisclaimer` + `cancelDisclaimerLinks` を使用するため LP index.html では不要
- **削除した実体**:
  - `site/index.html`: `<section class="cta-bottom">` 全体（h2 / p / signup CTA / mailto note / cancel disclaimer）+ `.cta-bottom*` CSS 4 セレクタ
  - `src/lib/domain/labels.ts`: `LP_INDEX_PHASEB_LABELS.k79/k80/k81/k82` + `LP_LEGAL_DISCLAIMER_LABELS.cancelDisclaimerCta` + `cancelDisclaimerCtaLink`
  - `site/shared-labels.js`: `npm run generate:lp-labels` で再生成
  - `site/js/auto-budoux.js`: `.cta-bottom p` セレクタ
- **最終 CTA の機能をどこに残したか**:
  - 新規登録の入口: hero CTA `無料で始める` (PC 常時) / mobile floating-cta (スクロール追従) / footer signup link
  - 解約・データ削除の disclaimer: `pricing.html` の hero-price-band 直下「いつでも解約 OK」打消し表示（#1609 R5、cancelDisclaimer + cancelDisclaimerLinks 経由）+ `faq.html` カテゴリ 2「料金・課金」
  - 連絡導線: footer の mailto (`#contact-footer`)（#1801 で集約済）

### 4.3 保護者懸念 8 項目への LP 応答マップ（#1289）

保護者（課金決裁者）が抱える 8 つの懸念と、LP 上のどこで・どの媒体で応答するかのマトリクス。

| # | 懸念 | 応答セクション | 媒体 | 優先度 | 実装状態 |
|---|------|--------------|------|--------|---------|
| 1 | スクリーンタイムへの不安 | `#trust`「保護者専用のカギ付き」 | テキスト (おやカギコード説明) | High | ✅ #1289 で追加 |
| 2 | 無料→有料の切替で何が変わるか | `#pricing` 料金プロミスバンド + `pricing.html` 比較表 | テキスト + 差分表 | High | ✅ 既存 (#1293) |
| 3 | 運用負荷（毎日設定が必要？） | `#soft-features`「親の作業は 1 日 5 分」 | テキスト | High | ✅ #1289 で追加 |
| 4 | 兄弟姉妹の不公平 | `faq.html` カテゴリ 2「料金・課金」 | FAQ テキスト | Medium | ✅ 既存 (#1291) |
| 5 | 年齢が変わった時の移行 | `#age-switcher` + `faq.html` カテゴリ 4「対応年齢・使い方」 | タブ UI + FAQ | Medium | ✅ 既存 |
| 6 | 撤退コスト（データ持ち出し） | `faq.html` カテゴリ 3「プライバシー・データ」 | FAQ テキスト | Medium | ✅ 既存 (#1291) |
| 7 | 無断課金（子供が勝手に課金） | `#faq` トップ 3 件目 + `faq.html` カテゴリ 2 | FAQ テキスト | High | ✅ 既存 (#1291) |
| 8 | サービス終了時のデータ処理 | `#faq` トップ 3 件目 + `faq.html` カテゴリ 3 + `#trust`「仕組みを全て公開」 | テキスト + FAQ | Medium | ✅ 既存 (#1286 #1291) |

**備考**:
- 懸念 1 (スクリーンタイム): 自動スリープ機能 (#1292) 実装後に GIF/動画で補強予定。現時点は おやカギコードによる管理画面ロックで応答
- 懸念 3 (運用負荷): GIF/動画（「親が毎朝 30 秒で何をするか」フロー）は #1292 実装後に追加予定

### 4.4 LP コンテンツ追加時の顧客価値 gate (ADR-0010 Pre-PMF、#1282)

新規セクション / 数値 / ロゴを LP に追加する前に、以下をすべて満たすか確認する。1 つでも「No」があれば、該当コンテンツは PMF 到達まで追加しない。

- [ ] この情報は「見込み顧客の不安を減らす」「課題への解像度を上げる」「サインアップ動機を強める」のどれかに直接つながるか？
- [ ] 数値を載せる場合、その数値は顧客にとって意味のある社会的証明か？ （β / 0-18歳 / 36要素 / OSS のような「自己言及的メタデータ」ではないか）
- [ ] 載せられない理由（Pre-PMF だから）がある情報を「言い訳付きで」載せていないか？
- [ ] 代替として、プロダクトの使い方・使い心地が伝わるスクリーンショット・デモ動画を増やす方が効果的ではないか？

上記 gate を通らない「社会的証明もどき」のセクションは PMF 到達まで追加しない。過去事例: 旧 [06] 社会的証明 (#1282 で削除) — `β / 0-18 / 36+ / OSS` の 4 数値は「使われていないサービス」を逆に強調していた。

`.github/PULL_REQUEST_TEMPLATE.md` の LP 変更チェックリストに「LP セクション追加の場合、本 gate を通過したことを確認した」チェック行が設けられており、PR レビュー時にここを必ず参照する。

### 4.5 装飾アイコン総量管理ポリシー（#1723 R10）

LP `site/index.html` の装飾アイコン（絵文字）は **15 件以下** を維持する。これは scrshot とコピーへの集中を阻害しない上限値で、Anti-engagement 原則 (ADR-0012) の視覚ノイズ削減と整合する。

#### アイコンの 4 種判定（PR で新規絵文字追加時のセルフチェック）

| 判定 | 用例 | 残してよいか |
|------|------|-------------|
| **(i) 機能アイコン** | hamburger `☰` / lightbox close `✕` | 機能の代替テキストが無く UI 必須なら **保持** |
| **(ii) ステータス装飾** | hero trust badges (旧 `💳` クレカ不要 / `🚫` 広告なし / `🔄` いつでも解約) | **SVG 化済 (#1824)**: OS 依存解消のため `cta-trust-credit-card.svg` / `cta-trust-ad-free.svg` / `cta-trust-cancel-anytime.svg` に置換。`#trust` セクション 4 個も SVG 化済 (#1796、`docs/design/asset-catalog.md` §「trust-* SVG 一覧」) |
| **(iii) 役割識別** | core-loop `🧑‍💻` 親の視点 / `🧒` 子供の視点 | **保持**: 短時間で役割を識別する目的に限る（数を増やさない） |
| **(iv) 装飾過多** | machine-tour 各カード `🏆` `🎒` `⚔️` / soft-features `📊` `💤` `⚙️` / core-loop STEP `📝` `📊` `🎴` `📇` `💰` `🎁` / versus row `📊` `🌱` `🎓` `📍` | **削除**: 直下に scrshot がある / 機能を語れる / 装飾枠の絵文字は scrshot とコピーの集中を阻害する |

#### 削除済（#1723 R10 / 28 件 → 12 件）

- `versus.row1Icon` `row2Icon` `row3Icon` `row4Icon`（labels.ts + site/index.html + shared-labels.js）
- machine-tour `tour-emoji` 3 件（site/index.html）
- soft-features `soft-icon` 3 件（site/index.html）
- core-loop `cls-icon` 6 件（site/index.html）
- 関連 CSS（`.vc-icon` / `.tour-emoji` / `.soft-icon` / `.cls-icon`）も削除

#### 保持されたもの（5 件、#1796 で trust 4 badges、#1824 で hero trust badges 3 件を SVG 化したため 12 → 8 → 5 に）

hamburger `☰` (1) + 準備モード注釈 `👶` (1) + 親子視点 `🧑‍💻` `🧒` (2) + lightbox close `✕` (1) = 計 5 件

`#trust` 4 badges (`🚫` `👪` `🔑` `🔍`) は OS 依存 (iOS Safari と Android Chrome で見た目が大きく異なる) を解消するため SVG (`site/assets/ui/trust-*.svg`) に置換済（#1796 R-MAJ-6、`docs/DESIGN.md` §7「OS/ブラウザ間で見た目が変わると困る要素」整合）

hero CTA 直下の `cta-trust-badges` 3 件 (旧 `💳` `🚫` `🔄`) も同方針で `site/assets/ui/cta-trust-{credit-card,ad-free,cancel-anytime}.svg` に置換済（#1824、site/index.html / faq.html / pricing.html の 3 ファイル同期）

#### 新規セクション追加時のセルフチェック

- [ ] アイコンが (i)〜(iii) のどれに該当するか（(iv) 装飾過多なら削除）
- [ ] 直下に scrshot を配置するなら、機能を示すアイコンは scrshot で語れるため不要
- [ ] アイコン総量が 15 件以下を維持できるか（既存 12 件 + 追加分）
- [ ] アプリ実装に存在しない機能を示すアイコンは ADR-0013 違反のため不可

---

## 5. ペルソナ別動線

> **#1838 注**: 旧導線終端の `[09] CTA` は cta-bottom セクション削除に伴い `hero CTA / floating-cta / footer signup` に置換した（実体は同じ `/auth/signup`、行き先は不変）。動線図中の `[09] CTA` 表記は履歴として残置するが、実際の最終接点は hero / floating / footer のいずれか。

### 5.1 P1: 3 歳児の親

```
[01] ヒーロー → [02] 年齢タブで「乳幼児」 →
[03] コアループで「シール＝手書きシール帳の代替」 →
[05] ソフト機能で「親が褒める UI」を確認 →
[06] Free プラン確認 → hero / floating / footer signup
```

### 5.2 P2: 小学生の親

```
[01] ヒーロー → [02]「小学生」タブ →
[04]-① 持ち物チェックリストで「朝の準備」効果を確認 →
[05] おうえんメッセージで「親が褒める UI」に安心 →
[06] Standard ¥500 → [08] FAQ でデータ利用確認 → hero / floating / footer signup
```

### 5.3 P3: 中学生本人

```
[01] ヒーロー → [02]「小学生以降 (primary-plus)」パネル →
[03] コアループ + [04] 5 幕の全体体験 → [06] 料金確認 →
「親に見せる」導線（URL 共有）→ 親再訪問で CV
```

※ RPG バトル単独での中高生訴求は撤回 (#1320 §2.1)。5 幕全体の累積努力可視化体験で引く。

### 5.4 P4: 高校生本人/保護者

```
[01] → [02]「小学生以降 (primary-plus)」パネル → [04]-② RPG バトル →
[05] おうえんメッセージ → [06] → hero / floating / footer signup
```

※ upper 固有機能は現時点で不在 (§2.1)。キャリア・パスポート家庭版 (#1324) 実装まで primary-plus 統合で扱う。

### 5.5 P5: 祖父母・おじおば

```
[01] → [06] Family プラン比較 (「家族 6 人まで」を発見) →
hero / floating / footer signup
```

---

## 6. ゲーミフィケーション要素の訴求配置

**設計原則**: 「即効 → 毎日 → 長期 → 忘れ物ゼロ → 冒険」の 5 幕構成 (#1164)。1 メタファ一点突破 (Finch) と価値階段化 (BusyKid) を組合せ。

| 要素 | 配置 | 役割 |
|---|---|---|
| 活動 → ポイント (L1 アクション層) | [03] コアループ | 活動記録の動機付け基盤。2 タップで記録 |
| おみくじスタンプ → スタンプカード (L2 メタ習慣層) | [03] コアループ | 日 1 回 cap の習慣形成エンジン。射幸性なし (#1311 / ADR-0012) |
| ポイント → ごほうびショップ交換 (L3 経済層) | [03] コアループ | 唯一の出口。実物・お小遣い・特権と交換 (#1343) |
| 持ち物チェックリスト (#1164) | [04]-① 朝の準備をスムーズに | 通学・習い事の独立訴求 |
| 活動 must 属性 (今日のおやくそく) | アプリ内（LP 単独セクションなし、coreloop 内） | `activities.priority='must'` で旧ルーチン-CL の役割を吸収（#1708 R3-A / ADR-0027） |
| RPG バトル (#605) | [04]-② 冒険のクライマックス | daily trio 3 つ目・elementary+ 全年齢共通の累積努力可視化 (§2.1) |
| ウィークリーチャレンジ (`/admin/challenges`) | LP 単独セクションなし（admin 側機能） | `#1782` で「実績 & 称号」LP 訴求の後継。長期の達成感はチャレンジ機能に統合 (ADR-0012 §6 整合) |
| 活動パック | [05] ソフト機能 | 親向けオンボ |
| おうえんメッセージ | [05] ソフト機能 | 親 → 子 コミュニケーション |
| イベント/シーズンパス | LP 未掲載 (Phase 2) | #1159 Phase 2 以降 |
| きょうだい協力 | LP 未掲載 (Phase 2) | 同上 |
| 誕生日演出 | LP 未掲載 (Phase 2) | 同上 |
| がんばり証明書 | LP 未掲載 (Phase 2) | 同上 |

---

## 7. CTA 統一方針

### 7.1 許可されるボタン文言（2 種のみ）

| 分類 | 文言 | 遷移先 | 登場箇所 |
|---|---|---|---|
| プライマリ | **無料で始める** | `/auth/signup` | [01] ヒーロー / mobile floating-cta / footer signup link（#1838 で旧 [09] 最終 CTA は削除） |
| セカンダリ | **デモを見る** | `/demo` | [01] ヒーロー / [02] 年齢スイッチャー / [04] 機構ツアー |

### 7.2 NAV / CTA 一覧（#1285 ghost button 復帰 / #1290 ヘッダー常時 signup CTA）

ヘッダー NAV 内の `ログイン` は `nav-login` class の ghost button で統一する。2026-04-21 の HP 再レビューで、全 nav が text link のみだと既存ユーザーの自分のマイページへの復帰導線として弱く迷子が発生することが判明したため、`.btn` （primary / demo）とは別階層の ghost variant として復帰させる（#1285 / 旧 §7.2 `ボタン化しない` ルールを supersede）。

加えて 2026-04-21 の同レビューで「スクロール後に CTA が消えて新規登録まで遠い」問題が顕在化したため、ヘッダー右端に `btn btn-primary` の **無料で始める** を常時表示する（#1290、B1-LP-2、MoneyForward / ClassDojo 等で確立されたパターン）。モバイル (<768px) は `floating-cta` と二重表示になるため `.nav-signup` は非表示にし、`floating-cta` に新規登録導線を集約する。

| 種類 | 文言 | class | 視覚的重み | 登場箇所 |
|---|---|---|---|---|
| プライマリ CTA | 無料で始める | `btn btn-primary` | 最強 | ヒーロー / **ヘッダー NAV（PC 常時）** / mobile floating-cta / footer signup link（#1838 で旧 [09] 最終 CTA は削除） |
| セカンダリ CTA | デモを見る | `btn btn-demo` | 強 | ヒーロー / 機構ツアー等 |
| ログイン (NAV) | ログイン | `nav-login`（ghost button） | 中（outline のみ） | ヘッダー NAV 右端 |
| NAV テキスト | ホーム / 料金プラン / テンプレートを探す 等 | `nav-text` / 無指定 | 弱 | ヘッダー NAV |

禁止事項:

- 上表以外の CTA バリエーション（「今すぐ始める」「アカウント登録」「試してみる」「体験する」「Sign up」等）— 併存させない
- 絵文字付き / 絵文字無しの同一文言併存（例: `🎮 デモで体験する` と `デモで体験する`）
- `ログイン` を `btn-primary` として装飾しない（primary CTA はサインアップ = 新規獲得専用。ログインは既存ユーザー復帰のみで役割が違う）
- モバイルで `nav-signup` と `floating-cta` を同時表示しない（#1290、`.nav-signup` は ≤768px で `display:none`）
- ヘッダー常時 signup CTA は `btn-primary` + **`無料で始める`** 固定（`ctaVariants` 閾値 3 を維持するため新たな文言バリエーションを追加しない）

### 7.3 floating-cta 深度別文言（#1732）

モバイル下部に追従する `#floating-cta` 要素は、Hero CTA と同じ文言「無料で始める」を単純コピーしたまま下スクロールに追従していたため、ページ深度に応じた読者心理（「もう少し情報が欲しい」「もう決めた」）に合った訴求が機能していなかった。`#1732` で深度別文言切替を導入した。

#### 7.3.1 phase 仕様

| phase | scroll percent (= scrollY / (docH - winH)) | 補強コピー | CTA 文言 | 遷移先 | 心理的ねらい |
|-------|--------------------------------------------|------------|----------|--------|-------------|
| (hidden) | scrollY ≤ 500px | — | — | — | hero 領域に既存 CTA があるため非表示 |
| **hero** | 0% 〜 30% | `LP_FLOATING_CTA_LABELS.heroText` 「全機能を家族で試せる（7 日間無料）<small>クレジットカード不要</small>」 | `無料で始める` | `/auth/signup` | 「即決派」のための初期訴求 |
| **mid** | 30% 〜 70% | `LP_FLOATING_CTA_LABELS.midText` 「コアループは 1 分で体験できます<small>サインアップ前に動きを確認</small>」 | `デモを見る` | `/demo` | 「もう少し見たい派」へのデモ誘導 |
| **bottom** | 70% 〜 (footer 手前 200px まで) | `LP_FLOATING_CTA_LABELS.bottomText` 「ここまで読まれた方へ<small>7 日間無料・クレジットカード不要</small>」 | `無料で始める` | `/auth/signup` | 「最後まで読み切った派」への背中押し |

切替閾値・文言は `LP_FLOATING_CTA_LABELS`（`src/lib/domain/labels.ts`）→ `site/shared-labels.js` の `GANBARI_LABELS.lp.floatingCta` 経由で `data-lp-key="floatingCta.*"` で注入される。HTML / CSS / JS は文言を直書きしない（ADR-0009 SSOT）。

#### 7.3.2 ctaVariants ratchet との関係

floating-cta は **単一機能ユニット** として扱い、深度切替で同一要素の文言が可変するため `scripts/measure-lp-dimensions.mjs` の `extractCtaVariants` 集計から **除外**する（`closest('[data-floating-cta]')` でフィルタ）。これにより:

- floating-cta 内の補強コピー / CTA 文言を 3 段階で動的に変えても `ctaVariants ≤ 3` ratchet は維持される
- 既存の許可 CTA 3 種（`無料で始める` / `デモを見る` / `ログイン`）はそのまま閾値計算対象として維持

floating-cta の CTA ボタン文言は、ratchet とは独立に **既存 CTA 3 種の組合せ内**（`無料で始める`x2 + `デモを見る`x1）に揃える。新たな文言（「今すぐ始める」「Sign up」等）を floating-cta にだけ追加することは禁止 — 全体の CTA 一貫性が崩れるため。

#### 7.3.3 Anti-engagement 整合（ADR-0012）

- 文言は「煽る」表現を避け、状況提示型 / 軽い再訴求 にとどめる（「今すぐ」「あと N 人」「タイムセール」「期間限定」は使用しない）
- 切替は CSS `transition: opacity .2s ease` で穏やかにフェード。pulse / shake / 連続色変化等のアテンション奪取演出は使わない
- 1 つの phase では文言は固定。スクロール往復のたびに文言がチカチカ変わる動作は許容しない（実装は data-floating-cta-phase 属性が変化したときのみ書き換え）

#### 7.3.4 LP truth 整合（ADR-0013）

- `mid` phase の「コアループは 1 分で体験できます」は `/demo` 画面が実装済みで現に体験可能（committed）であるため記載を許容
- `bottom` phase の「7 日間無料」は trial 仕様 (#779 ファミリー / standard 加入) と整合する committed 機能

#### 7.3.5 並行実装ペア

- `src/lib/domain/labels.ts` `LP_FLOATING_CTA_LABELS` ←→ `site/shared-labels.js` `GANBARI_LABELS.lp.floatingCta`
- 文言を変更するときは labels.ts を編集し `node scripts/generate-lp-labels.mjs` で再生成

### 7.4 CTA 以外のリンク

| 種類 | 配置 | スタイル |
|---|---|---|
| GitHub | footer | テキストリンク |
| Sponsor | footer | テキストリンク |
| お問い合わせ (mailto) | footer or [06] 社会的証明後 | テキストリンク |
| セルフホスト | footer | テキストリンク |

---

## 8. 計測と品質ゲート

### 8.1 自動計測スクリプト

- **スクリプト**: `scripts/measure-lp-dimensions.mjs`
- **実行**: `node scripts/measure-lp-dimensions.mjs`
- **出力**: `lp-metrics.json` + stdout JSON

### 8.2 閾値 (CI で assert)

| 指標 | 閾値 | 根拠 |
|---|---|---|
| mobileHeight | ≤ 15000 px | 競合平均 (Greenlight 11500, みてね 13000) |
| desktopHeight | ≤ 8000 px | 競合平均 (Todoist 9000, Notion 8000) |
| forbiddenTerms | 全 0 | 開発者向け語彙を LP に残さない |
| ctaVariants | ≤ 3 | Todoist / ClassDojo と同等 |

禁止用語: `git clone`, `docker compose`, `SaaS版`, `セルフホスト版`, `TLS`, `AES-256`, `AWS`, `マーケットプレイス`, `マケプレ`, `OSS`, `ソースコード`, `サーバー`, `自前運用`

**語彙ポリシー（#1286）**: `OSS` / `ソースコード` / `サーバー` / `自前運用` は「運営の不安を減らす安心訴求」のために LP 本体で直接書かないこと。代わりに「仕組みを全て公開」「運営が止まっても続けられる準備」のような非 IT 親にも伝わる日本語で置き換え、開発者向け語彙は `selfhost.html` 等の詳細ページに閉じ込める。`scripts/measure-lp-dimensions.mjs` が `site/index.html` (TARGET_HTML) をスキャンし、カウント 1 以上で CI を fail させる。

### 8.3 Ratchet ルール

- **閾値は下げることは許可、上げることは禁止**（累積劣化防止）
- 閾値を緩める変更は ADR として合意を得る

### 8.4 CI ワークフロー

- **ファイル**: `.github/workflows/lp-metrics.yml`
- **トリガ**: `site/**` の変更を含む PR、main への push
- **fail 条件**: 上記閾値違反
- **artifact**: `lp-metrics.json` / `lp-metrics-cumulative.json` を保存し、PR で手動確認可能に

#### 8.4.1 累積 desktopHeight gate (#1840 — pre-merge cumulative simulation)

`cumulative-lp-metrics` ジョブが `lp-metrics.yml` 内で並列起動し、PR HEAD に `origin/main` を `git merge --no-commit --no-ff` で取り込んだ状態で `scripts/measure-lp-dimensions.mjs` を再実行する。これにより「PR を merge した後の main の状態」を擬似計測でき、複数 PR 連続 merge による累積 ratchet 接触を pre-merge 段階で検出する。

| 状態 | 閾値 | ジョブ動作 |
|------|------|-----------|
| ok | 累積 desktopHeight < 7800 | Job Summary に OK 記録 |
| warn | 7800 ≦ 累積 desktopHeight ≦ 8000 | Job Summary に warning + `lp-metrics-cumulative.json` の `warnings[]` に列挙（fail させない） |
| fail | 累積 desktopHeight > 8000 | measure script が exit 1（ジョブは Phase 1 では `continue-on-error: true` のため hard fail にはしない） |

##### 段階運用 (#1840)

- **Phase 1**: warn-only（observation 期間 2-4 週間） — 本 Issue で導入。累積 fail 時も PR ブロックしない
- **Phase 2**: required 化判断 — 別 Issue + ADR で議論（merge queue の意味論変更を伴うため）
- **Phase 3**: pricing.html / pamphlet.html へ波及 — 別 Issue

##### conflict 時

PR HEAD と `origin/main` の merge で conflict が発生した場合、累積 gate の判定は skip し `::warning::` で「PR 側で main rebase が必要」と通知する（conflict 自体の解消は本 gate の責務外）。

##### warning 閾値の上書き

`scripts/measure-lp-dimensions.mjs --warn-threshold=NNNN` で実行時に warning 帯を変更できる。常設変更は `THRESHOLDS.desktopHeightWarn` を編集（ADR は不要、ratchet 強化方向のため）。

### 8.5 E2E テスト

- **ファイル**: `tests/e2e/lp-first-view.spec.ts`
- **assert 項目**:
  - ヒーローのサインアップ CTA が初回 viewport (Mobile 375×812) 内に存在
  - 料金カードがドキュメント高さの 75% 以内に存在（footer 直前 = 見落とされない。#1838 で旧 [09] 最終 CTA を削除したため、新 assertion は「料金カードが footer より前に存在」を意味する）
  - ログインは NAV 内に `.nav-login` ghost button として描画され、`.btn-primary`（プライマリ CTA）とは区別される (§7.2、#1285)

### 8.6 hero spec-badges 数値の CI 裏取り（#1803）

LP `site/index.html` の hero spec-badges に書く数値表現（例: `<strong>300+</strong> プリセット活動`）は、実装の事実（marketplace data の合計件数）と CI で突合する。ADR-0013 LP truth 違反の予防。

| 訴求文言 | 実装 SSOT | gate |
|---------|----------|------|
| `<strong>300+</strong> プリセット活動` (`heroSpecBadges.presetCount`) | `src/lib/data/marketplace/activity-packs/*.json` の `payload.activities` 合計 | `scripts/measure-lp-dimensions.mjs` 内 `THRESHOLDS.presetActivityCountClaimedMin = 300` + `presetCheck` |

#### 検出ロジック

- `site/index.html` 内の `<strong>NNN+</strong> プリセット活動` パターンと、`site/shared-labels.js` 内の `NNN+ のテンプレート` パターンから claim 値を抽出
- 12 個の activity-pack JSON の `payload.activities` 件数を合算した実数と比較
- `actualCount < claimed` → fail（LP 訴求が実装に裏付けされていない）
- `actualCount < 300`（明示的訴求がない場合の最低水準）→ fail

#### 訴求値の更新手順

LP の数値訴求（300+ → 400+ 等）を上げたい場合:

1. activity-pack JSON を増補して実 activity 数を新訴求値以上にする
2. `site/index.html` / `site/shared-labels.js` / `src/lib/domain/labels.ts` の数値表現を変更
3. `node scripts/measure-lp-dimensions.mjs` で gate pass を確認
4. PR 本文の「LP / 販促文言変更時の実装パス明示」表に commit 区分を記入

---

## 8.7 LP 削除/圧縮 PR 必須チェックリスト（#1790）

LP の **要素削除 / 圧縮** は「追加」より検出されにくく、過去に IA 破綻 / scrshot 漏れ / レイアウトずれの残骸（orphan reference）を発生させた（PO-A-5 / M-MAJ-6）。本節は構造的再発防止の SSOT。

### 8.7.1 削除/圧縮 PR で必ず通過する 5 項目

| # | チェック項目 | 検証手段 |
|---|------------|---------|
| 1 | LP HTML から削除した要素の SSOT 参照削除 | `npm run check:lp-residue` (orphan `data-lp-key` 検出) |
| 2 | 画像ファイル参照の物理存在確認 | 同上 (broken image ref 検出) |
| 3 | レイアウトずれの fullpage scrshot 検証 | `npm run screenshots:lp:compare` (Before/After 差分) |
| 4 | IA 構造（lp-content-map）の同期更新 | 本ドキュメント §4 / §10 変更履歴を本 PR で更新 |
| 5 | CI `LP Metrics / Check LP removal residue` pass | `.github/workflows/lp-metrics.yml` の `removal-residue` ジョブ |

### 8.7.2 検出スクリプト `scripts/check-lp-removal-residue.mjs`

#### 検出対象

1. **orphan `data-lp-key`** — `site/*.html` / `site/help/*.html` の `data-lp-key="namespace.key"` 参照のうち、`site/shared-labels.js` の `LP_LABELS` に定義が存在しないもの
2. **broken image ref** — `<img src>` / `<source srcset>` / `<meta property="og:image">` / `<link rel="icon">` の相対パス画像が `site/` に物理存在しないもの（例外: `site/screenshots/*.webp` は CI 生成のため warn 扱い）

#### baseline ratchet

- 既存 violation は `scripts/lp-removal-residue-baseline.json` に保存
- 新規 1 件でも追加されれば CI を fail させる（bypass フラグなし）
- baseline を意図的に増やす変更は ADR で議論したうえで `npm run check:lp-residue:update-baseline` を実行

#### 使い方

```bash
# 検査 (CI 等価)
npm run check:lp-residue

# JSON 出力 (artefact 用)
node scripts/check-lp-removal-residue.mjs --json

# baseline 更新 (orphan を意図的に解消した後)
npm run check:lp-residue:update-baseline
```

### 8.7.3 PR template との連携

`.github/pull_request_template.md` §「LP 削除/圧縮 PR 必須チェックリスト（#1790）」で同 5 項目を Ready 化前のセルフチェック対象に組み込み済み。

---

## 9. 設計書同期チェックリスト

LP を変更する PR では以下を同時に更新する（並行実装チェックリスト #1168 の CLAUDE.md と同型）:

- [ ] `site/index.html` (本体)
- [ ] `site/shared-labels.js` (ラベル同期、`scripts/generate-lp-labels.mjs --check` で検証)
- [ ] `site/pamphlet.html` (LP 要約版、重大変更時のみ)
- [ ] 本ドキュメント (`docs/design/lp-content-map.md`) の該当セクション
- [ ] `scripts/measure-lp-dimensions.mjs` の計測閾値が破られた場合は本ドキュメント §8 を先に議論
- [ ] `tests/e2e/lp-first-view.spec.ts` の期待値（セクション追加/削除時）

### 9.1 LP スクリーンショット更新フロー (#1157 / #1184 / #1283)

`site/screenshots/*.webp` は **git 管理外** (`.gitignore`) で、`main` への push 時に CI が自動生成する。
運用の SSOT は [`docs/design/lp-deploy-pipeline.md`](lp-deploy-pipeline.md) を参照。

| 実行元 | スクリプト | コマンド | 用途 |
|--------|-----------|---------|------|
| CI (`pages.yml`) | `capture-hp-screenshots.mjs` | (workflow で自動実行) | LP 本番用。main push で GitHub Pages に反映 |
| ローカル (本番用生成) | `capture-hp-screenshots.mjs` | `npm run screenshots:lp` | LP 本番と同じ画像をローカル生成 (preview 起動要) |
| ローカル (デグレ検知) | `take-lp-screenshots.mjs` | `npm run screenshots:lp:compare` | staging に撮影 → 既存と比較 → `--promote` で反映 |

**撮影スクリプトの前提**:

- `npm run dev` は `/auth/login` を 302 redirect するため使用不可 (#1026)。ローカル実行時は `npm run build && AWS_LICENSE_SECRET=local-dummy npm run preview -- --port 5173` で preview を起動してから撮影する
- 両スクリプトとも `scripts/lib/screenshot-helpers.mjs` の `withScreenshotParam()` で `?screenshot=1` を付与し、デモバナー等のオーバーレイを抑制する (#1181 の band-aid を #1180 で恒久化)
- CI が撮影する画像数が 20 枚未満の場合、`pages.yml` は fail する（ADR-0006 準拠、無言で古い画像を残さない）

---

## 10. 変更履歴

> **#1736 m-MIN-10**: 過去変更が「想定通りだったか」を後から評価できるよう **retro 評価列** を追加。新規行は最初空欄のまま記録し、後日（次の Phase 仕上げ時等）に「想定通り / 部分達成 / 期待外れ」を記入する運用。

| 日付 | 変更内容 | Issue | retro 評価 |
|---|---|---|---|
| 2026-04-18 | 初版作成。10 セクション IA + 競合調査根拠 | #1163 (#1158/#1159 を吸収) | 想定通り |
| 2026-04-21 | 旧 [06] 社会的証明セクションを削除し 9 セクション構成に再編。§4.3 に LP コンテンツ追加時の顧客価値 gate を追加。 | #1282 (umbrella #1262 派生 A1) |
| 2026-04-21 | §9.1 に LP スクリーンショット更新フローを追加（`lp-deploy-pipeline.md` への cross-ref + `screenshots:lp` / `screenshots:lp:compare` npm script の役割明示）。 | #1283 (umbrella #1262 派生 A3) |
| 2026-04-21 | §2.1「年齢差別化軸ポリシー」新設。§4.2 [02] 年齢スイッチャーを 5 タブ → 2 パネル (kinder / primary-plus) に改訂。§5.3/5.4 で RPG バトル単独の中高生訴求を撤回、§6 表の「中高生訴求軸」記述を「daily trio 3 つ目」に改訂。ADR-0011 (baby 排除) / ADR-0013 (LP truth) と整合。 | #1321 (umbrella #1320 派生 B4+5-DOC) |
| 2026-04-21 | §7.2 の「ログインは ボタン化しない」ルールを supersede。ヘッダー右上の `ログイン` を `nav-login` ghost button として復帰（shared.css に追加 / index.html + selfhost.html に適用）。既存ユーザーの自分のマイページ復帰導線の明示化。 | #1285 (umbrella #1262 派生 A5) |
| 2026-04-21 | [07] 安心訴求の 3 バッジを「広告なし / 家族だけで閉じた空間 / 仕組みを全て公開」に平易化。`OSS / ソースコード / サーバー / 自前運用` を §8.2 forbiddenTerms に追加（CI enforced）。 | #1286 (umbrella #1262 派生 A6) |
| 2026-04-21 | [04] タイトルを「5 幕のしかけ」→「朝から夜まで、飽きさせない 5 つの工夫」に平易化。[04]-③ のシステム名は旧ルーチン-CL から「朝夜の習慣」表現を優先化。[09] H2 を「家族で全部使ってから、続けるか決める」に刷新し期間主語を脱した。`pricing.html` / `pamphlet.html` の機能一覧も同期。 | #1288 (umbrella #1262 派生 A8) |
| 2026-04-30 | #1708 R3-A: [04] machine-tour を 4 → 3 カードに圧縮（旧 ③ ルーチン-CL カード削除、旧ルーチン枠廃止 + 活動 priority='must' 移管）。#1710 R3-C: 「持ち物／旧朝夜習慣」統合表現を「持ち物チェックリスト」に純化。#1711 R3-D: 設計書 retroactive 同期。#1713 R7: [08b] founder 直接相談セクション削除。 | #1708 / #1710 / #1711 / #1713 / ADR-0027 / ADR-0028 |
| 2026-04-21 | §7.2 にヘッダー常時 primary CTA `無料で始める` (PC のみ、`.nav-signup`) を追加。スクロール後に新規登録導線を失わないため、MoneyForward/ClassDojo 型の persistent header CTA を採用。モバイルは既存 `floating-cta` に集約して二重表示を回避。`ctaVariants` は既存 3 種 (`無料で始める` / `デモを見る` / `ログイン`) を維持。 | #1290 (umbrella #1262 派生 B1-LP-2) |
| 2026-04-21 | [08] FAQ をトップ 3 件に集約し、専用 FAQ ページ (`site/faq.html`) を新設。5 カテゴリ × 計 24 項目。#1289 の保護者懸念 8 項目のうち 6 項目を FAQ ページで応答。§4.2 [08] を刷新。 | #1291 (umbrella #1262 派生 B1-LP-3) |
| 2026-04-21 | [06] 料金サマリ (3 カード比較) を「料金プロミス 1 バンド」に置換。freemium × 低価格帯の price disambiguation 原則を §4.2 [06] に追記。`scripts/check-lp-plan-sync.mjs` に `pricePolicy: 'minPaid'` モードを追加。pamphlet.html は evaluate モード用のため従前の 3 カードを維持。 | #1293 (umbrella #1262 派生 B2) |
| 2026-04-27 | [05] ソフト機能を 3 カード → 4 カードに拡張（親ペルソナ訴求強化）。「みんなのテンプレート」「親の作業は 1 日 5 分」カードを削除し、「成長の記録（月次レポート）」「時間管理（使いすぎ防止）」「おうえんメッセージ」「設定の自由度」4 カードに再編。ADR-0013 準拠（月次レポート: `/admin/reports`、自動スリープ: `src/lib/features/auto-sleep.ts` #1292、おうえんメッセージ: 既存、設定カスタマイズ: 既存実装済み）。LP-LANDMARK コメントを更新。 | #1287 (umbrella #1262 派生 A7) |
| 2026-04-29 | Phase 5 P1 LP 仕上げ R1-R8+R16 (priority:high 9 Issue) を AC 検証。9 Issue 中 7 Issue は先行 PR で既に達成済み (R1 tokushoho 省略表示根拠 / R4 自動スリープ Committed 化 / R6 賠償上限打消し / R7 pamphlet TLS-AES-ライセンスキー除去 / R8 0 歳訴求 → 3 歳から訴求 + suggestedMinAge:3 / R16 trust-badges PC 4 列化)。残 2 件の補修: (1) `site/faq.html` L206 の家族メンバー招待人数記載を「無料 / スタンダード 4 人 / ファミリー無制限」3 段表記に整理し実装値 (`plan-limit-service.ts` `maxFamilyMembers`) と完全一致 (#1607 R3)、(2) `site/pricing.html` hero-price-band 直下に「いつでも解約 OK」打消し表示 (解約後 30 日読み取り専用 → 完全削除) を追加 (#1609 R5)。`#1606 R2` (AWS リージョン整合) は別 worktree で並列対応中のため本 PR から除外。LP メトリクス: mobileHeight=15044 / desktopHeight=7907 / forbiddenTerms=0 / ctaVariants=3 (全閾値内)。 | #1605 #1607 #1608 #1609 #1610 #1611 #1612 #1620 (Phase 5 P1) |
| 2026-04-29 | §4.2 に [05b] 年齢別成長ロードマップ section の設計記述を追加（3 部構成: §1 設計背景 / §2 設計原則 / §3 仕様）。実装は PR #1668 で `site/index.html:774-823` に live。5 stage 構造 (preschool / elementary / junior / senior / graduate) で「卒業」を最終地点として自然提示。PO 判断「単独卒業セクション禁止」を §2 設計原則に明示し、ADR-0011（コアターゲット 3-18 歳）/ ADR-0012（Anti-engagement）/ ADR-0023（卒業 = ポジティブな解約）/ StoryBrand「Success」と整合。LP メトリクス: mobileHeight=13662 / desktopHeight=7458 / forbiddenTerms=0 / ctaVariants=3（全閾値内、Issue AC `mobileHeight ≤ 15000` 達成）。 | #1613 (R9 残作業) |
| 2026-04-30 | Phase 5-B2 LP R 残 8 件 bundle. (R4 #1720) [05] soft-features を 4 cards → 3 cards 圧縮、月次レポート featured 凸構成、自動スリープ + おうえんメッセージを「家庭に寄り添う運用補助」に統合。 (R6 #1721) trust-disclaimer / cta-bottom-disclaimer から賠償上限の具体数字を除去し利用規約 / FAQ リンク誘導に置換。 (R9 #1726) site/index.html の inline `text-align:center` 全削除 (5 箇所) + section-desc 左寄せ化 (max-width:640px 維持)。 (R14 #1729) ADR-0016 BudouX CDN を head 読み込み + body / h1-h4 に `text-wrap: balance/pretty + word-break: auto-phrase` 一括適用 + carousel-label 動的更新時に `<budoux-ja>` ラップ。 (R16 #1733) 解約後猶予期間表現を「無料 即時 / スタンダード 7 日 / ファミリー 30 日」に 4 文書 (terms / privacy / faq / index) + shared-labels.js + labels.ts SSOT で統一、`liabilityBody` を「個人開発のため賠償上限あり、詳細は規約・FAQ」へ簡潔化。 (R18 #1737) `THRESHOLDS.mobileHeight` を 15200 → 15000 に restore (ADR-0006 整合)。 (#1747) `tests/e2e/lp-innerhtml-structure.spec.ts` + `scripts/check-lp-innerhtml-tags.mjs` (静的検査) を新規追加し DOMPurify 通過後の構造タグ保持を CI で hard-fail。 (#1750) ADR-0026 起票（force push 防止: Branch Ruleset + 静的検査 + Re-Review 機械チェック の多層防御）+ docs/sessions/dev-session.md / qa-session.md に明記。 LP メトリクス: mobileHeight=14741 / desktopHeight=7868 / forbiddenTerms=0 / ctaVariants=3（全閾値内、`mobileHeight ≤ 15000` 達成）。 | #1720 #1721 #1726 #1729 #1733 #1737 #1747 #1750 (Phase 5-B2) |
| 2026-04-30 | **LP / Legal 全 693 件 SSOT 100% 達成**（#1683 umbrella 完遂）。site/ 全 10 HTML ファイル (index / pricing / faq / pamphlet / selfhost / help/license-key / privacy / terms / sla / tokushoho) 内の日本語ハードコードを `src/lib/domain/labels.ts` の `LP_*_LABELS` namespace 経由に完全移行。LP 339 件 (PR #1718 / #1683-B) + Legal 354 件 (PR #1717 / #1683-C) = 693 件。`scripts/lp-ssot-baseline.json` は `count: 0`、`EXCLUDED_LEGAL_FILES` は撤廃。pamphlet.html は印刷タイミング (`beforeprint` イベント) で `reapplyLpKeys()` 実行、`tests/e2e/pamphlet-print-ssot.spec.ts` で E2E 担保。ADR-0025 が `proposed (amended)` → **accepted** 昇格、ADR-0009 §例外節「法的文書」を正式 supersede 表記に更新。i18n 対応の前提整備完了。 | #1683 (umbrella) / #1700 / #1701 / #1702 / #1703 / #1704 / #1705 / #1717 / #1718 |
| 2026-05-01 | §8.6「hero spec-badges 数値の CI 裏取り」(#1803) と §8.7「LP 削除/圧縮 PR 必須チェックリスト」(#1790) を新設。`scripts/check-lp-removal-residue.mjs` を新設し既存 19 件を baseline 化、新規 1 件追加で fail させる ratchet 設計（bypass フラグなし）。`scripts/measure-lp-dimensions.mjs` に `presetActivityCountClaimedMin: 300` gate を追加し、`<strong>300+</strong> プリセット活動` 訴求が `src/lib/data/marketplace/activity-packs/*.json` の合計 activity 数（実測 325 件）に裏付けられているかを CI で突合。`.github/workflows/lp-metrics.yml` に `removal-residue` ジョブを追加。 | #1790 / #1803 |
| 2026-05-01 | LP design polish 4 件 bundle. (#1798 U-MAJ-8/U-MIN-8) `pp-band` モバイルを 2×2 grid 化（4 約束を独立カードとして提示、`#fff` + `--gray-300` 枠 + 56px min-height）、`cta-bottom` の padding-bottom を 56→80px に拡張し `box-shadow:inset 0 -1px 0 var(--gray-300)`、`.cta-bottom + .footer` に `box-shadow:inset 0 1px 0 rgba(255,255,255,.08)` でハイライト境界線を追加。(#1799 U-MIN-2/U-MIN-3/U-MIN-4) `.section-desc` を `text-align:left` → `center` + `max-width:640px` → `720px` で中央寄せ統一、`machine-tour .tour-shot` PC `max-height:200px` → `280px;min-height:240px` (1.4 倍) に拡大、`age-panel-feature` 文字色を `--brand-700` → `--brand-800` に上げ WCAG AA 4.5:1 → 5.95:1 確保（`--brand-50` 背景）。(#1800 U-MIN-1/U-MIN-5/U-MIN-7) hero h1 span を `--brand-700` → `--brand-900` + `font-weight:900` + `--gold-300` 60% マーカー風 highlight で h2 と差別化、`floating-cta-text small` を `--gray-400`（site/shared.css 未定義かつ低コントラスト）→ `--gray-300` で `--gray-900` BG 上 11.6:1 確保、`@media(max-width:480px)` で `.hero-cta{flex-direction:column;flex-wrap:nowrap}` を追加し 480px 以下で確実に縦積み。(#1801 U-MIN-6/M-MIN-2/M-MIN-3) `gr-stage[data-stage="graduate"]` に `border:2px solid var(--gold-500)` を追加し他 4 stage と背景・padding 同一の差分のみで「特別」を表現、`indexB.k13/k17`（[02b] age-panel CTA）を「無料で始める + デモを見る」→「デモを見る」のみに簡略化し hero CTA との重複を排除、`indexB.k82` の mailto を footer の `id="contact-footer"` アンカーに置換し mailto を 1 箇所に集約（footer のみ）。LP メトリクス: mobileHeight=12701 / desktopHeight=7740 / forbiddenTerms=0 / ctaVariants=3（全閾値内、ratchet 維持）。labels.ts (LP_INDEX_PHASEB_LABELS.k13/k17/k82) と site/index.html を同期。 | #1798 #1799 #1800 #1801 |
| 2026-05-01 | LP copy / IA 5 件 bundle (#1786 / #1793 / #1794 / #1797 / #1802). (#1786 BudouX 拡大) `site/js/auto-budoux.js` 新設 — `.section-desc` / `.faq-answer` / `.cta-bottom p` / `.gr-body p` 等 ~30 箇所に `<budoux-ja>` Web Component を自動 wrap、`data-budoux-applied` で SSR 二重適用回避、CDN 未ロード時 fail-safe (ADR-0016 整合)。pricing.html / faq.html / index.html の 3 ページに配線。 (#1793 「親が観測」刷新) 計測・実験用語「親が観測できること」を 4 文脈別語彙に刷新: `softBenefitFamilySupport` → 「家庭ごとにカスタマイズできること」 / `softBenefitMonthlyReport` + `softBenefitSettings` → 「家庭で楽になること」 / `tourBenefitBattle` → 「家庭で起きること」 / growth-roadmap 5 stages `parentBenefitLabel` → 「家族で実感できること」。`grep` で `親が観測` UI 露出は 0 件、labels.ts / site/index.html / shared-labels.js SSOT 同期。 (#1794 stamp card spec) LP 文言「完成します」 → 「ポイントに交換できます」動詞統一、「週 7 日中 5 日タップでスタンプカード 1 枚分のポイントに自動交換できます」と曜日非依存 + 自動 redeem を明示。`docs/design/26-ゲーミフィケーション設計書.md` §7.3 / §7.3.1 / §7.3.2 にスタンプカード仕様セクション + LP 文言マッピング + PO 議論再発防止 Q&A を追加、`docs/rationale/04-stamp-card-spec-rationale.md` を新設し仕様維持の選択理由を記録。 (#1797 hero/最終 CTA Plan/Success 分離) 最終 CTA H2 を「家族で全部使ってから、続けるか決める」 → 「『アプリを開かなくなった日』が、家族の最大の成功です。」に Success 像でリフレーム、p を「3 歳から 18 歳までの 15 年。最後は子供が自分で計画できる自律へ。今日の 7 日間が、その第一歩です。」に。「7 日間無料・クレカ不要」系 Plan 文言は hero / pricing への一本化を維持。 (#1802 [03]/[04] H2 階層差別化) [04] machine-tour H2「コアループを支える 2 つの工夫」 → 「コアループに加えて — 朝の準備とクライマックスを支える機構」に階層化。section-desc も sub-section 化。`indexB.k21/k22 + k32/k33/k34` 同期。LP メトリクス: 全閾値内（`mobileHeight ≤ 15000` / `desktopHeight ≤ 8000` / `forbiddenTerms=0` / `ctaVariants ≤ 3` / `presetActivityCountClaimedMin ≥ 300`）。 | #1786 #1793 #1794 #1797 #1802 |
| 2026-05-01 | LP design uniformity 3 件 bundle. (#1785 R-CRT-2) スクショカード装飾枠 5 系統 (`tour-card` / `soft-card--featured` / `gr-stage[graduate]` / `versus-card.vc-analog` / `vc-digital` / `clp-parent` / `clp-child`) を 1 種 (`#fff` + `1px solid var(--gray-300)`) に統一、内側 scrshot コンテナ (`.tour-shot` / `.soft-shot` / `.gr-shot` / `.age-panel-shot`) から `border` / `background` / `border-radius` を全撤去、`box-shadow:0 4px 16px rgba(56,120,184,.12)` (soft-card featured) と `linear-gradient` (vc-digital / gr-stage graduate / clp-parent bg / clp-child bg) を全廃。featured 強調はタイトル文字色 (`var(--brand-700)`) のみで実現。(#1795 R-MAJ-4/5) hero spec-badges 3 個を 480px viewport で `flex-direction:column;gap:6px` 縦 3 段化（「2 + 1」変則表示解消）、carousel 黒スマホ枠 (`0 0 0 4px var(--gray-900)`) を PC で撤去し `border:1px solid var(--gray-300) + box-shadow rgba(56,120,184,.12)` に置換、IntersectionObserver で hero 可視中は PC ヘッダー `.nav-signup` を `opacity:0;visibility:hidden` 化。(#1796 R-MAJ-6) trust-badges 4 個を OS 依存絵文字 (`🚫👪🔑🔍` を `font-size:2rem`) から SVG (`/assets/ui/trust-{no-ads,family-circle,lock,data-local}.svg` 32×32) に置換、#4 タイトルから「広告」を外し「データを家族の手元に」へリフレーム（#1 と訴求重複解消）。`.tb-icon` CSS は `display:flex;height:32px` + `img{width:32px;height:32px}` に簡素化。labels.ts (`LP_INDEX_PHASEB_LABELS.k67/k68`) と shared-labels.js を同期。LP メトリクス: mobileHeight / desktopHeight / forbiddenTerms / ctaVariants 全て閾値内（`presetActivityCountClaimedMin: 300` 維持）。 | #1785 #1795 #1796 |
| 2026-05-01 | #1820 装飾枠統一を pricing.html / pamphlet.html へ波及 (#1823)。`site/pricing.html` 内 `box-shadow:0 4px N rgba(56,120,184,.X)` 4 ルール (`.hero-cta .btn-primary:hover` / `.plan-card.recommended` / `.plan-cta-standard:hover` / `.plan-cta-family:hover`) を全廃、hover 時の視覚 feedback は `transform:translateY(-1px) + opacity:.92` で実現。`.plan-card` の `border:2px solid` → `1px solid var(--gray-300)` に薄型統一。`site/pamphlet.html` `.plan-card.recommended` の二重枠 (`1.5px border + box-shadow:0 0 0 1.5px`) を撤去し `border-color:var(--brand-500)` のみで recommended 強調。`grep -nE "box-shadow.*rgba.*120" site/pricing.html site/pamphlet.html` の実 CSS ルール 0 件を達成（matched lines は全てコメント注釈のみ）。 | #1823 |
| 2026-05-02 | #1838 LP 末尾 `<section class="cta-bottom">` を選択肢 A で全削除。`site/index.html` から旧 [09] 最終 CTA セクション（h2 / p / signup ボタン / mailto 注記 / cancel disclaimer）+ `.cta-bottom*` CSS 4 セレクタを撤去。`labels.ts` から `LP_INDEX_PHASEB_LABELS.k79/k80/k81/k82` + `LP_LEGAL_DISCLAIMER_LABELS.cancelDisclaimerCta` + `cancelDisclaimerCtaLink` を削除。`site/shared-labels.js` を `npm run generate:lp-labels` で再生成。`site/js/auto-budoux.js` から `.cta-bottom p` セレクタを撤去。#1797 で導入した「アプリを開かなくなった日」Success 像は hero 主訴求 + growth-roadmap [05b] graduate ステージ（卒業 = ポジティブな解約 / Anti-engagement ADR-0012 整合）に内在化、最終 CTA の機能は hero CTA / mobile floating-cta / footer signup link / footer mailto に集約。PR #1836 で `.cta-bottom` padding を 28/36 にまで圧縮していた応急対応を本質的に解消。lp-content-map.md §4.2 [09] 章を削除記録 + ペルソナ動線終端 `[09] CTA` → `hero / floating / footer signup` 表記更新 + §7.1 / §7.2 / §8.5 の関連参照も同期。`docs/design/26-ゲーミフィケーション設計書.md` 自体には Plan/Success 役割分離記述は無く（卒業概念は本設計書のスコープ外で lp-content-map.md [01b] StoryBrand Guide / [05b] 成長ロードマップが SSOT）、本 LP IA 設計書側の更新で同期完了。LP メトリクス: 削除方向のため全閾値内（`mobileHeight ≤ 15000` / `desktopHeight ≤ 8000` / `forbiddenTerms=0` / `ctaVariants ≤ 3`）。 | #1838 |
| 2026-05-02 | LP CSS Spacing/Layout 3 層トークン化 Phase 1 (#1839、ADR-0042)。過去 5 PR (#1759 / #1798 / #1827 / #1831 / #1836) で section padding を多層的に圧縮 (40→28 等) してきた状態を **Base → Semantic → Component** の 3 層 SSOT に集約。`site/shared.css` の `:root` に Base spacing (`--space-0`〜`--space-16`、4px グリッド 14 段階) と Semantic LP トークン 12 種 (`--lp-section-padding-y` / `--lp-section-padding-x` / `--lp-section-title-mb` / `--lp-section-desc-mb-default` / `--lp-faq-item-padding-y` / `--lp-hero-padding-top` / `--lp-hero-padding-bottom` / `--lp-card-padding-y` / `--lp-card-padding-x` / `--lp-card-gap` / `--lp-container-max` / `--lp-container-max-wide`) を新設。`site/index.html` の主要 6 セレクタ (`.section` / `.section-title` / `.section-desc` / `.hero` / `.faq-item` / `#core-loop`) を Semantic 経由参照に置換。当初は 7 セレクタ目に `.cta-bottom` 関連 (`--lp-cta-bottom-padding-top/-bottom`) も含んでいたが、PR #1842 (#1838) で `.cta-bottom` セクションが全削除されたため rebase 時に該当 CSS ルール + Semantic トークンも併せて削除。LP メトリクス: cta-bottom 削除済み main を base としても全閾値内 (`mobileHeight ≤ 15000` / `desktopHeight ≤ 8000` / `forbiddenTerms=0` / `ctaVariants ≤ 3`)。docs/DESIGN.md §4 に LP Spacing/Layout トークン章 (Base + Semantic 表 + 禁忌節 + 段階適用) を追加。**ADR-0042 起票** (`docs/decisions/0042-lp-spacing-layout-tokens.md`)。**#1840 累積監視機構と相補的に機能**: 本リファクタ (実装側) で多層化を防ぎ、CI 側 (#1840 cumulative-lp-metrics ジョブ) で累積膨張を検出。Phase 2 (stylelint hard-fail 化 + 残り直書き全置換) と Phase 3 (pricing.html / pamphlet.html / faq.html 波及) は別 Issue で対応。 | #1839 / ADR-0042 / #1840 |
| 2026-05-02 | #1848 PO-Cont-1: LP 本体 [05b] 年齢別成長ロードマップを CTA 1 行に短縮し、5 ステージ詳細を `site/graduation.html` 別ページに集約。LP 本体 (`site/index.html`) の `<section id="growth-roadmap">` 内テキストは H2 + サブ + リンク 1 行のみ（gr-* CSS は graduation.html 内に移管）。graduation.html は header / footer / CSP / shared-labels.js / auto-budoux.js を pricing.html / faq.html と同等構成で新設し、パンくず「ホーム → 成長ロードマップ」を Hero 直下に配置。gr-shot は LP 本体 96px / 120px → graduation.html 240px / 320px に拡張、機能伝達不足を解消。`shared-labels.js` `growthRoadmap` namespace に `linkLabel` / `pageTitle` / `pageHeroTitle` / `pageHeroLead` / `pageMetaDescription` / `breadcrumbHome` / `breadcrumbCurrent` / `ctaBottomTitle` / `ctaBottomDesc` の 9 keys を追加、`labels.ts` `LP_GROWTH_ROADMAP_LABELS` も同期。LP 全 4 ページ (index.html / pricing.html / faq.html / graduation.html) の footer に `graduationLink: "成長ロードマップ"` を追加（`LP_FOOTER_LABELS.graduationLink`）。`scripts/measure-lp-dimensions.mjs` の `TARGET_HTML_LIST` に graduation.html を追加し forbiddenTerms gate を継続適用。LP メトリクス: LP 本体は CTA 1 行短縮による desktopHeight 削減方向。§4.2 [05b] 設計記述を 2 ページ構成（LP 本体 CTA 1 行 + graduation.html 詳細）に改訂。 | #1848 |
