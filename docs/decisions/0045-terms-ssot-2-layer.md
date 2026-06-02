# 0045. terms.ts SSOT 2 階層化原則 (atom / compound 責務分離)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-07 |
| 起票者 | Takenori-Kusaka |
| 関連 Issue | #1916 (Phase 1 atom 抽出) / #1917 (template literal parser) / #1922 (本 ADR 起票) |
| 関連 ADR | ADR-0009 (本 ADR で supersede) / ADR-0014 (labels / i18n 機構選定) / ADR-0010 (Pre-PMF scope) / ADR-0013 (LP truth from implementation) |

## 1. コンテキスト

ADR-0009 で「`src/lib/domain/labels.ts` を SSOT とする」原則を確立したが、**SSOT 内部の構造化が不在**で次の実害が継続発生していた。

### 1.1 単一 namespace 混在の限界

`labels.ts` は ≈6700 行 / 135 namespace まで肥大し、内部に **2 種類の異なる責務**が混在していた:

| 種別 | 例 | 性質 |
|------|----|------|
| atom (用語) | `PLAN_LABELS.standard = 'スタンダードプラン'`、`TRIAL_TERMS.duration = '7日間'` | 単一の名詞 / 数値 / 単位。複数 compound から再利用される |
| compound (表示文字列) | `TRIAL_LABELS.upgradeGuard = 'スタンダードプラン以上で…'`、`LP_HERO_PRICE_BAND_LABELS.subline = '7日間無料体験 / クレカ登録不要'` | 複数 atom を文に組み立てた表示用全文 |

両者が同じ namespace 階層に並ぶことで、用語変更時に「atom を変えたら compound も変わるはず」という連動が**機械検出できない**まま放置された。

### 1.2 直近の実害

| 事象 | 件数 | 内訳 |
|------|------|------|
| アプリ本体 `*.svelte` / `*.ts` での「スタンダードプラン以上で…」直書き | 15+ | `PLAN_LABELS.standard` を見ずに文字列リテラルで書かれた compound |
| LP HTML の fallback テキスト (`<span data-label-key="…">スタンダードプラン</span>`) | 多数 | `shared-labels.js` 注入失敗時の fallback が手動同期で labels.ts と乖離 |
| 法務文書 (privacy.html / terms.html / tokushoho.html) のプラン名表記 | 数件 | ADR-0025 で SSOT 化対象に追加されたが、atom 単位の集約がなく compound レベルで重複定義 |

### 1.3 PO 期待

> 「用語集 (atom) と表示文字列 (compound) を 2 階層で分離せよ。atom 1 行を変えれば LP / アプリ本体 / 法務文書すべてに伝播する状態を作れ。」

ADR-0009 の SSOT 原則は維持しつつ、**SSOT 内部に 2 階層構造を導入**することで責務分離する必要がある。

## 2. 検討した選択肢（OSS / 確立パターン 2 件以上 — #1350）

### 選択肢 A: `src/lib/domain/terms.ts` 別ファイル分離（採用）

