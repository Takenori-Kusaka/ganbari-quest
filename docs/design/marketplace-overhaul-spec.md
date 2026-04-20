# マーケットプレイス全面刷新 企画書・仕様書

> **対象 Epic**: #1212 — マーケットプレイス全面整理 (構造リファクタ + コンテンツ刷新 + 命名再定義 + LP 整合)
> **作成日**: 2026-04-20
> **対象読者**: PO / Dev / Designer / マーケ / QA
> **格付**: Pre-PMF 期の事業上最重要リファクタ (顧客獲得 → 有料転換の主要レバー)
>
> **裏付け**: 4 リサーチレポート (合計 50K+ 字 / 150+ 一次出典)
> - `marketplace-content-audit.md` (749 行 / 文科省・厚労省・スポーツ庁・国研・小児科学会 34 出典)
> - `marketplace-competitor-analysis.md` (19,127 字 / 12 サービス精査・28 出典)
> - `family-discipline-research.md` (16,224 字 / 育児雑誌・通信教育・自治体配布 27 出典)
> - `marketplace-naming-recommendation.md` (14,781 字 / ペルソナ語感調査・23 出典)

---

## 0. エグゼクティブサマリ

### 0.1 何を解決するか

がんばりクエストの **マーケットプレイス** (= 即使えるテンプレ群) は現在、以下 4 つの構造的課題を抱えている。

1. **二重管理**: `src/lib/data/activity-packs/` (legacy 16 ファイル: 5 年齢 × 男/女/デフォルト + otetsudai-master) と `src/lib/data/marketplace/` (新 SSOT, 14 ファイル: 年齢型 6 + **要件不在のテーマ型 8**) が並存し drift 発生中
2. **テーマ型 9 件の要件不在**: `otetsudai-master` / `study-master` / `exam-prep` / `creative-artist` / `sports-hero` / `outdoor-explorer` / `social-butterfly` / `weekend-fun` / `life-skills-baby` が企画書・仕様書に根拠なく独自拡張されている。市場適合性の裏付けがなく、選択肢ノイズ化している
3. **コンテンツ不足**: 学習指導要領 5 領域カバレッジに穴 / 性別パック 10 件に市場根拠不足と既存非対称 (教育機会格差) / 中高生パックに 3-way 矛盾 / 持ち物プリセット皆無
4. **呼称ミスマッチ**: 「マーケットプレイス」を採用する競合は **0 件**。Pre-PMF 段階で「販売プラットフォーム」を前面に出す必然性がない
5. **LP 整合性欠如**: #1164 で「持ち物タブ」を LP で訴求済みだが、マーケットプレイス側に持ち物テンプレートが 0 個

### 0.2 戦略の核

**「カスタム活動 3 件まで (Free プラン)」という既存制約をテコに、初期パッケージの十分性で paid 転換を生む。**

```
[Free 体験フロー]
  サインアップ → テンプレ選択 → 「すぐ使えるな」と判断 → 1-2 週間運用
  → カスタムしたくなる項目発生 → 3 件制約に到達 → Standard 検討
                                              ↑
                            ここに到達するには「初期パッケージの十分性」が必須条件
```

**現状**: 初期テンプレ不足で「カスタムしたくなる前に離脱」が想定される (Joon 500+ tasks の半数強で cohort retention 90% を主張するのと対照的)。

### 0.3 ベンチマーク目標

| 指標 | 国内中央値 | 海外中央値 | **本アプリ目標** | 根拠 |
|------|-----------|-----------|---------------|------|
| プリセット活動数 | 0-100 | 50-500 | **200+** | 5 世代 × 5 カテゴリ × 平均 8 活動 |
| パック数 (バンドル同梱) | 1-3 | 10-50 | **15** (5 年齢 × 男/女/デフォルト) | 仕様書純化。テーマ型は「追加インポート」拡張機能で扱う (§11.1 F1) |
| 持ち物テンプレ | 0 (国内 ZERO) | 0-10 | **15+** | Cozi が唯一の前例。BLUE OCEAN |
| ごほうびテンプレ | 数個 | 数十 | **30+** | 進研ゼミ努力賞 7 段階 + 種別 |
| 報酬段階モデル | 1-2 段階 | 1-3 段階 | **4 段階モデル** | Erikson 心理社会的発達理論 |

達成すれば **国内同価格帯トップ層 / 海外比較で上位 25%** に位置する。

**注**: 「パック数 20+ = 年齢別 5 + テーマ別 10 + 持ち物 5+」という当初目標は 2026-04-20 改訂で撤回。テーマ型 (勉強特化・運動特化等) はバンドル同梱せず、将来の「追加インポート機能」(既存プリセットを置換せず追加) で扱う方針に変更。初期パッケージの十全感は **15 パック × 中身の質** で達成する。

### 0.4 命名再定義

| 文脈 | 旧 | 新 (推奨) |
|------|-----|---------|
| ナビ・breadcrumb | マーケットプレイス | **テンプレート** |
| ページタイトル | マーケットプレイス | **みんなのテンプレート** |
| サブ見出し | (なし) | **おすすめパック** |
| タブ | (4 種混在) | **アクティビティ集 / ごほうび集 / 持ち物リスト / ルール集** |
| インポート CTA | （バラバラ） | **使ってみる** |
| junior/senior 高難度バッジ | (なし) | **クエスト集** |

---

## 1. 事業背景 — なぜ今刷新が必要か (Why Now)

### 1.1 Pre-PMF 段階における「マーケットプレイスの十分性」のレバー特性

ADR-0023 (Pre-PMF Issue 優先度判断基準) では、Pre-PMF 期の最優先課題は **「最初の 100 ユーザーの獲得と継続」** と定義されている。本アプリの Free → 有料転換ファネルは以下:

