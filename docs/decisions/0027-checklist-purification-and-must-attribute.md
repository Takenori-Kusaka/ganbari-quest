# 0027. チェックリスト責務の純化と must 属性実装による責務分離

- **Status**: Accepted
- **Date**: 2026-04-30
- **Related Issue**: #1711 (R3-D), #1709 (umbrella), #1755 / #1756 (#1709-A/B), #1758 (#1709-D)
- **Related ADRs**: ADR-0009 (labels.ts SSOT 化原則), ADR-0010 (Pre-PMF スコープ判断), ADR-0011 (baby モードは親の準備モード), ADR-0012 (Anti-engagement 原則), ADR-0013 (LP truth from implementation)

## 背景

#1168 で導入された `checklist_templates.kind` 列（`'item'` / `'routine'` の 2 種）は、子供 UI のチェックリスト画面で「持ち物」と「ルーティン（生活習慣）」を 1 画面のタブ切替で扱う設計だった。しかし、この設計は以下の構造的欠陥を抱えていた。

1. **二重管理の発生**: 子供 UI 側で「ルーティン」と「活動マスタ」が並列に存在し、保護者が「歯みがき」「お片付け」のような同じ習慣を 2 箇所で管理する必要があった。Anti-engagement 原則 (ADR-0012) に反して保護者の運用負荷が肥大化した。
2. **意味境界の曖昧さ**: 「持ち物 (item)」は物理アイテム集合、「ルーティン」は時間帯ごとの行動セット、両者を同一スキーマで扱う合理性が薄かった。
3. **LP 訴求の混乱**: 「持ち物／朝夜の習慣 合計 3 個」のような統合表現が pricing 比較表 / pamphlet に残存し、購入後の「結局何ができるのか」の落差を生んでいた（#1710 R3-C）。
4. **マーケットプレイスプリセット重複**: `marketplace-preset-checklist-audit.md` が「年齢×timing 15 セット」を網羅していたが、活動マスタ側のプリセットと意味的にほぼ重複していた（歯みがき / 着替え / 宿題 / 22 時就寝 等）。

PO ブレストで案 A〜D を比較した結果、**案 A（kind=routine 削除 + 活動 priority='must' 属性導入）** が以下の理由で採用された:

- ADR-0010 Pre-PMF（利用者ゼロ前提）で破壊的 schema 変更を許容できる
- 機構統合により複雑度が下がる（チェックリストは持ち物専用、ルーチン的な役割は活動マスタの 1 属性）
- 子供 UI 上の「今日のおやくそく」セクションで must 活動を強調表示する形に整理でき、コアループ訴求が単純化する
- LP 訴求が「持ち物 = event-* プリセット 3 件 / 毎日 must = 活動 priority 属性」に明確に分離される

## 決定

以下の構造的変更を**Pre-PMF 段階で実施する**（破壊的 schema 変更を ADR-0010 で許容、利用者ゼロ）。

### 1. DB schema 変更（#1755 #1709-A）

- `checklist_templates.kind` 列を削除（`'item'` 純化）
- `activities.priority TEXT NOT NULL DEFAULT 'optional'` 列を追加（値: `'must'` = 「今日のおやくそく」 / `'optional'` = ふつうの活動）
- 既存 `kind='routine'` レコードは migration で drop（marketplace 由来テンプレートは活動 priority='must' 由来に移管）
- DynamoDB `activity-repo.ts` も priority 属性を取扱う本実装（stub 禁止 #1021 / ADR-0024）

### 2. UI 仕様変更（#1756 #1709-B/C）

- 親 admin 側: `/admin/activities/[id]/edit` 独立 URL に分離 + `must` トグル checkbox（`data-testid="must-toggle-checkbox"`）追加。一覧 Badge `data-testid="must-badge"` で must 活動を識別
- 子供 UI 側: ホーム画面冒頭に「今日のおやくそく」セクション追加。must 活動の達成率に応じた年齢別ボーナス（preschool/elementary +5 / junior/senior +3 / baby 0）
- 子供チェックリスト画面 (`/(child)/checklist`) は持ち物のみの 1 リスト表示に純化（旧 `kindOrder` 削除）

### 3. マーケットプレイスプリセット純化（#1758 #1709-D）

- `marketplace/checklists/` 配下を **event-* 3 件のみ** に純化（`event-field-trip` / `event-pool` / `event-school-start`）
- 旧 `morning-* / evening-* / weekend-* × 4 年齢 = 12 件` は全廃止
- 活動マスタ側に `mustDefault: true` 属性を持つプリセットを追加し、親 setup フロー / admin/packs UI で「今日のおやくそく推奨を採用」チェックボックスから登録できる動線を提供

