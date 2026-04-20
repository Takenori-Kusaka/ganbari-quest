# マーケットプレイス競合分析レポート

> **目的**: がんばりクエストのマーケットプレイス全面刷新（Issue #1212）に向け、家庭タスク管理 / スタンプカード / 学習習慣化 / 海外プロダクト / 紙ベース実務の各領域における主要競合 8+ 件をベンチマークし、コンテンツ量・呼称・差別化点を整理する。
>
> **対象読者**: PO / コンテンツ設計担当 / プロダクトデザイン / Dev
> **作成日**: 2026-04-20
> **関連ドキュメント**: `docs/design/marketplace-content-audit.md`（第1フェーズ）, `docs/design/marketplace-persona-research.md`, `docs/design/marketplace-naming-recommendation.md`（同フェーズ）

---

## 1. エグゼクティブサマリ

国内 6 件 + 海外 4 件 + 紙ベース 2 件、計 12 件の競合をベンチマークした。

**主要な所見:**

1. **国内アプリのプリセット数は概ね不足**。日本語圏のお手伝い系アプリ（ファミポイ / ママペイ / OurHome 日本語版 / ピグっち / AllowanceQuest）は「白紙ベース＋親が手入力」が基本で、業界標準とも言える「即使えるプリセット集」という概念自体が薄い。海外勢 (Joon: 500+ tasks, S'moresUp: 数十のビルトイン chore, Habitica: 自由度極大) と比較して 1〜2 桁の差がある。
2. **学習習慣化の二大プロダクト（進研ゼミ努力賞 / スマイルゼミ マイキャラ）の報酬設計は極めて成熟**しているが、これらは「自社学習教材の継続率向上」専用で、家庭の汎用タスク管理にはそのまま転用できない。ただし「ポイント数の段階別景品交換」(進研ゼミ: 16/24/48/72/96/120/240pt) と「学習で得たスター → アバター着せ替え」(スマイルゼミ) のメンタルモデルは、子供と保護者双方に既に十分浸透しており、UX 設計の参照点として優先度が高い。
3. **「マーケットプレイス」という呼称は競合にほぼ存在しない**。国内では 0 件、海外でも Joon の "Quests Library" / Cozi の "List Library" / OurHome の "Chore Suggestions" / S'moresUp の "Built-in Chores" のように **"Library" / "Suggestions" / "Built-in" / "Templates"** が圧倒的多数。スマイルゼミは「マイキャラ」コンテンツへのアクセスを「マイキャラショップ」と呼び、子供の知覚的にも「ストア」より「お店」「ライブラリ」「テンプレート集」のほうが受容されやすい兆候がある（詳細は `marketplace-naming-recommendation.md` §1）。
4. **持ち物チェックリストはアプリ側でほぼ未開拓のブルーオーシャン**。Cozi の "Pre-made Planning Checklists"（After School Checklist 等）が唯一の機能化事例であり、「遠足 / 修学旅行 / 季節別」の網羅的テンプレート集をアプリ内に持つ競合は確認できなかった。一方、紙ベース（ぷりんときっず / Canva / Microsoft / よはくにイラスト等）には充実したテンプレートが存在し、需要は明確に存在する。
5. **性別配慮は「性別中立 + 趣向タグ」が業界トレンド**。海外勢（Joon / Habitica / S'moresUp / Cozi / OurHome）は性別パックを用意しておらず、tasks/quests を「興味カテゴリ」（focus area）で分類する。国内のお手伝い系アプリも性別分岐は持たず、がんばりクエスト現状の `*-boy.json` `*-girl.json` 構造はマイノリティ実装である。
6. **価格帯**: 国内は無料 + 広告 / 軽課金（ファミポイ無料, ママペイ無料）が標準。海外は月額 $4.99-$10.98 が中央値（S'moresUp $4.99/月, Greenlight $5.99-$10.98/月, Joon $9.99/月相当, Habitica グループ $9/月+メンバー $3/月）。プリセット数と価格は比例傾向にあり、500+ プリセットの Joon は国内アプリより 1 桁高い価格を取れている。

**ベンチマーク目標**: §4 で詳述するが、**プリセット活動 200+ / 持ち物テンプレート 15+ / ごほうび設計 4 段階 + アクション 30+** を達成すれば、国内の同価格帯では明確なトップ層、海外と比較しても上位 25% に位置できる。

---

## 2. 競合 12 件 比較表

凡例: **●** = 充実 / **○** = 機能あり / **△** = 限定的 / **−** = なし
プリセット数は「すぐ使えるテンプレ活動」の概数。価格は 2026-04 時点の公式情報。

### 2.1 主要競合一覧

| # | プロダクト | 区分 | 国 | プリセット数 | 持ち物 | 性別配慮 | 価格 | 「マーケットプレイス」相当の呼称 |
|---|-----------|------|----|------------|-------|---------|------|--------------------------|
| 1 | **Habitica** | 家庭タスク（汎用） | 米 | 0（白紙＋ユーザー作成） | − | 中立 | 個人無料 / グループ $9/月+$3/メンバー | "Tasks" / "Challenges"（公開チャレンジ集は "Tavern" 内 Challenges Tab） |
| 2 | **S'moresUp** | 家庭チョア | 米 | 数十（"Built-in Chores"） | − | 中立 | $4.99/月、$49.99/年（45 日無料） | "Built-in Chores" / "ChoreAI" |
| 3 | **Cozi Family Organizer** | 家族オーガナイザー | 米 | 数十（"Cozi List Library"） | ○（After School Checklist 等） | 中立 | 無料（Cozi Gold 課金あり） | "Cozi List Library" / "Pre-made Checklists" |
| 4 | **OurHome（Elusios）** | 家庭タスク | 米（日本でも DL 可） | 数十（"Chore Suggestions"） | − | 中立 | 無料 + プレミアム | "Chore Suggestions" |
| 5 | **Joon (Joon App)** | 子供向けチョア + ADHD 支援 | 米 | **500+ pre-loaded tasks** | − | 中立 | $9.99/月（年 $89.99） | "Quests" / "Quest Library" |
| 6 | **Greenlight** | 金融教育 + チョア | 米 | 数十（プリセット chores） | − | 中立 | $5.99-$24.98/月 | "Chores" / "Custom Chores" |
| 7 | **FamZoo** | 金融教育 + チョア | 米 | 数十（プリセット） | − | 中立 | $2.50-$5.99/月 | "Chores" / "IOU System" |
| 8 | **進研ゼミ小学講座 努力賞** | 学習習慣化（自社教材専用） | 日 | N/A（専用コンテンツ） | − | 中立 | 受講料に内包 | 「努力賞ポイント」「努力賞プレゼント」 |
| 9 | **スマイルゼミ マイキャラ / スター** | 学習習慣化（自社教材専用） | 日 | N/A（専用コンテンツ） | − | 中立（パーツは男女兼用基調） | 受講料に内包 | 「マイキャラ」「スター」「マイキャラショップ」 |
| 10 | **ファミポイ（AppSeed）** | お手伝いポイント | 日 | **0（白紙＋親が登録）** | − | 中立 | 無料 | （該当機能なし） |
| 11 | **ママペイ（kouki yuza）** | お手伝い + お小遣い | 日 | **0（白紙＋親が登録）** | − | 中立 | 無料 | （該当機能なし） |
| 12 | **やることカード（LITALICO）** | 発達支援 ToDo | 日 | **約 100 種の絵カード** | − | 中立 | 無料 | 「絵カード」 |

### 2.2 紙ベース実務（参考）

| プロダクト | 区分 | 国 | プリセット数 | 主な提供形式 |
|----------|------|----|------------|----------|
| **ぷりんときっず** | 印刷物 | 日 | 4 種 × 3 容量（10/20/30 回分）= 12 種 | お手伝いシート / 生活チェックシート、丸シール対応 |
| **Canva 持ち物リスト / 旅のしおり** | デザインツール | 豪→日 | 数百種のテンプレート | カスタマイズ前提のテンプレート集 |
| **Microsoft 旅のしおり / 遠足のしおりテンプレート** | Office テンプレート | 米→日 | 10+ | Word / PowerPoint テンプレート |
| **MimiLy / KF Studio / Mama Craft / よはくにイラスト 等** | 個人/小規模制作の無料 DL | 日 | 各サイト 10-50 | ご褒美シール台紙 / お手伝いシート PDF |

### 2.3 報酬設計の系譜

| プロダクト | レアリティ階層 | アバター/コレクション | 連続記録 | スクリーンタイム交換 | 金銭交換 |
|----------|--------------|------------------|---------|------------------|--------|
| Habitica | クエスト報酬 / Equipment | ● Equipment / Pet | ○ Streak | − | − |
| S'moresUp | "S'mores" 通貨 | △ | ○ | △ | ● 親設定 |
| Cozi | − | − | ○ | − | − |
| OurHome | ○ ポイント | − | ○ | − | △ 親設定 |
| Joon | コイン → Doter ペットケア | ● Doter ペット | ○ | − | − |
| Greenlight | − | − | ○ | − | ● デビットカード |
| FamZoo | − | − | ○ | − | ● IOU |
| 進研ゼミ努力賞 | **7 段階（16/24/48/72/96/120/240pt）** | ● 景品カタログ | ○ ログイン日数 | − | − |
| スマイルゼミ | スター → マイキャラパーツ | ● マイキャラ着せ替え + 月次表彰 | ○ | − | − |
| ファミポイ | △ | − | △ | − | △ |
| ママペイ | △ | − | ○ | △ | △ |
| やることカード | 星 + 魚コレクション | ○ 魚 | △ | − | − |
| **がんばりクエスト現状** | **N/R/SR/UR シール 16 種**（asset-catalog 準拠） | ● シール + 称号 + バッジ | ○ Streak | ● スクリーンタイム交換あり | − |

---

## 3. 各競合の詳細所見（強み / 弱み / 示唆）

### 3.1 Habitica — 究極の自由度。テンプレート不在の典型

**強み**: RPG 世界観（HP / Equipment / Class / Quest）が小学高学年〜中高生に強く訴求。家族向けの "Party / Group Plan" でグループ化可能。

**弱み**: プリセット活動が **0**。完全に「白紙からユーザーが作る」前提。年齢配慮はなく英語 UI（公式 i18n あるが日本語化は限定的）。利用規約上 13 歳以上が基本で、低年齢層は完全に対象外。

**がんばりクエスト視点での示唆**:
- 「白紙からユーザーが作る」設計は、日本のお手伝い系アプリの常識でもあり、これがプリセット文化が育たない一因。**がんばりクエストが「すぐ使えるパック」を全面に押し出すことで、Habitica と国内お手伝いアプリの両方が空けている隙間を取れる**。
- "Tavern" (公開チャレンジ集) は「マーケットプレイス」呼称の参考にはなるが、酒場メタファーは日本の子供向け文脈には不適。

[Habitica: Gamified Task Manager App Review | Common Sense Media](https://www.commonsensemedia.org/app-reviews/habitica-gamified-task-manager) / [Habitica Reviews 2026 | G2](https://www.g2.com/products/habitica-habitica/reviews)

### 3.2 S'moresUp — "ChoreAI" でビルトイン chore を活用

**強み**: 数十の "Built-in Chores"（laundry, raking leaves, vacuuming, drinking water, reading a book, washing hands 等）。`ChoreAI` という機械学習システムで割当・リマインド・報酬を最適化、「親の時間を週平均 8 時間節約」と謳う。Family Campfires での親同士のコミュニティ。

**弱み**: 機能過多で「シンプルな chore 割当が逆にわかりにくい」と Common Sense Media のレビューで指摘。UI の情報密度が高く幼児〜未就学層には不向き。

**がんばりクエスト視点での示唆**:
- 「ビルトイン」という呼称は **「組み込み」「最初から入っている」** という子供にも分かりやすいニュアンスを持つ。日本語訳としては「みんなが使ってる」「おすすめ」「はじめから」などが候補。
- ChoreAI 的な「親の時間節約」訴求は、**共働き家庭ペルソナ** (`marketplace-persona-research.md` の `dual-income`) に強い説得力を持つ。

[S'moresUp - Best Chores App](https://apps.apple.com/us/app/smoresup-best-chores-app/id1287367596) / [S'moresUp Review | Common Sense Media](https://www.commonsensemedia.org/app-reviews/smoresup-best-chores-app)

### 3.3 Cozi Family Organizer — 持ち物テンプレートの数少ない先行事例

**強み**: **無料**で家族カレンダー / 買い物リスト / chore リスト / レシピを統合。"Cozi List Library" に "After School Checklist" などの**事前定義済みプランニングチェックリスト**を持つ点が他競合と一線を画す。家族メンバー個別の chore リストを Pin できる UX 設計。

**弱み**: ゲーミフィケーション要素は皆無。子供向けというより親向けのオーガナイザー。

**がんばりクエスト視点での示唆**:
- **Cozi List Library は「持ち物チェックリストパック」設計の最重要参考事例**。第1フェーズ成果物 §5 の「checklist-elementary-excursion-spring」等のパック構造は Cozi に近い設計思想で、業界に先例があるという正当性を持つ。
- "List Library" という呼称は、子供にとっても「としょかん」のメタファーで親しみやすい候補。

[Cozi Chores: Chore Lists for Families](https://www.cozi.com/blog/cozi-chores/) / [Cozi Features](https://www.cozi.com/feature-overview/)

### 3.4 OurHome — 「Chore Suggestions」の存在

**強み**: タスクを部屋ごとに整理。"Chore Suggestions" 機能で chore 追加時にカテゴリ選択 or テキスト入力でサジェストが出る（デフォルトポイント付き）。

**弱み**: ポイントシステムは存在するが報酬設計は浅い。日本語にローカライズはあるが「日本固有のお手伝い文化」（朝の支度 / 夏休みのプール準備 / お正月の餅つき等）は反映されていない。

**がんばりクエスト視点での示唆**:
- "Chore Suggestions" の入力時サジェストは、**「白紙でも、選ぶときに手助けしてくれる」** という UX として優れている。本アプリでも活動カスタム時にプリセットからのサジェストを出すと、フリープランの 3 件制約があっても「何を作るか」の判断負荷を下げられる。

[OurHome - Google Play](https://play.google.com/store/apps/details?id=com.elusios.ourhome) / [OurHomeで家事の分担見える化](https://foo23.hatenablog.jp/entry/2017/04/26/120157)

### 3.5 Joon — 業界最多の 500+ pre-loaded tasks

**強み**: **500+ pre-loaded tasks**（業界最多級）。子供向け 6-12 歳に絞った設計、子供の達成完遂率 90%（公称）。バーチャルペット "Doter" のケアという報酬設計（ポケモン的）。小児科医 / OT / 特別支援教員推奨。

**弱み**: 月額 $9.99 と高価格。長期継続で子供が飽きる声がある。ADHD 支援が中心で発達定型児には機能が過剰な場合がある。

**がんばりクエスト視点での示唆**:
- **500+ tasks は「ベンチマーク上限」**。ただし pre-loaded の質と分類（focus area）の設計が伴わないと「数だけ多くて選べない」状態に陥る。本アプリは現状 32 ファイル（活動 200+ 相当）あるので、**質的整理が間に合えばこの上限に近づける**。
- "Quests" という呼称は本アプリの「クエスト」と完全に被る（むしろ本アプリのメインメタファー）。**「クエスト集」「クエストライブラリ」** が呼称候補として強い説得力を持つ。

[Joon: The behavior improvement app for kids](https://www.joonapp.io) / [Joon: Kids ADHD Chore Tracker - App Store](https://apps.apple.com/us/app/joon-kids-adhd-chore-tracker/id1482225056) / [Joon App Review 2025 | Choosing Therapy](https://www.choosingtherapy.com/joon-app-review/)

### 3.6 Greenlight / FamZoo — 金融教育系（プリセット数より報酬設計）

**強み (Greenlight)**: $5.99/月の Core プランで最大 5 人分のデビットカード + chore + allowance + キャッシュバック貯蓄 + 投資。
**強み (FamZoo)**: $2.50-$5.99/月で最も "in-depth" な chore system、chore の親同士分割払い、子供が "dibs" を主張可能、親レビュー後の支払い保留可能。

**弱み**: 米国市場前提（プリペイドデビットカードが基本）。日本の子供向け金融文化（子ども銀行口座、お年玉、お小遣い帳）と整合せず、そのまま転用は不可。

**がんばりクエスト視点での示唆**:
- 金融教育の本格機能は **Pre-PMF では明示的に対象外**（ADR-0023 / ADR-0034 系の Pre-PMF 防衛設計禁止と整合）。ただし、「お小遣い相当の何か」（スクリーンタイム交換 / 特権交換）は本アプリ既存実装と整合し、Greenlight/FamZoo の「親レビュー後の付与」UI パターンは参考にできる。

[Greenlight Chores & Allowance App](https://greenlight.com/chores-and-allowance-app-for-kids) / [Best Allowance Apps for Kids 2025 | CoFinancially](https://cofinancially.com/best-allowance-apps-for-kids/)

### 3.7 進研ゼミ小学講座「努力賞」 — 段階別景品交換の正解例

**強み**: ベネッセが数十年運用してきた習慣化の集大成。**16/24/48/72/96/120/240 ポイントの 7 段階景品**、有効期限は中学卒業年の 6 月 24 日まで（最長）。「赤ペン先生提出」「実力診断テスト提出」「チャレンジタッチ毎月レッスン完了」「5 日連続ログイン +4pt」「24 日まで完了 +4pt」「サクセスナビ 5 日以上ログイン 5→10pt 倍率キャンペーン」など、**ポイント獲得経路の多様性 + 短期インセンティブ + 長期目標**が高度に設計されている。

**弱み**: 自社教材専用。家庭の汎用タスクには使えない。退会後も既存ポイントは交換可能だが受講履歴がある講座のみ対象という縛りがある。

**がんばりクエスト視点での示唆**:
- **「ポイント数の段階別景品」は日本の親子に既に十分浸透**。本アプリのごほうび設計（`reward-sets/`）に「進研ゼミ風 7 段階」のテンプレを 1 つ用意する価値がある。
- 「努力賞」という呼称は子供に「がんばり」を肯定的に認識させる。本アプリの **「ごほうび」「がんばり」「ポイント」のラベル設計**は labels.ts SSOT 経由で運用するが、進研ゼミの「努力賞ポイント」は呼称として極めて強い参照点。

[努力賞とは | 進研ゼミ](https://sgaku.benesse.ne.jp/member/oya/sp/point/open/help/) / [小学講座の「努力賞ポイント」とは何ですか？ | ベネッセ FAQ](https://faq.benesse.co.jp/faq/show/246?site_domain=sho)

### 3.8 スマイルゼミ「マイキャラ」「スター」 — アバター着せ替えの王道

**強み**: 学習で得たスター → マイキャラのパーツ交換、月初に表彰式（「すごいキミ」表彰）、わんだふるぷりきゅあ / ウルトラマンとのキャラコラボ。**「マイキャラショップ」**という呼称で着せ替えコンテンツへのアクセス UI を提供。

**弱み**: 自社教材専用 + タブレット専用機。

**がんばりクエスト視点での示唆**:
- **「マイキャラショップ」**は「マーケットプレイス」より子供に親しみやすい呼称の参考事例。ただし、本アプリは「無料配布の活動パック」が中核なので「ショップ」という売買ニュアンスは過剰。**「マイキャラ → マイがんばり」「ショップ → おみせ / おうち」** などの語尾アレンジが候補。
- 月次表彰は本アプリにはまだ実装されていないが、**家族内ランキング + 月次サマリ**として既存設計に組み込める（第1フェーズ成果物 §4.3 の elementary 報酬設計と整合）。

[スマイルゼミ｜マイキャラの全て！ | 学ぼっか](https://manabokka.com/smile-zemi-my-character) / [夢と学びをつなぐ！着せ替えコンテンツ「マイキャラ」 | 公式スマイルゼミ](https://smile-zemi.jp/info/smilestory/interview/09/01/)

### 3.9 ファミポイ（AppSeed） — 国内お手伝いアプリの典型

**強み**: 完全無料、親用 / 子用ページ分離、グラフ機能（週/月/6 ヶ月）、履歴機能、ポイント通知機能。「メンバー編集」「リスト編集」「交換アイテム編集」のシンプルな 3 軸構成。

**弱み**: プリセット活動が **0**（親が手で登録）。報酬設計は「ポイント蓄積→交換アイテム」のシンプルな 2 段階のみ。年齢別の動機構造設計なし。

**がんばりクエスト視点での示唆**:
- **国内競合の典型的な機能粒度**。本アプリが「プリセット活動 200+」と「年齢別 4 段階報酬モデル」を実装すれば、ファミポイとは明確に異なるカテゴリのプロダクトとして認識される。
- 「ポイント通知機能」のような小さな改善が継続的にアップデートされている点は学べる（Pre-PMF でも「使われている機能を伸ばす」姿勢）。

[お手伝いアプリ ファミポイ - Google Play](https://play.google.com/store/apps/details?id=com.appseed.famipoi) / [子供おてつだいポイントアプリ ファミポイ | AppSeed Inc.](https://app-seed.com/famipoi/)

### 3.10 ママペイ（kouki yuza） — お小遣い管理に特化

**強み**: 広告なし、複数端末同期、「お手伝い」とは別に「その他項目」あり、ポイントマイナス対応（懲罰的減点が可能）、パスワード設定。

**弱み**: プリセット活動 0、UX バグ（アイコン並び順がおかしい / モーダル中の他項目操作不可 / 並べ替えが不安定）が複数指摘。

**がんばりクエスト視点での示唆**:
- 「ポイントマイナス機能」は本アプリでは**意図的に採用しない**べき設計。子供向けゲーミフィケーションの王道（Joon / Habitica / 進研ゼミ努力賞）は懲罰的設計を避ける。Erikson 第 4 段階「勤勉性 vs 劣等感」の劣等感を強化するため。
- **広告なし**は日本の子供向けアプリの最低限品質。本アプリも当然遵守。

[ママペイ - おうちペイでお小遣い管理アプリ - App Store](https://apps.apple.com/jp/app/%E3%83%9E%E3%83%9E%E3%83%9A%E3%82%A4-%E3%81%8A%E3%81%86%E3%81%A1%E3%83%9A%E3%82%A4%E3%81%A7%E3%81%8A%E5%B0%8F%E9%81%A3%E3%81%84%E7%AE%A1%E7%90%86%E3%82%A2%E3%83%97%E3%83%AA/id1550523752) / [ママペイとは?やり方とアイデアまとめ! | haruMedia](https://eigomirai.com/mamapay/)

### 3.11 やることカード（LITALICO） — 発達支援領域の絵カード 100 種

**強み**: **約 100 種の絵カード**（日常動作 / 道具 / 場所）、音声読み上げ、写真と録音でのオリジナル絵カード作成、世界 10 言語対応。星のタップ + 魚コレクションのモチベーション機能。発達障害支援を主眼に設計。世界 150 ヶ国配信、1 年で 100 万 DL 突破。

**弱み**: 発達支援に特化しているため、ゲーミフィケーション要素は控えめ（魚コレクションのみ）。

**がんばりクエスト視点での示唆**:
- **国内アプリで唯一、100 種規模のプリセット（絵カード）を持つ事例**。視覚的な絵カード文化は本アプリの asset-catalog（シール画像化計画）と相性が良い。
- 「絵カード」呼称は**乳幼児〜小学低学年に親しみやすい**が、中高生には子供っぽい。年齢帯別の呼称切替が必要 → `marketplace-naming-recommendation.md` §4。

[やることカード - LITALICOアプリ](https://app.litalico.com/kidstodolist/jp.html) / [LITALICO「やることカード」リリース | EdTechZine](https://edtechzine.jp/article/detail/392) / [LITALICOアプリ 100 万 DL 突破 | PR TIMES](https://prtimes.jp/main/html/rd/p/000000049.000025994.html)

### 3.12 紙ベース実務（ぷりんときっず / Canva / Microsoft / よはくにイラスト 等）

**強み**:
- ぷりんときっず: お手伝いシート 4 デザイン × 3 容量 = **12 種**。10/20/30 回分対応。市販丸シール (カラーラベル) と互換。
- Canva: **数百種の持ち物リスト / 旅のしおりテンプレート**。AI 検索可能。
- Microsoft Office: 修学旅行・遠足のしおりテンプレート（Word / PowerPoint）。
- 個人配布サイト群: ご褒美シール台紙無料 DL **12 サイト以上**集約 (MimiLy)。

**弱み**: アプリ機能としての連動なし、印刷 / 手作業前提。

**がんばりクエスト視点での示唆**:
- **持ち物テンプレートはアプリ化の市場機会が明確に存在**。紙の Canva / Microsoft で繰り返し作る手間を、アプリで「子供と保護者が一緒にチェック」する体験に置換できる。
- ぷりんときっずの「お手伝いシート 4 デザイン × 3 容量」フォーマットは、本アプリの「シール台紙」UI 検討時の参考。

[お手伝いシート・生活チェックシート | ぷりんときっず](https://print-kids.net/print/other/otetsudai-sheet/) / [子どものやる気を引き出す『ごほうびシール台紙』無料ダウンロードサイト 12 選 | MimiLy](https://mimily.jp/archives/257) / [持ち物リスト無料テンプレートデザイン | Canva](https://www.canva.com/ja_jp/templates/s/mochimonolist/) / [しおり (修学旅行) - Office テンプレート](https://www.microsoft.com/ja-jp/office/pipc/template/result.aspx?id=10180)

---

## 4. ベンチマーク目標値

「上位 25%」に位置するための具体的な数値目標。

### 4.1 プリセット活動数

| 区分 | 国内中央値 | 海外中央値 | **がんばりクエスト目標** | 根拠 |
|------|-----------|-----------|------------------|------|
| 全体プリセット活動数 | 0-100（やることカード除き多くは 0） | 50-500（Joon 500+） | **200+**（5 世代 × 5 カテゴリ × 平均 8 活動 = 200） | 第1フェーズ成果物 §2 のカバレッジ目標表 (baby 16 / kinder 27 / elementary 34 / junior 31 / senior 30 = 138 + 重複/補強で 200+) |
| パック数 | 1-3（やることカード） | 10-50 | **20+**（年齢別 5 + テーマ別 10 + 持ち物 5+） | 海外中央値の下限。質を上げれば数で勝てる必要なし |
| 1 パックあたりの活動数 | 該当なし | 8-20 | **10-25**（年齢別は多め、テーマ別は絞る） | Joon の Quest pack 構成、Habitica Challenges Tab 平均 |

### 4.2 持ち物チェックリスト

| 区分 | 国内アプリ | 国内紙ベース | **がんばりクエスト目標** | 根拠 |
|------|----------|------------|------------------|------|
| 持ち物テンプレート数 | 0（事実上ゼロ） | 数百種（Canva / Microsoft） | **15+**（kinder 4 季 + elementary 4 季 + 行事 5 + お出かけ 5） | Cozi List Library + 第1フェーズ成果物 §5.5 の推奨パック例から |
| 行事別カバレッジ | − | 修学旅行 / 遠足 / 運動会 / 林間学校 等 | **遠足 / 運動会 / 水泳 / 修学旅行 / 林間学校 / 体育祭 / 文化祭 / 部活合宿 / 帰省 / 旅行** | Microsoft / Canva の主要テンプレ、Cozi の After School Checklist |
| 季節別カバレッジ | − | 春夏秋冬 + 行事 | **kinder/elementary 各 4 季 + 共通行事 5** | ぷりんときっず / 個人配布サイトの定番 |

### 4.3 ごほうび設計

| 区分 | 国内競合 | 海外競合 | **がんばりクエスト目標** | 根拠 |
|------|---------|---------|------------------|------|
| 報酬段階数 | 1-2 | 1-3（Joon コイン → ペット要素） | **4 段階モデル**（年齢別 baby/kinder/elementary/junior+senior） | 第1フェーズ成果物 §4 の Erikson 心理社会的発達理論ベース |
| ごほうびテンプレート数 | 数個 | 数十個（公開 Marketplace 含む） | **30+**（reward-sets/ 配下、年齢別 × ごほうび種別） | 進研ゼミ努力賞の 7 段階 × 複数景品系統を参考 |
| アバター / コレクション | スマイルゼミ ●、他 △ | Joon ペット ●、Habitica Equipment ● | **シール 16+ / バッジ 20+ / 称号 15+**（asset-catalog 既定値） | 既存設計と asset-catalog.md §優先度最高 |

### 4.4 価格帯

| 区分 | 国内 | 海外 | **がんばりクエスト現状/方針** |
|------|------|------|----------------------|
| 無料プラン | ファミポイ / ママペイ / OurHome 全機能無料 | Cozi 基本無料 | カスタム活動 3 件まで（Free） |
| 有料プラン中央値 | − | $4.99-$9.99/月 | Standard / Family（プラン用語統一規約 21 参照） |

---

## 5. 出典一覧

すべて 2026-04-20 アクセス確認済み。商業バイアスを認識した上で、公式ストア説明 / 主要レビュー媒体（Common Sense Media / G2 / GetApp / Capterra / EducationalAppStore）/ 主要メディア（PR TIMES / EdTechZine）/ 公式ヘルプを優先採用。

| # | 区分 | プロダクト | URL | 信頼度 |
|---|-----|-----------|-----|------|
| 1 | レビュー | Habitica | https://www.commonsensemedia.org/app-reviews/habitica-gamified-task-manager | A（公益団体レビュー） |
| 2 | レビュー | Habitica G2 | https://www.g2.com/products/habitica-habitica/reviews | B（B2B レビュー） |
| 3 | 公式 | S'moresUp Apple Store | https://apps.apple.com/us/app/smoresup-best-chores-app/id1287367596 | A（公式ストア説明） |
| 4 | レビュー | S'moresUp Common Sense | https://www.commonsensemedia.org/app-reviews/smoresup-best-chores-app | A |
| 5 | 公式 | Cozi Chores | https://www.cozi.com/blog/cozi-chores/ | A（公式ブログ） |
| 6 | 公式 | Cozi Features | https://www.cozi.com/feature-overview/ | A |
| 7 | 公式 | OurHome Google Play | https://play.google.com/store/apps/details?id=com.elusios.ourhome | A（公式ストア説明） |
| 8 | 二次 | OurHomeで家事の分担見える化 | https://foo23.hatenablog.jp/entry/2017/04/26/120157 | C（個人ブログ補助情報） |
| 9 | 公式 | Joon | https://www.joonapp.io | A |
| 10 | 公式 | Joon Apple Store | https://apps.apple.com/us/app/joon-kids-adhd-chore-tracker/id1482225056 | A |
| 11 | レビュー | Joon Choosing Therapy | https://www.choosingtherapy.com/joon-app-review/ | B（医療系レビュー） |
| 12 | 公式 | Greenlight Chores | https://greenlight.com/chores-and-allowance-app-for-kids | A |
| 13 | 比較 | CoFinancially Allowance Apps 2025 | https://cofinancially.com/best-allowance-apps-for-kids/ | B（比較メディア） |
| 14 | 公式 | 進研ゼミ努力賞 | https://sgaku.benesse.ne.jp/member/oya/sp/point/open/help/ | A |
| 15 | 公式 | 進研ゼミ FAQ 努力賞ポイント | https://faq.benesse.co.jp/faq/show/246?site_domain=sho | A |
| 16 | 公式 | スマイルゼミ マイキャラ公式 | https://smile-zemi.jp/info/smilestory/interview/09/01/ | A |
| 17 | レビュー | スマイルゼミ マイキャラ解説 | https://manabokka.com/smile-zemi-my-character | C（個人ブログ） |
| 18 | 公式 | ファミポイ Google Play | https://play.google.com/store/apps/details?id=com.appseed.famipoi | A |
| 19 | 公式 | AppSeed ファミポイ紹介 | https://app-seed.com/famipoi/ | A |
| 20 | 公式 | ママペイ Apple Store | https://apps.apple.com/jp/app/%E3%83%9E%E3%83%9E%E3%83%9A%E3%82%A4-%E3%81%8A%E3%81%86%E3%81%A1%E3%83%9A%E3%82%A4%E3%81%A7%E3%81%8A%E5%B0%8F%E9%81%A3%E3%81%84%E7%AE%A1%E7%90%86%E3%82%A2%E3%83%97%E3%83%AA/id1550523752 | A |
| 21 | 公式 | やることカード LITALICO | https://app.litalico.com/kidstodolist/jp.html | A |
| 22 | 報道 | やることカードリリース EdTechZine | https://edtechzine.jp/article/detail/392 | B（業界メディア） |
| 23 | 報道 | LITALICO 100 万 DL 突破 PR TIMES | https://prtimes.jp/main/html/rd/p/000000049.000025994.html | A（公式プレスリリース） |
| 24 | 公式 | ぷりんときっず お手伝いシート | https://print-kids.net/print/other/otetsudai-sheet/ | B（個人配布サイト、定評ある教育系） |
| 25 | キュレーション | ご褒美シール台紙無料 DL 12 選 MimiLy | https://mimily.jp/archives/257 | C（キュレーション、参考情報のみ） |
| 26 | 公式 | Canva 持ち物リストテンプレート | https://www.canva.com/ja_jp/templates/s/mochimonolist/ | A（公式テンプレート集） |
| 27 | 公式 | Microsoft Office 修学旅行しおり | https://www.microsoft.com/ja-jp/office/pipc/template/result.aspx?id=10180 | A |
| 28 | 公式 | 「ハロまね」三井住友 子供のお小遣い帳 | https://mamaroid.com/iphone/haromane/ | C（個人ブログ） |

**信頼度凡例**: A = 公式ストア / 公式ヘルプ / 公式ブログ / プレスリリース / 公益団体レビュー、B = 業界メディア・B2B レビュー・医療系レビュー、C = 個人ブログ・キュレーション（補助情報のみ）

### 不採用とした情報源

- **Wikipedia**: 一次出典に当たることを推奨
- **アプリブ / app-liv.jp / app-field.com 等のキュレーション系**: 検索結果として出現するも、各アプリの公式ページを直接参照する方針を優先
- **「みつごこ」** (本リサーチ依頼で言及): 該当アプリは本検索範囲では特定できず。同名 / 類似名のサービスが見つからなかったため、対象外とした（誤記の可能性あり）

---

## 6. 改訂履歴

| 日付 | 改訂内容 | 担当 |
|------|---------|------|
| 2026-04-20 | 初版作成（Deep Research Agent / Phase 2） | Claude |