```
1. LP 訪問 → サインアップ (Free)
   ・LP の訴求が刺さる必要がある (#1163, #1164 LP メトリクス対応済)

2. 初期セットアップ → 「これは使えそう」と判断
   ・★ ここで「テンプレートが豊富」が決定的に効く
   ・現状 (Epic 着手前): 14 activity packs (うち 8 件は要件不在テーマ型), 15 checklists, 10 reward sets, 10 rule presets
   ・Epic 後: **15 activity packs** (5 年齢 × 男/女/デフォルト、中身の質で勝負), テーマ型は追加インポート機能へ (§11.1 F1)
   ・国内競合 (ファミポイ/ママペイ) は事実上 0 件 → 本アプリの構造的優位
   ・海外 Joon は 500+ → ベンチマーク上限

3. 1-2 週間運用 → 子供の生活習慣が見えてくる
   ・★ 学習指導要領 / 育児雑誌レベルの「網羅性」がここで効く
   ・「うんどう」のテンプレが 3 個しかなければ、子供の運動領域全体を扱えない感じる

4. カスタム活動を作りたくなる → 3 件制約 (Free) に到達 → Standard 検討
   ・★ 「初期テンプレで物足りない」のではなく
        「自分の子に合わせた微調整」を望む段階で課金検討させたい
   ・初期テンプレが薄いと「もっと色々あれば...」で paid に行く前に離脱
```

**結論**: マーケットプレイスの量と質は、Free → 有料の **転換ファネルの第 2 段 (継続) と第 4 段 (有料化判断) の両方で効くレバー**。

### 1.2 #1164 LP 訴求との整合 (持ち物タブ問題)