### 4. LP 訴求の純化（#1708 R3-A / #1710 R3-C）

- LP `site/index.html` machine-tour: 4 → 3 カードに圧縮（旧 ③ ルーチン-CL カード削除）
- LP H2: 「コアループを支える **3** つの工夫」
- LP 比較表 / pamphlet: 「持ち物／朝夜の習慣 合計 3 個」を「持ち物チェックリスト 3 個/子まで」に純化
- `scripts/measure-lp-dimensions.mjs` の `STRICT_FORBIDDEN_TERMS` に `'ルーティンチェックリスト'` を追加（再発防止 CI Gate）

### 5. 設計書 retroactive 同期（#1711 R3-D / 本 ADR）

- `marketplace-preset-checklist-audit.md` rewrite（§1.1 年齢×timing 表削除 + §3 維持方針を event-* のみに）
- `06-UI設計書.md` チェックリスト節を持ち物純化記述に統一
- `08-データベース設計書.md` `kind` 列削除を反映 + 改訂履歴 5.11 / 5.12 追加
- `lp-content-map.md` §4.2 [04] / §6 ゲーミフィケーション要素表を 3 つの工夫構成に同期

## 検討した選択肢

| 案 | 内容 | 採否 |
|---|---|---|
| **案 A（採用）** | kind=routine 削除 + 活動 priority='must' 属性導入 | **採用**: Pre-PMF 段階で破壊的変更を許容できる + 機構統合で複雑度減 |
| 案 B | kind=routine 維持 + LP/設計書を整合 | 棄却: 二重管理問題が解消されない |
| 案 C | 子供 UI に「ルーティン」タブを残しつつ活動マスタとリンクする hybrid | 棄却: スキーマ複雑度が増える + 「同じ習慣を 2 箇所で管理する」UX 問題が解決しない |
| 案 D | チェックリスト機能全廃止 | 棄却: 持ち物（特殊持ち物 = event 系）の独立価値が失われる |

## 影響

### Positive

- **設計の単純化**: 「持ち物 = 物理アイテム集合 = checklist」「ルーチン = 毎日の活動 = activities.priority='must'」の意味境界が明確化
- **既存ユーザデータ削除許容**: Pre-PMF 段階のため許容（ADR-0010）
- **LP 訴求純化**: 持ち物 vs 毎日 must が明確に分離され、購入後の落差が解消
- **保護者運用負荷減**: 「同じ習慣を 2 箇所で管理する」二重管理が消える

### Negative / Risk

- **既存チェックリスト routine データの drop**: Pre-PMF で利用者ゼロのため実質影響なし。万一外部利用が判明した場合は migration を再実行する手順を `08-データベース設計書.md §5.11` に記載
- **`kind` を再導入したくなる将来圧力**: 設計原則「`kind` カラムは復活させない」を `08-データベース設計書.md §checklist_templates 設計原則` に明記。再導入には本 ADR を supersede する新 ADR が必要

## 検証

- [x] `grep -rn "ルーティンチェックリスト" site/ src/lib/domain/ docs/design/lp-content-map.md` → 0 件
- [x] `grep -rn "kind.*routine" docs/design/` → 0 件（経緯記述は「旧ルーチン枠」「旧 routine」で表記）
- [x] LP メトリクス（`scripts/measure-lp-dimensions.mjs`）の閾値内（mobileHeight ≤ 15000 / desktopHeight ≤ 8000 / forbiddenTerms 0 / ctaVariants ≤ 3）
- [x] `scripts/check-lp-ssot.mjs` baseline 0 維持
- [x] 設計書間の用語が「持ち物 vs 毎日 must」で完全一致

## 関連 ADR からの参照

- ADR-0009: labels.ts SSOT 化原則 — LP / アプリ全層で「持ち物チェックリスト」「今日のおやくそく」用語を SSOT 化
- ADR-0010: Pre-PMF スコープ判断 — 破壊的 schema 変更を Pre-PMF で許容
- ADR-0011: baby モードは親の準備モード — 0-2 歳は must 活動非適用（達成率ボーナス 0）
- ADR-0012: Anti-engagement 原則 — 「同じ習慣を 2 箇所で管理する」運用負荷の解消
- ADR-0013: LP truth from implementation — LP 訴求は実装の事実（持ち物 = event-* / 毎日 must = 活動 priority）と一致