- 概要: atom 専用ファイル `terms.ts` を新設し、`labels.ts` (compound) は `import { PLAN_FULL_TERMS, TRIAL_TERMS } from './terms'` で参照する 2 階層構造
- 確立パターン: **DDD Value Object** + **Atomic Design (Atom / Molecule)** の組み合わせ。CSS の **Base → Semantic → Component** 3 層トークン (ADR-0042 / `docs/DESIGN.md` §2) と同型の責務分離パターン
- メリット: (1) atom の単独責務化で **import 経路** が機械検出可能（`grep "from './terms'"` で参照箇所を全列挙できる）、(2) ファイル境界による責務分離で 6700 行肥大の温床を断つ、(3) Phase 5 F1 (#1918) で「リテラル直書き禁止 CI」を実装可能（atom 値を含む文字列が compound 外に存在したら fail）
- Pre-PMF コスト (ADR-0010): 導入工数 低（Phase 1 で 86 行の terms.ts 新設 + labels.ts に import 1 行）、学習コスト 低、bundle size 影響 ゼロ（同一 module graph）、長期保守性 **高**

### 選択肢 B: `labels.ts` 内 section 分離（rejected）

- 概要: 同一ファイル内で `// === ATOM SECTION ===` / `// === COMPOUND SECTION ===` のコメント境界で論理分離
- 確立パターン: コメントベースの section 分割（一般的だが正規化されたパターン名なし）
- メリット: ファイル数が増えない、import 経路変更不要
- デメリット: (1) 6700 行の単一ファイル肥大は継続、(2) section 境界が**機械検出困難**（コメント走査が必要で、TypeScript module 機構の保証なし）、(3) atom と compound を同時 export することで「どれが atom か」の境界が grep で見えない、(4) Phase 5 F1 CI が「直書き検出は section 解析が前提」となり実装が脆い
- Pre-PMF コスト: 導入工数 ゼロ、学習コスト ゼロ、長期保守性 **低**（境界が緩い）

### 選択肢 C: i18n ライブラリ採用（i18next / FormatJS / Paraglide）（rejected）

- 概要: ADR-0014 で検討した OSS i18n 機構を Phase 1 で先行投入し、atom / compound を ICU MessageFormat や ICU plural などで構造化
- メリット: 将来の多言語化に直結、ICU で複数形・性別・数値書式が宣言的
- デメリット: (1) **ADR-0014 で「Pre-PMF Phase 1 では未採用、Phase 2 以降の機構選定段階で導入」と決定済**、本 ADR の atom 分離は ADR-0014 機構導入の**前段下準備**であり、両者は段階適用関係、(2) 多言語化要件が現時点で未確定 (日本語のみ)、(3) i18n ライブラリ前提だと atom 構造化と機構導入が単一 PR に膨らみ、リスク分散が壊れる
- Pre-PMF コスト: 導入工数 高（学習 + LP 経路確立 + 全 namespace 移行）、学習コスト 高、長期保守性 高（ただし Phase 段階性を壊す）

### 選択肢 D: 現状維持（rejected）

- 概要: ADR-0009 のまま atom / compound 混在を継続、直書き 15+ 件は個別 PR で都度 PLAN_LABELS 参照に置換
- デメリット: (1) SSOT 違反の **再発を防ぐ機械機構が存在しない**、(2) atom 1 行修正で全コンテンツ伝播する利点を享受できない、(3) compound 側の手動同期 risk が残置、(4) Phase 5 F1 CI が「既存違反を baseline pin する」しかなく構造改善にならない

### 参考: 確立パターン照合

- **DDD Value Object**: atom = primitive 用語の Value Object 化に相当
- **Atomic Design**: atom (terms.ts) → molecule (labels.ts compound) → organism (svelte component) の階層
- **CSS 3 層トークン (ADR-0042)**: Base → Semantic → Component と同型構造の用語版
- **i18next ICU MessageFormat**: 将来 ADR-0014 機構導入時に compound 側を ICU 化する経路は維持

## 3. 決定

**選択肢 A: `src/lib/domain/terms.ts` 別ファイル分離を採用**。

### 3.1 階層構造

```
terms.ts (atom 専用、≈86 行)
   ↓ import
labels.ts (compound、≈6700 行)
   ↓ import
*.svelte / *.ts (アプリ本体) / shared-labels.js (LP) / *.html (法務)
```

### 3.2 Phase 進捗

| Phase | 内容 | ステータス | 関連 |
|-------|------|-----------|------|
| Phase 1 | `terms.ts` 新設 + 6 namespace 集約 (PLAN/PRICE/TRIAL/CANCEL/FREE/FULL) | ✅ 完了 2026-05-06 | #1916 / #1917 |
| Phase 2 | アプリ本体 `*.svelte` の compound 直書き 15+ 件を PLAN_LABELS / TRIAL_LABELS 参照に置換 | ⏳ 未着手 | #1925-1940 (umbrella) |
| Phase 3 | LP 各 LP_*_LABELS namespace を terms.ts atom 参照に書換 | ⏳ Phase 2 後続 | 別 Issue 起票予定 |
| Phase 4 | 法務文書 (privacy/terms/tokushoho) を terms.ts atom 経由 SSOT 化 | ⏳ Phase 3 後続 | 別 Issue 起票予定 |
| Phase 5 F1 | リテラル直書き禁止 CI（atom 値を含む文字列が compound 外に存在したら fail） | ⏳ Phase 2 後続 | #1918 |
| Phase 6 G1 | 本 ADR 起票 | ✅ 本 PR | #1922 |

### 3.3 適用原則

1. **新規 atom 追加**: `terms.ts` に追加 → `labels.ts` の compound から import 参照
2. **compound 表示文字列**: `labels.ts` のみ。atom 値の文字列リテラル直書き禁止（template literal で `${PLAN_FULL_TERMS.standard}以上で…` と組み立てる）
3. **アプリ本体 (`src/**` 以外)**: `labels.ts` の compound 定数 / 関数を参照する原則は ADR-0009 から継続
4. **LP / 法務 fallback**: Phase 3-4 完了まで暫定的に手動同期、それ以降は terms.ts 経由 SSOT

### 3.4 検出・強制

- **Phase 5 F1 CI** (`scripts/check-terms-literal-leak.mjs`、#1918 で実装予定): atom 値（'スタンダードプラン' / '¥500' 等）を含む文字列リテラルが compound 外（`*.svelte` / `*.ts` 本体）に存在したら CI fail
- **PR レビュー**: 「直書きを見たら terms.ts に atom があるか確認」を `qa-session.md` に追加
- **既存違反 baseline**: Phase 1 完了時点の 15+ 件は Phase 2 で順次撲滅、新規違反は CI で 0 件強制

## 4. 結果

- **用語変更 1 行修正で全コンテンツ伝播**: 例えば `terms.ts` の `PLAN_FULL_TERMS.standard = 'スタンダードプラン'` を変更すると、Phase 2-4 完了後はアプリ本体 / LP / 法務文書すべてに自動伝播
- **責務分離による可読性向上**: 「用語そのものを変えたい」場合は terms.ts (86 行) のみ精読すれば足り、6700 行 labels.ts の全走査が不要
- **CI による再発防止 (Phase 5)**: 直書きが追加された瞬間に PR で fail し、レビュー前に検出
- **トレードオフ**: import 経路が 1 段増える（`terms.ts → labels.ts → component`）が、ファイル境界による責務分離の利点が上回る
- **ADR-0014 機構導入時の互換性**: i18n ライブラリ導入時も terms.ts は ICU の atom 入力として再利用可能

## 補遺: DESIGN.md は全 export をミラーしない（2026-06-03）

`docs/DESIGN.md` §6 は AI エージェントが最初に読むデザイン SSOT だが、当初は `scripts/generate-design-md-sections.mjs` が `labels.ts` の全 export 名（190+）と `terms.ts` の全 atom 値を AUTOGEN ブロックとして列挙していた。これが DESIGN.md を 44k 文字まで肥大させ、Claude Code の「Large file がパフォーマンスに影響」警告（40k 超）を恒常的に発生させていた。

**決定**: DESIGN.md §6 は「ルール + SSOT 参照 + 主要例」のみを保持し、**全 export のミラーは持たない**。

- **labels 列挙（AUTOGEN:labels）は廃止**。理由: (1) 値を持たない export 名の羅列で参照価値が低い、(2) 再生成のたびに肥大、(3) **SSOT 整合性は本 ADR §3.4 の CI（`check-no-plan-literals` / `check-hardcoded-strings`）が担保しており、DESIGN.md の列挙は load-bearing ではない**。発見性は `grep -n "_LABELS" src/lib/domain/labels.ts` / IDE 補完で代替する。
- **terms 値（AUTOGEN:terms）は保持**。理由: atom の正規文字列（`'¥500'` / `'7日間'` 等）そのものが §1.2 の「直書きしてはならない対象」を可視化し、本 ADR の再発防止意図と直結するため。ただし書式は 1 namespace = 1 行にコンパクト化する。
- **colors / primitives は保持**（コンパクト書式）。app.css / primitives ディレクトリの即時参照として有用。

この方針は ADR-0009 / 本 ADR の「SSOT はコード（terms.ts / labels.ts）」という原則と矛盾しない。DESIGN.md はルールの SSOT であり、インベントリの SSOT ではない。

## 関連

- ADR-0001（設計書 SSOT）— 本 ADR は labels 領域への 2 階層構造化
- ADR-0009（labels.ts SSOT 化原則）— **本 ADR で supersede**（SSOT 原則は維持、内部構造を 2 階層化）
- ADR-0010（Pre-PMF scope）— Phase 段階適用で導入コスト分散
- ADR-0013（LP truth from implementation）— terms.ts atom が LP 文言の SSOT 起点
- ADR-0014（labels / i18n 機構選定）— Phase 2 以降の機構導入で terms.ts が atom 入力源として再利用
- ADR-0042（LP CSS Spacing/Layout 3 層トークン）— 同型の責務分離パターン（Base → Semantic → Component）