LP (`site/index.html`) では既に **「持ち物チェックリスト機能」** を訴求している (#1164 で LP スクショ対応済)。しかしマーケットプレイス側には持ち物パックが **15 個全て (morning/evening/weekend × baby/kinder/elementary/junior/senior)** あるが、これは **「日課ルーティン」** であって LP の訴求である **「遠足・修学旅行・季節行事の持ち物」** ではない。

LP で訴求しているのに体験画面で見つからないのは **訴求-提供の断絶** であり、転換率を直接損なう。

### 1.3 競合分析が示すマーケット隙間

| 隙間 | 状況 | 本アプリが取りに行ける根拠 |
|------|------|------------------------|
| **国内のプリセット集ブルーオーシャン** | ファミポイ/ママペイ/OurHome 日本語版 = pre-loaded 0 件 | 200+ プリセット投入で構造的差別化 |
| **持ち物テンプレートのブルーオーシャン** | アプリ化事例は Cozi のみ。紙ベース (Canva/Microsoft) は数百あるが連動なし | Cozi 範囲超え + 行事別カバレッジで日本市場初占有 |
| **段階的報酬の体系化** | スマイルゼミ「マイキャラ」+ 進研ゼミ「努力賞 7 段階」が浸透済の認知ベース | 4 段階発達モデル + asset-catalog のシール画像化で完全実装 |
| **発達段階別 UX** | Joon (6-12 歳特化) / Habitica (13+) は単一年齢帯 | 5 世代 × 4 段階報酬モデルでフルカバー |

---

## 2. 競合ポジショニング (Where We Stand)

### 2.1 競合 12 件 サマリ表 (詳細は `marketplace-competitor-analysis.md` §2)

| プロダクト | 国 | プリセット | 持ち物 | 性別配慮 | 価格 | 「マーケット」相当呼称 |
|----------|----|---------|-------|---------|------|------------------|
| Habitica | 米 | 0 | − | 中立 | $9/月 グループ | "Tasks" / "Challenges" |
| **Joon** | 米 | **500+** | − | 中立 | $9.99/月 | "Quests" / "Quest Library" |
| S'moresUp | 米 | 数十 | − | 中立 | $4.99/月 | "Built-in Chores" |
| Cozi | 米 | 数十 | **○** | 中立 | 無料 | "Cozi List Library" |
| OurHome | 米 (日対応) | 数十 | − | 中立 | 無料+ | "Chore Suggestions" |
| Greenlight | 米 | 数十 | − | 中立 | $5.99-$10.98/月 | "Chores" |
| 進研ゼミ努力賞 | 日 | N/A | − | 中立 | 受講料 | 「努力賞ポイント」 |
| スマイルゼミ | 日 | N/A | − | 中立 | 受講料 | 「マイキャラショップ」 |
| ファミポイ | 日 | **0** | − | 中立 | 無料 | (なし) |
| ママペイ | 日 | **0** | − | 中立 | 無料 | (なし) |
| やることカード | 日 | 100 (絵カード) | − | 中立 | 無料 | 「絵カード」 |
| **がんばりクエスト 現状** | 日 | 14 packs (~140 活動相当) | 15 (日課のみ) | **性別パックあり (ADR-0042 維持)** | Free/Std/Family | **「マーケットプレイス」** |

### 2.2 重要な競合観察

1. **「マーケットプレイス」呼称を採用する競合は 0 件**。海外標準は **Library / Suggestions / Built-in / Templates / Quests**
2. **性別パックを採用する競合は 0 件** — 本アプリの `*-boy.json` `*-girl.json` 構造は差別化要素。業界標準逸脱のリスクは stated preference (中立選好層) 向けに中立パック並存で緩和 (ADR-0042)
3. **持ち物テンプレ機能化は Cozi のみ**。アプリ化のブルーオーシャン
4. **海外有料アプリの中央値は月 $4.99-$9.99**。プリセット数と価格は概ね比例 (Joon 500+ は最高価格帯)
5. **国内お手伝い系アプリは pre-loaded 0**。「白紙＋親手入力」が業界常識 → 本アプリの「200+ プリセット」は構造的差別化

### 2.3 報酬設計の系譜 (詳細は `marketplace-competitor-analysis.md` §2.3)

進研ゼミ「努力賞」: **16/24/48/72/96/120/240 ポイントの 7 段階景品** (有効期限: 中学卒業年 6/24 まで)
スマイルゼミ「マイキャラ」: 学習で得たスター → アバター着せ替え + 月次「すごいキミ」表彰

→ **「ポイント数の段階別景品」と「アバター進化」は日本の親子に既に十分浸透**しており、本アプリの報酬設計はこれらに **学ぶべき**。一方、ママペイの「ポイントマイナス機能」は Erikson「勤勉性 vs 劣等感」の劣等感を強化するため **意図的に採用しない**。

---

## 3. コンテンツ戦略 (What to Build)

### 3.1 学習指導要領カバレッジ目標 (詳細は `marketplace-content-audit.md` §2)

各世代のカテゴリ別目標活動数 (中立パックの最低水準。性別バリアントは共通活動 + 性別特化差分 5-8 を追加):

| 世代 | seikatsu | undou | benkyou | souzou | kouryuu | 合計 | 主要根拠 |
|------|---------|-------|---------|--------|---------|------|---------|
| baby (0-2) | 6 | 4 | 2 | 2 | 2 | **16** | 厚労省睡眠ガイド / こども家庭庁発育調査 |
| kinder (3-5) | 8 | 5 | 5 | 4 | 5 | **27** | 文科省幼稚園教育要領 (5 領域全カバー必須) |
| elementary (6-12) | 10 | 6 | 8 | 5 | 5 | **34** | 文科省小学校学習指導要領 (教科横断) |
| junior (13-15) | 8 | 5 | 8 | 4 | 6 | **31** | 文科省中学校学習指導要領 + 特別活動 3 視点 |
| senior (16-18) | 8 | 4 | 8 | 4 | 6 | **30** | 文科省高校学習指導要領 + 総合的な探究 |
| **合計** | | | | | | **138** | (重複・補強で 200+ 達成) |

### 3.2 既存パックの修正必須項目

#### 3.2.1 中高生パックの 3-way 矛盾 (CRITICAL)

| ファイル | パック名 | targetAgeMin/Max | gradeLevel | 矛盾 |
|---------|---------|-----------------|-----------|------|
| junior-high-challenge.json | 「中学生チャレンジ」 | 10/12 | middle_school | 10-12 歳=小学校高学年なのに「中学生」「middle_school」 |
| senior-high-challenge.json | 「高校生チャレンジ」 | 13/18 | high_school | 13-14 歳=中学生なのに「high_school」 |

**修正方針**: パックを 2 分割 (`elementary-upper-challenge.json` + `junior-challenge.json`) する案、または targetAgeMin/Max を gradeLevel に合わせる案 (シンプル) のいずれか。本仕様書では **後者を採用** (リネームによる import 影響を最小化)。

#### 3.2.2 性別パック 10 件の既存問題 (ADR-0042: 維持決定)

**判断**: ADR-0042 (2026-04-20 accepted) により **性別 15 バリアント構造は維持** する。日本の家庭には性差層と中立層が共存しており、現行 UI は性別必須でないため両層に対応可能。詳細根拠は `docs/design/gender-segmentation-market-research.md` 参照。

ただし既存パックには以下の問題があり、本 Epic で是正する:

| 問題 | 具体例 | 修正方針 |
|------|-------|---------|
| **非対称 (教育機会格差)** | `elementary-boy` にプログラミングあり、`elementary-girl` になし | 両パックに収録。プログラミング男女差 (82%:18%) は社会環境の結果であり、本アプリは**機会平等を提供する立場** |
| **非対称 (表現機会格差)** | `elementary-girl` にダンス・手芸あり、`elementary-boy` になし | 両パックに収録。ダンス・手芸は男女どちらにも基礎的な表現活動 |
| **市場根拠なし** | 各活動に実施率/推奨根拠の記録がない | `marketplace-preset-activity-audit.md` で 1 個ずつ裏付け |
| **中身の薄さ** | `baby-boy` vs `baby-girl` で 17 活動中 15 が同一 (差分 2) | 性別特化差分を 5-8 に拡充。生活習慣・学習は共通、スポーツジャンル・文化慣習で差分を追加 |

**差分付与の原則** (詳細は ADR-0042 Decision §3):

| 活動種別 | 扱い |
|---------|------|
| 教育機会 (プログラミング/外国語/STEM) | 男女共通 (機会平等) |
| スポーツジャンル (サッカー/野球/バレエ/ダンス) | 実施率偏りを反映しつつ、少量は交差収録 (非典型家庭配慮) |
| 生活習慣 (歯磨き/着替え/挨拶) | 全パック共通 |
| 文化慣習 (七五三/こいのぼり/ランドセル) | 性別慣習を反映 |
| 創作・表現 (手芸/工作/絵画) | 男女共通 (表現機会均等化) |

**互換性**: 性別 ID は維持されるため `LEGACY_PACK_ID_MAP` 不要。既存ユーザーの `pack_id='baby-boy'` 等はそのまま動作継続。

#### 3.2.3 持ち物パック皆無 (LP 訴求とのミスマッチ)

LP は「持ち物タブ」を訴求済 (#1164) だが、マーケットプレイス上の `checklists/` 配下には日課ルーティン (morning/evening/weekend × 5 世代) のみで、LP 訴求の **「遠足 / 修学旅行 / 季節行事」** が 0 個。

**追加目標 15+**:
- kinder 季節別 4 種 (春 / 夏 / 秋 / 冬の通園準備)
- elementary 季節別 4 種 + 行事別 (遠足 / 運動会 / 水泳授業 / 修学旅行 / 林間学校)
- junior/senior 行事別 (修学旅行 / 部活合宿 / 体育祭 / 文化祭)
- お出かけ共通 (公園 / 旅行 / 病院 / お祭り / 帰省)

詳細スキーマは `marketplace-content-audit.md` §5.5 参照。

### 3.3 ごほうび 4 段階発達モデル (詳細は `marketplace-content-audit.md` §4)

Erikson 心理社会的発達理論 + 自己決定理論 + 国立教育政策研究所の自己肯定感研究をベースに、年齢相応の動機構造を体系化:

| 世代 | Erikson 段階 | 動機構造 | 報酬設計 |
|------|------------|---------|---------|
| baby (0-2) | 基本的信頼 / 自律性 vs 恥 | **感覚刺激 / 共感応答** | 親の笑顔・拍手・効果音 + 大きなアニメ。シール画像不使用、振動・色変化のみ |
| kinder (3-5) | 自発性 vs 罪悪感 | **承認 / 物理シール** | シール画像が中核 (asset-catalog N/R/SR/UR と整合) + 進化メタファー |
| elementary (6-12) | 勤勉性 vs 劣等感 | **コレクション / バッジ** | バッジ・称号収集 + streak 可視化 + 月間カレンダー (家族内ランキング限定) |
| junior (13-15) | 同一性 vs 役割の混乱 | **自己効力感 / 数値目標** | 数値ダッシュボード + 自己ベスト更新 + 親介入最小化 |
| senior (16-18) | 同一性継続 / 内発化 | **自己決定 / 探究** | 習慣カレンダー + 目標達成スケジュール (アプリは黒子に徹する) |

**実装提案**: 各活動・パック JSON に `rewardStyle: "sensory" | "approval" | "collection" | "self-efficacy" | "autonomy"` メタデータを追加し、UI 演出を年齢に応じて自動切替。

### 3.4 家庭文化的補強 (詳細は `family-discipline-research.md` §3)

学習指導要領カバレッジに加え、**育児雑誌・通信教育・ミサワホーム年齢別お手伝い表** を引いて、日本の家庭運用に密着した活動を追加:

| 世代 | 補強活動 (一部抜粋) | 出典 |
|------|------------------|------|
| baby | ねがえりした / つかまりだちした / ベビーリトミック / 五感あそびした | たまひよ / こどもちゃれんじ baby |
| kinder | こんだてをいっしょにきめた / おみせやさんごっこ / ペットのおせわ | こどもちゃれんじぽけっと / 食生活支援ガイド / 10 の姿 |
| elementary | こめをといだ / 妹弟の世話 / 玄関の靴をそろえた / 1 日の予定を立てた | ミサワホーム表 / HugKum 時間管理 |
| junior | 部活休養日に体を休めた / 体調記録 / 自分でスケジュール管理 | スポーツ庁部活ガイドライン (週 2 日休養 / 週 16h 未満) |
| senior | 自分で病院を予約 / 服薬・体調管理 / マイナンバー管理 / SOS を出せた | 小児科学会成人移行支援コアガイド |

---

## 4. 命名戦略 (How to Name)

### 4.1 推奨置換 (詳細は `marketplace-naming-recommendation.md` §3)

| 文脈 | 採用語 | 理由 |
|------|------|------|
| **ナビ / breadcrumb / 短縮ラベル** | **テンプレート** | Canva/Microsoft Office で保護者層の日常語彙化済 |
| **ページタイトル** | **みんなのテンプレート** | 「みんなの〜」(NHK みんなのうた等) で安心感 + 親しみ |
| **タブ名 (4 種)** | **アクティビティ集 / ごほうび集 / 持ち物リスト / ルール集** | 各タブで用途が明確 |
| **推薦セクション** | **おすすめパック** | キュレーション感 + 5 ペルソナ全 ◎ |
| **インポート CTA** | **使ってみる** | 動詞ベースで強い行動喚起 |
| **junior/senior 高難度バッジ** | **クエスト集** | 本アプリのメインメタファーと整合 |

### 4.2 ペルソナ別語感マトリクス (5 候補抜粋)

凡例: ◎ = 強く推奨 / ○ = 受容可能 / △ = 違和感あり / × = 拒否感

| 候補語 | P1: 3-5 歳児ママ | P2: 小学生児ママ | P3: 中学生児パパ | P4: 高校生児ママ | P5: 祖父母 |
|------|---------------|---------------|----------------|----------------|----------|
| マーケットプレイス (現状) | △ | △ | ○ | △ | **× (語自体わからない)** |
| ストア / コンテンツストア | △ (売買印象) | △ | ○ | △ | × |
| ライブラリ | ○ | ○ | ◎ | ○ | △ (業務的) |
| **テンプレート** | ○ | ◎ | ○ | ◎ | ○ |
| **みんなのテンプレート** | ◎ | ◎ | ○ | ○ | ○ |
| おすすめパック | ◎ | ◎ | ○ | ○ | ○ |
| クエスト集 | △ | ○ | ◎ | ○ | △ |

→ **5 ペルソナ全員で × がない安全な選択** = 「テンプレート」(◎/◎/○/◎/○) と「みんなのテンプレート」(◎/◎/○/○/○)。

### 4.3 不採用理由

| 不採用語 | 主な理由 |
|---------|--------|
| マーケットプレイス | (1) 競合 0 件 (2) 売買・商業ニュアンス過剰 (3) 祖父母世代に通じない (4) Pre-PMF で販売プラットフォームを前面に出す必然性が薄い |
| ストア / コンテンツストア | App Store / Google Play と混同。子供が「お金がいる」と誤解 |
| マイショップ | ショッピングサイト連想 |
| ライブラリ (単独) | IT・業務系。祖父母に弱い (Cozi/Joon の海外定着があり将来余地は残す) |
| コレクション | 既存「シールコレクション」「バッジコレクション」と意味衝突 |

---

## 5. メタデータスキーマ拡張

### 5.1 提案スキーマ (詳細は `family-discipline-research.md` §4)

```ts
interface ActivityItem {
  // 既存
  name: string;
  categoryCode: 'seikatsu' | 'undou' | 'benkyou' | 'souzou' | 'kouryuu';
  basePoints: number;
  icon?: string;

  // 第 1 フェーズ (学習指導要領)
  curriculumDomain?:
    | 'kindergarten:5-domain:health' | 'kindergarten:5-domain:relationships'
    | 'kindergarten:5-domain:environment' | 'kindergarten:5-domain:language'
    | 'kindergarten:5-domain:expression'
    | `elementary:subject:${string}`
    | `junior:special-activity:${string}`
    | `senior:integrated-inquiry:${string}`;
  developmentalGoal?: 'literacy' | 'motor-skill' | 'social-skill' | 'self-management' | 'creativity';

  // 第 2 フェーズ (発達段階別動機)
  rewardStyle?: 'sensory' | 'approval' | 'collection' | 'self-efficacy' | 'autonomy';
  feedbackTone?: 'celebratory' | 'warm' | 'neutral' | 'respectful';

  // 第 2 フェーズ (家庭文化)
  culturalContext?: 'japanese-home-discipline' | 'seasonal-event' | 'school-event' | 'family-tradition';
  magazineReferenceTier?: 'tamahiyo' | 'kodomoe' | 'baby-mo' | 'shimajiro' | 'official';

  // 自律性段階 (小児科学会 成人移行支援コアガイド準拠)
  selfManagementLevel?: 1 | 2 | 3 | 4 | 5;  // 1=完全保護 / 5=完全自律

  // 運用補助
  estimatedMinutes?: 5 | 10 | 30 | 60;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'occasional';
}
```

### 5.2 デフォルト目安 (selfManagementLevel)

| 世代 | 推奨 selfManagementLevel |
|------|----------------------|
| baby | 1-2 |
| kinder | 2-3 |
| elementary | 3 |
| junior | 3-4 |
| senior | 4-5 |

### 5.3 Breaking Change の影響範囲

- 既存 JSON は **すべて optional フィールド追加のみ** で、後方互換性は保たれる (ADR-0029 準拠)
- `MarketplaceItemMeta` 型 (`src/lib/domain/marketplace-item.ts`) に optional 追加
- 既存パック JSON は段階的に拡張メタデータを付与 (PR ごとのスコープで漸進的)

---

## 6. 実装計画 — 単一 PR `refactor/1212-marketplace-overhaul`

### 6.1 Issue 階層 (既存 9 子 Issue)

| # | Issue | スコープ | 依存 | ステータス |
|---|-------|---------|------|----------|
| #1244 | #1212-A 構造リファクタ | `/activity-packs` ルート廃止 + marketplace SSOT 統合 + LEGACY_URL_MAP 追加 + drift test | research 不要 | ✅ **完了** (commit ca0353bf) |
| #1245 | #1212-B 学習指導要領研究 | `marketplace-content-audit.md` 出力 | (前提) | ✅ **完了** |
| #1246 | #1212-C 活動マスタ拡充 | 各世代 × カテゴリ ≥5 件 + メタデータ拡張 | #1245 | ✅ **完了** (15 パック全て 5/5/5/5/5 以上達成) |
| #1247 | #1212-D ごほうび拡充 | 4 段階発達モデル + 30+ テンプレ | #1245 | ✅ **完了** (年齢別 5 パックを 10 件ずつ・動機モデル記述強化) |
| #1248 | #1212-E 持ち物拡充 | 季節別 4 + 行事別 5+ + お出かけ共通 5 | #1245 | ✅ **完了** (既存 15 + event-pool/event-field-trip/event-school-start の 3 パック追加) |
| #1249 | #1212-F 設計書同期 | DESIGN.md / labels.ts / parallel-implementations.md | #1244-#1248 | ✅ **完了** (本セクション更新) |
| #1250 | #1212-G 競合プロダクト調査 | `marketplace-competitor-analysis.md` 出力 | (前提) | ✅ **完了** |
| #1251 | #1212-H ペルソナ適合用語選定 | labels.ts + LP / pamphlet / shared-labels.js | #1250 | ✅ **完了** (MARKETPLACE_LABELS → みんなのテンプレート / テンプレート、NAV マケプレ → テンプレート、LP forbiddenTerms に「マーケットプレイス」「マケプレ」追加) |
| #1252 | #1212-I LP/HP プリセット十全感の表現整合 | site/* 訴求文言 + LP メトリクス調整 | #1248, #1251 | ✅ **完了** (soft-features セクション「みんなのテンプレート」訴求 + 50+ パック / 学習指導要領網羅性を明示) |

### 6.2 単一 PR の段階構成 (commit 単位)

`refactor/1212-marketplace-overhaul` ブランチに以下順で commit:

1. **commit 1**: `refactor: #1212-A SSOT 統合 (activity-packs → marketplace) + テーマ型 9 件廃止 + LEGACY_URL_MAP (URL 前方一致のみ)`
2. **commit 2**: `feat: #1212-H ラベル「マーケットプレイス → みんなのテンプレート」(labels.ts + 並行実装 6 箇所)`
3. **commit 3**: `feat: #1212-C 活動マスタ拡充 (5 世代分の baby/kinder/elementary/junior/senior pack 更新 + メタデータ追加)`
4. **commit 4**: `feat: #1212-D ごほうび 4 段階モデル + reward-sets/ 30+ 体系化`
5. **commit 5**: `feat: #1212-E 持ち物テンプレ 15+ 追加 (季節別 + 行事別 + お出かけ共通)`
6. **commit 6**: `feat: #1212-I LP/HP プリセット十全感表現 (site/index.html + pamphlet.html + shared-labels.js)`
7. **commit 7**: `docs: #1212-F 設計書同期 (DESIGN.md §6 用語辞書 + parallel-implementations.md + 06-UI設計書.md)`
8. **commit 8**: `test: マーケットプレイス drift 検出 + LEGACY_URL_MAP redirect E2E + LP メトリクス更新`

各 commit は `npx biome check . && npx svelte-check && npx vitest run && npx playwright test` を pass させる。

### 6.3 #1212-A 構造リファクタの詳細手順

#### 6.3.1 統合方針

バンドル同梱する活動パックは **5 年齢 × (男 / 女 / デフォルト) = 15 ファイル** のみ。これ以外のテーマ型 9 件は全廃する。

- **統合元**: `src/lib/data/activity-packs/` (legacy 16 ファイル: 5 年齢 × 3 + otetsudai-master)
- **統合先**: `src/lib/data/marketplace/activity-packs/` (新 SSOT)
- **残す 15 ファイル**: baby-first / baby-boy / baby-girl / kinder-starter / kinder-boy / kinder-girl / elementary-challenge / elementary-boy / elementary-girl / junior-high-challenge / junior-boy / junior-girl / senior-high-challenge / senior-boy / senior-girl
- **廃止 9 ファイル**: `otetsudai-master` (legacy + marketplace 両存在) / `study-master` / `exam-prep` / `creative-artist` / `sports-hero` / `outdoor-explorer` / `social-butterfly` / `weekend-fun` / `life-skills-baby` (すべて要件不在のテーマ型)
- **otetsudai-master の活動吸収**: 皿洗い・洗濯物たたみ・ゴミ出し等の家事活動は各年齢パックの `seikatsu` カテゴリに吸収。活動そのものは失わない
- ID は 15 件すべて維持するため `LEGACY_PACK_ID_MAP` は不要
- **デフォルト (中立)** は「性別を回答しない / 未設定」ユーザへの自動適用パック。3 性別ではない

#### 6.3.2 統合マッピング

| 旧 (`activity-packs/`) | 新 (`marketplace/activity-packs/`) | 処理 |
|---------------------|---------------------------------|------|
| `baby-first.json` | `baby-first.json` | 既に marketplace 側に存在 → import 経路統一のみ |
| `baby-boy.json` | `baby-boy.json` (新設) | 性別バリアント維持 (ADR-0042)。新 SSOT に移設 |
| `baby-girl.json` | `baby-girl.json` (新設) | 同上 |
| `kinder-starter.json` | `kinder-starter.json` | 既存 |
| `kinder-boy.json` | `kinder-boy.json` (新設) | 性別バリアント維持 (ADR-0042) |
| `kinder-girl.json` | `kinder-girl.json` (新設) | 同上 |
| `elementary-challenge.json` | `elementary-challenge.json` | 既存 |
| `elementary-boy.json` | `elementary-boy.json` (新設) | 性別バリアント維持 (ADR-0042)。非対称是正でダンス等追加 |
| `elementary-girl.json` | `elementary-girl.json` (新設) | 性別バリアント維持 (ADR-0042)。非対称是正でプログラミング等追加 |
| `otetsudai-master.json` | **削除** | テーマ型のため廃止。家事活動は各年齢パックの `seikatsu` に吸収 |
| `junior-high-challenge.json` | `junior-high-challenge.json` | targetAgeMin/Max=10/12 を 13/15 に修正 (3-way矛盾解消) |
| `junior-boy.json` | `junior-boy.json` (新設) | 性別バリアント維持 (ADR-0042) |
| `junior-girl.json` | `junior-girl.json` (新設) | 同上 |
| `senior-high-challenge.json` | `senior-high-challenge.json` | targetAgeMin=13 を 16 に修正 |
| `senior-boy.json` | `senior-boy.json` (新設) | 性別バリアント維持 (ADR-0042) |
| `senior-girl.json` | `senior-girl.json` (新設) | 同上 |
| (legacy 側に無し) `marketplace/activity-packs/study-master.json` | **削除** | テーマ型 (要件不在)。将来「追加インポート」機能で再検討 |
| (legacy 側に無し) `marketplace/activity-packs/exam-prep.json` | **削除** | 同上 |
| (legacy 側に無し) `marketplace/activity-packs/creative-artist.json` | **削除** | 同上 |
| (legacy 側に無し) `marketplace/activity-packs/sports-hero.json` | **削除** | 同上 |
| (legacy 側に無し) `marketplace/activity-packs/outdoor-explorer.json` | **削除** | 同上 |
| (legacy 側に無し) `marketplace/activity-packs/social-butterfly.json` | **削除** | 同上 |
| (legacy 側に無し) `marketplace/activity-packs/weekend-fun.json` | **削除** | 同上 |
| (legacy 側に無し) `marketplace/activity-packs/life-skills-baby.json` | **削除** | 同上 |

**URL redirect のみ** (ID alias は不要):

- **URL 前方一致** (`LEGACY_URL_MAP`): 1 entry — `/activity-packs` → `/marketplace` (308)
- ID (`baby-boy` 等) は全て新 SSOT にそのまま存在するため、`getMarketplaceItem('activity-pack', 'baby-boy')` は直接解決可能
- **`LEGACY_PACK_ID_MAP` は導入しない** (ADR-0042 により全 ID 維持)

#### 6.3.3 Import 修正対象 (4 ファイル)

```
src/routes/(parent)/admin/activities/+page.server.ts
src/routes/(parent)/admin/packs/+page.server.ts
src/routes/setup/packs/+page.server.ts
src/lib/domain/activity-pack.ts
```

すべて `$lib/data/activity-packs` → `$lib/data/marketplace` に書き換え、`getActivityPack(id)` → `getMarketplaceItem('activity-pack', id)` に置換。

#### 6.3.4 ルート廃止 (4 ファイル + 2 ディレクトリ)

```
src/routes/activity-packs/+page.svelte
src/routes/activity-packs/+page.server.ts
src/routes/activity-packs/[packId]/+page.svelte
src/routes/activity-packs/[packId]/+page.server.ts
```

LEGACY_URL_MAP に `/activity-packs` → `/marketplace` を追加 (1 entry, 前方一致で `/activity-packs/[packId]` も自動カバー)。`tests/e2e/legacy-url-redirect.spec.ts` で `/activity-packs` ルート + `/activity-packs/baby-boy` 等 11 パターンを E2E 検証。

#### 6.3.5 drift 検出 unit test

`tests/unit/marketplace-pack-coverage.test.ts` を新設し、以下を CI で確認:

- marketplace activity-packs の ID 集合が **ちょうど 15 件** (デフォルト 5 + 男の子 5 + 女の子 5) と一致すること
- 禁止 ID `otetsudai-master` / `study-master` / `exam-prep` / `creative-artist` / `sports-hero` / `outdoor-explorer` / `social-butterfly` / `weekend-fun` / `life-skills-baby` の 9 件が存在しないこと
- 旧 activity-packs の活動内容 (otetsudai-master の家事活動を含む) がすべて marketplace 側 15 パックのいずれかに存在すること
- 性別パック ID `baby-boy` / `baby-girl` / `kinder-boy` 〜 `senior-girl` の 10 件が `getMarketplaceItem('activity-pack', id)` で直接解決できること
- `LEGACY_URL_MAP` に `/activity-packs` エントリが存在すること
- 非対称是正: `elementary-boy` と `elementary-girl` 双方にプログラミング活動が存在すること / 双方にダンスまたは表現系活動が存在すること

---

## 7. LP 整合・並行実装チェック

### 7.1 並行実装ペア (CLAUDE.md §並行実装チェックリストに該当)

| 領域 | 対応ファイル | 同期内容 |
|------|------------|---------|
| **UI ラベル・用語 (#1212-H)** | `src/lib/domain/labels.ts` + `site/index.html` + `site/pamphlet.html` + `site/shared-labels.js` + `tutorial-chapters.ts` | 「マーケットプレイス」→「みんなのテンプレート」/「テンプレート」 |
| **本番画面 → デモ画面** | `src/routes/(parent)/admin/packs/` + `src/routes/demo/admin/packs/` | パック一覧 UI 同期 |
| **デモガイド** | `src/lib/features/demo/demo-guide-state.svelte.ts` | テンプレート用語に沿った文言 |
| **チュートリアル** | `src/lib/data/tutorial-chapters.ts` | 「マーケットプレイスを使ってみよう」→「テンプレートを使ってみよう」 |
| **ナビゲーション** | `AdminLayout` + `AdminMobileNav` + `BottomNav` + ボトムナビ | NAV_ITEM_LABELS の「テンプレート」適用 |

### 7.2 LP メトリクス ratchet (#1163)

`scripts/measure-lp-dimensions.mjs` の `THRESHOLDS` は変更しない (引き上げ禁止)。ただし `forbiddenTerms` に **「マーケットプレイス」** を追加検討 (移行完了後の commit 8 で適用)。

### 7.3 LP 訴求 (#1212-I)

LP の機能訴求セクションに以下を追加:

```
🎁 みんなのテンプレート
   ・すぐ使える 200+ パック (アクティビティ / ごほうび / 持ち物 / ルール)
   ・幼児から高校生まで 5 世代対応
   ・学習指導要領 + 育児雑誌レベルの網羅性
```

LP スクリーンショット (#1129 のパイプラインで撮影) も同訴求に合わせて再撮影。

---

## 8. 成果指標 (KPI) と効果検証

### 8.1 短期 KPI (リリース後 4 週間)

| 指標 | 現状 (推定) | 目標 |
|------|-----------|------|
| 初期セットアップ完了率 (新規 → 初パック import) | (未計測) | 60%+ |
| ユーザー平均インポートパック数 | (未計測) | 3+ パック / ユーザー |
| `/activity-packs` redirect 経路の access 数 | (未計測) | リリース後 4 週で 10% 以下に減衰 |
| 「テンプレート」ナビ命中率 | N/A | 旧「マーケットプレイス」と同等以上 |

### 8.2 中期 KPI (リリース後 3 ヶ月)

| 指標 | 目標 |
|------|------|
| Free → Standard コンバージョン率 | (現状ベースラインの) +30% |
| カスタム活動を作成するユーザー比率 (custom-need の発火率) | 40%+ |
| 持ち物テンプレ import 数 (LP 訴求の効果計測) | 30%+ ユーザーが 1 回以上 import |

### 8.3 効果検証の計装

- `events` テーブル (#1121 の external health check 計装と同パターン) に以下イベントを追加:
  - `marketplace.import` (item_type, item_id, persona, plan_tier)
  - `marketplace.browse` (tab, persona)
  - `template.naming.exposure` (where: nav | breadcrumb | page-title)

---

## 9. リスク・緩和策

| # | リスク | 影響度 | 緩和策 |
|---|------|--------|--------|
| R1 | 性別バリアント維持により、「性別で分けるプロダクト」と誤認される層 (電通 24.5% 購入拒否層) | 中 | セットアップフローで「中立パック」も同等に選択肢として提示。「性別で選ばない」誘導を UX に組み込む。中立パックの推薦表示を強化 |
| R2 | 「マーケットプレイス」呼称変更で SSOT 移行漏れ → 用語混在 | 中 | `grep -r "マーケットプレイス" src/ site/` を CI で 0 件確認 (LP `forbiddenTerms` に追加) |
| R3 | メタデータスキーマ追加 (`rewardStyle` 等) で型エラー多発 | 低 | 全フィールド optional で後方互換性確保 |
| R4 | LP 訴求変更が LP メトリクス閾値 (mobileHeight 15000px) を破る | 低 | 訴求は既存セクションに追記する形 (新セクション追加しない) |
| R5 | E2E redirect テストで 11 件全ての検証が flaky | 中 | parametrized test で 1 件の失敗でも全件落ちる構造を避ける |
| R6 | 200+ プリセット投入で JSON ファイル肥大 → bundle size 増 | 低 | `index.ts` での import 量計測。1MB 超なら code-splitting 検討 |
| R7 | 命名変更でチュートリアル / ガイド文言の翻訳漏れ | 中 | parallel-implementations.md §UI ラベル の全箇所を grep で確認 |
| R8 | コンテンツ拡充で QA 負荷増 (5 世代 × 全パック動作確認) | 高 | E2E は smoke 検証に絞り、内容妥当性は研究レポート §3 を引きの根拠とする |

---

## 10. ADR 起票方針

本 Epic は ADR-0035 (設計ポリシー先行確認フロー) に従い、以下 2 件の ADR を **実装前に PO 合意取得** する:

### ADR-NNNN-1: マーケットプレイス命名「みんなのテンプレート」採用と SSOT 移行

- 文脈: 競合 0 件採用 + 5 ペルソナ語感調査 + 売買ニュアンス排除
- 決定: ナビ「テンプレート」/ ページタイトル「みんなのテンプレート」/ タブ「アクティビティ集 / ごほうび集 / 持ち物リスト / ルール集」/ 推薦「おすすめパック」
- 移行: labels.ts + LP + tutorial 並行実装、deprecation 期間なし (一括変更)
- 結果: ADR-0037 (labels.ts SSOT) と整合

### ADR-0042: マーケットプレイス性別バリアントは維持、市場データで中身を見直す (accepted 2026-04-20)

- 文脈: 日本の家庭には性差層と中立層が共存 (revealed preference で明確な性差、stated preference で「押し付け反対」88.5%)。現行 UI は性別必須でないため両層に対応可能
- 決定: 性別 15 バリアント (中立 5 + 男の子 5 + 女の子 5) を維持。各活動を市場データで裏付け、既存の教育機会非対称 (プログラミング / 表現活動) を是正
- 移行: ID 変更なし。LEGACY_PACK_ID_MAP 不要
- 結果: `docs/design/marketplace-preset-activity-audit.md` で活動 1 個ずつ市場根拠を記録

---

## 10-B. 実装状況スナップショット (2026-04-20)

### 10-B.1 活動パック 15 件のカテゴリ最小件数

全 15 パックが **各カテゴリ ≥5 件** を達成。`scripts/verify-pack-coverage.mjs` で検証。

| pack | total | seikatsu | undou | benkyou | souzou | kouryuu |
|------|-------|----------|-------|---------|--------|---------|
| baby-first | 26 | 6 | 5 | 5 | 5 | 5 |
| baby-boy | 26 | 6 | 5 | 5 | 5 | 5 |
| baby-girl | 26 | 6 | 5 | 5 | 5 | 5 |
| kinder-starter | 30 | 10 | 5 | 5 | 5 | 5 |
| kinder-boy | 27 | 7 | 5 | 5 | 5 | 5 |
| kinder-girl | 27 | 7 | 5 | 5 | 5 | 5 |
| elementary-challenge | 35 | 15 | 5 | 5 | 5 | 5 |
| elementary-boy | 28 | 7 | 5 | 6 | 5 | 5 |
| elementary-girl | 28 | 7 | 5 | 6 | 5 | 5 |
| junior-high-challenge | 25 | 5 | 5 | 5 | 5 | 5 |
| junior-boy | 25 | 5 | 5 | 5 | 5 | 5 |
| junior-girl | 25 | 5 | 5 | 5 | 5 | 5 |
| senior-high-challenge | 25 | 5 | 5 | 5 | 5 | 5 |
| senior-boy | 25 | 5 | 5 | 5 | 5 | 5 |
| senior-girl | 25 | 5 | 5 | 5 | 5 | 5 |

### 10-B.2 ごほうびセット (年齢別 5 + テーマ系 5 = 10 件)

年齢別パックは 4 段階動機モデル (感覚刺激 / 承認・シール / 達成記録 / 自己効力感 / 自己決定) に沿った記述へ書換、各 10 件に拡充。

| pack | 動機段階 | rewards 件数 |
|------|---------|------------|
| toddler-rewards (0-3) | 感覚刺激 / 親子共感 | 10 |
| kinder-rewards (3-5) | 承認・シール・自発性 | 10 |
| elementary-rewards (6-9) | 達成記録・コレクション | 10 |
| junior-rewards (10-12) | 自己効力感・数値目標 | 10 |
| senior-rewards (13-18) | 自己決定・外的成果連動 | 10 |
| experience/screen-time/creative/food/privilege (横断) | テーマ系 | 既存維持 |

### 10-B.3 持ち物チェックリスト (18 件)

既存 15 件 (朝 × 5 / 晩 × 5 / 週末 × 5) + 本 Epic で新設した **行事系 3 件** で計 18 件。

| pack | timing | 用途 |
|------|--------|------|
| event-pool | daily | プール授業・水泳教室 |
| event-field-trip | daily | 遠足・校外学習 |
| event-school-start | daily | 入園・入学準備 |

---

## 11. 残課題・将来 Epic への送り

### 11.1 本 Epic スコープ外 (将来 Epic 候補)

| # | テーマ | 理由 |
|---|------|------|
| F1 | **追加インポート機能 (テーマ型プリセット拡張)** | 本 Epic で廃止した 9 件 (勉強特化 / 受験 / 創作 / スポーツ / アウトドア / 社会性 / 週末 / 家事 / 乳幼児生活) をバンドルに戻すのではなく、**既存プリセットを置換せず追加する** 拡張機能として再設計。市場調査と追加 ADR を起票してから着手。ごほうびプリセット・持ち物プリセットのテーマ型拡張も同じ機能で扱う |
| F1' | 性別バリアント運用データのウォッチ | ADR-0042 で維持決定。3 ヶ月運用後、各バリアントの実 import 数/継続率を見て統合要否を再評価 |
| F2 | アバター進化 (たまご → ひよこ → こども) UI | asset-catalog 画像化前提 |
| F3 | 進研ゼミ風 7 段階景品交換 | 金銭交換は Pre-PMF 範囲外 (ADR-0034) |
| F4 | 月次「すごいキミ」表彰 (家族内ランキング) | 既存 `child-stats` に集計データはあり、UI 未実装 |
| F5 | 簡易ユーザーテスト (社内モニター 5-10 名 × 30 分) で命名最終確定 | naming-recommendation.md §5 補足記載の通り、定性インタビュー未実施 |
| F6 | LP のコンテンツ訴求セクションに「200+ プリセット」「学習指導要領準拠」のバッジ追加 | LP メトリクス制約を超えない範囲で |

### 11.2 識別不可能だった競合

`marketplace-competitor-analysis.md` §5 不採用情報源に記載の通り、「みつごこ」「がんばるーむ」「Tinkle」「Joy Of Cleaning」は本リサーチで特定できず。原典 (URL / 開発元) が判明次第、追加調査を起票推奨。

---

## 12. 出典総覧

本企画書は以下 4 リサーチレポート (合計 150+ 一次出典) に基づく。詳細は各レポートの §5 / §7 を参照:

1. **`docs/design/marketplace-content-audit.md`** §7 (34 出典)
   - 文科省: 幼稚園教育要領 / 小・中・高学習指導要領 / 「早寝早起き朝ごはん」運動 / 子どもの読書活動推進
   - 厚労省: 健康づくり睡眠ガイド 2023 / 身体活動・運動ガイド 2023 / 保育所保育指針対照表
   - スポーツ庁: 全国体力・運動能力等調査 / 体力・運動能力調査
   - こども家庭庁: 令和 5 年乳幼児身体発育調査 / 未就学児の睡眠指針
   - 国立成育医療研究センター / 国立教育政策研究所 / 日本小児科学会 / 日本スポーツ協会

2. **`docs/design/marketplace-competitor-analysis.md`** §5 (28 出典)
   - 海外: Habitica / S'moresUp / Cozi / OurHome / Joon / Greenlight / FamZoo
   - 国内アプリ: ファミポイ / ママペイ / やることカード (LITALICO)
   - 国内通信教育: 進研ゼミ努力賞 / スマイルゼミ マイキャラ
   - 紙ベース: ぷりんときっず / Canva / Microsoft Office / MimiLy
   - レビュー: Common Sense Media / G2 / Choosing Therapy

3. **`docs/design/family-discipline-research.md`** §5 (27 新規 + 第 1 フェーズ再掲)
   - 公的: こども家庭庁未就学児睡眠指針 / 厚労省乳幼児生活習慣 / 国立保健医療科学院栄養ガイド / 文科白書 / 小児科学会成人移行支援 / スポーツ庁部活ガイドライン
   - 育児雑誌: たまひよ / こどもちゃれんじ baby/ぷち/ぽけっと/ほっぷ/すてっぷ/じゃんぷ / kodomoe / Baby-mo
   - 民間: HugKum / こどもまなび☆ラボ
   - 自治体・住宅: ミサワホーム年齢別お手伝い表 / 保育のひきだし / シャチハタ

4. **`docs/design/marketplace-naming-recommendation.md`** §5 (23 出典)
   - 用語定義: KDDI / ITreview / セゾンテクノロジー / FoundX
   - 競合呼称: Cozi / Joon / Habitica / OurHome / S'moresUp
   - 国内学習: 進研ゼミ / スマイルゼミ
   - 国内テンプレ: Canva 持ち物リスト / 命名書 / Microsoft しおり / ぷりんときっず
   - UX: Asana / Wikipedia / DreamOnline

---

## 13. 改訂履歴

| 日付 | 改訂内容 | 担当 |
|------|---------|------|
| 2026-04-20 | 初版作成 (4 リサーチレポートを統合した企画書・仕様書) | Claude (PO 補佐) |
| 2026-04-20 | ADR-0042 「性別バリアント維持」決定を反映 (§3.2.2 / §6.3 / §9 R1 / §10 / §11 F1) | Claude (PO 補佐) |
| 2026-04-20 | **テーマ型 9 件 (otetsudai-master 含む) 全廃決定を反映** (§0.1 / §0.3 / §6.2 commit 1 / §6.3.1-6.3.2 / §6.3.5 drift test / §11.1 F1)。バンドル同梱は **5 年齢 × 男/女/デフォルト = 15 パックのみ** に純化。テーマ型は将来の「追加インポート」機能で扱う | Claude (PO 補佐) |
