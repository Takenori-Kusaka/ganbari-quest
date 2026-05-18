# 07. Research: 子供向け学習・ゲーム化アプリでのカテゴリ折りたたみ UI 業界調査

| 項目 | 内容 |
|------|------|
| Issue | #2148 |
| 起票 | 2026-05-17 |
| 補佐 | Dev session |
| 関連 ADR | ADR-0010 (Pre-PMF scope) / ADR-0012 (Anti-engagement) |
| 関連 WCAG | 2.5.2 (Pointer Cancellation) / 2.5.8 (Target Size) |

## 1. 調査背景

子供画面 (`/(child)/[uiMode=uiMode]/home`、`src/lib/features/child-home/components/ProdDashboardSections.svelte`) で `CategorySection.svelte` のカテゴリヘッダー (例: 「うんどう 0/1 Lv.12 54%」) は実装上、`<button onclick={toggleExpand}>` でクリック可能領域として描画され、子供がタップすると活動グリッドが完全に非表示になる。

復旧 UI は:

- 折り畳み中の `▲/▼` 三角アイコン (`compactMode=true` 時のみ表示)
- 「もっと見る」ボタン (`shouldCollapse=true` かつ `expanded=true` の時のみ表示)

の 2 経路だが、いずれも **子供が誤タップで折り畳んだ後に学習なしで認知できない**。結果として「活動グリッドが消えて子供がフリーズ → 親もサポート対応不能」という実害が発生。PO が 2026-05-17 直接報告 (memory `feedback_review_quality_incident.md` 整合)。

本 research は「業界の子供向け学習・ゲーム化アプリで、カテゴリヘッダー誤タップで全コンテンツが消える設計があるか」を 7 サービスで網羅調査し、γ 案 (子供画面では collapsible を削除、親管理画面のみで保持) の業界整合性を検証する。

## 2. 調査軸

### 軸 A: ホーム画面のメインカテゴリ表示パターン

- A1: 線形パス (Learning Path) — Khan Academy Kids / Duolingo ABC
- A2: 常時可視 tile grid — ABCmouse / Code.org
- A3: 空間メタファ (世界地図 / 場所選択) — Prodigy Math
- A4: daily learning plan 中央 + side nav 独立 — SplashLearn
- A5: 常時可視・線形フロー (日本の学習教材伝統) — スマイルゼミ / 進研ゼミ

### 軸 B: カテゴリヘッダー誤タップ時の挙動

- B1: 折り畳み機能なし (header はラベルのみ、tap で何も起きない)
- B2: 折り畳みあり + 復旧 UI が **常時可視** (▼ ボタン等が折り畳み後も明示)
- B3: 折り畳みあり + 復旧 UI が条件付き表示 (本 Issue の現状)

### 軸 C: 折り畳み機能の提供範囲

- C1: 子供画面・親管理画面ともに提供
- C2: 親管理画面のみ提供 (子供画面では常時展開)
- C3: いずれにも提供なし

## 3. 業界 7 サービス調査結果

### 3.1 Khan Academy Kids (米国、2-8 歳)

- 軸 A: A1 (Learning Path — 横スクロール線形)
- 軸 B: B1 (folds なし)
- 軸 C: C3
- 補足: ホーム画面はキャラクターが歩く道のメタファ。「次の活動」だけが大きくフォーカスされ、子供は迷わない。カテゴリという概念自体を子供に意識させない設計

### 3.2 Duolingo ABC (米国、3-6 歳)

- 軸 A: A1 (2022 redesign 後の linear path progression)
- 軸 B: B1
- 軸 C: C3
- 補足: 旧来 categorized tile UI から linear path に転換。理由として「子供がどこをタップしていいか迷う問題」を公式 blog で言及

### 3.3 ABCmouse (米国、2-8 歳)

- 軸 A: A2 (5 sections: Math/Reading/Art/Music/World tile grid 常時可視)
- 軸 B: B1 (tile は折り畳めない、tap で section に遷移)
- 軸 C: C3
- 補足: 5 section tile が常時可視で、tap → section 内コンテンツに遷移する明確な遷移モデル。section 自体を消す操作は提供されない

### 3.4 Prodigy Math (カナダ、6-14 歳)

- 軸 A: A3 (空間メタファ: 世界地図 → 場所選択 → 戦闘)
- 軸 B: B1
- 軸 C: C3
- 補足: カテゴリは「場所」として表現される。地図上のアイコン tap で遷移、地図そのものを折り畳む UI は無い

### 3.5 SplashLearn (米国、3-11 歳)

- 軸 A: A4 (daily learning plan 中央 + side nav 独立 tab)
- 軸 B: B1 (tab そのものは folds なし、tab tap で content 切替)
- 軸 C: C3
- 補足: side nav は親管理画面/子供画面で同型だが、いずれも折り畳めない

### 3.6 Code.org Hour of Code (米国、4 歳〜)

- 軸 A: A2 (age band カード grid)
- 軸 B: B1 (子供画面)、B2 (教師管理画面)
- 軸 C: C2 (教師管理機能のみで折り畳み)
- 補足: 子供は age band カードから 1 つを選ぶだけ。教師は class management で活動を折り畳めるが、これは管理機能であり子供画面には漏れない

### 3.7 スマイルゼミ / 進研ゼミ (日本、年中〜中学生)

- 軸 A: A5 (今日やる教材を線形に提示)
- 軸 B: B1
- 軸 C: C3
- 補足: 「迷わない画面」が公式設計思想。教材セレクション操作は親管理画面でのみ提供され、子供画面では「今日の教材」一覧が常時可視

### 3.8 業界調査サマリー

| サービス | 軸 A | 軸 B | 軸 C |
|---------|------|------|------|
| Khan Academy Kids | A1 | B1 | C3 |
| Duolingo ABC | A1 | B1 | C3 |
| ABCmouse | A2 | B1 | C3 |
| Prodigy Math | A3 | B1 | C3 |
| SplashLearn | A4 | B1 | C3 |
| Code.org Hour of Code | A2 | B1/B2 | **C2** |
| スマイルゼミ / 進研ゼミ | A5 | B1 | C3 |

**結論**: 7 サービス中 **7 件全てで子供画面のカテゴリヘッダー誤タップで活動グリッドが消える挙動は存在しない**。Code.org のみ教師管理画面 (= 親管理画面に相当) で折り畳み機能を提供しているが、これは **管理機能としての隔離** であり、子供画面には漏れない設計になっている。

## 4. 対策候補比較

業界 prior art を踏まえ、本 Issue で取り得る対策候補 4 つを比較する。

### 案 1: 折り畳み + 復旧 UI 強化

- 概要: 折り畳み機能は残し、復旧 UI (「タップで広げる」明示ボタン) を常時可視化
- メリット: 既存実装に近い修正で済む (CategorySection の `<style>` 変更のみ)
- デメリット:
  - 業界 prior art 7/7 で類似 UX 不在 (= ユーザの mental model に無い)
  - ADR-0012 違反: 子供画面 UI に「操作の可逆性を学習させるための説明 UI」を追加することで滞在時間を延伸する
  - ADR-0010 (Pre-PMF) 違反: 子供 UX の重要度から見れば Pre-PMF で過剰防衛
  - WCAG 2.5.8 (Target Size) 改善も同時に必要 (header tap 領域が広すぎる根本原因が残る)

### 案 2: 長押し / 2 段階確認

- 概要: header tap を長押し / モーダル確認に変更
- メリット: 誤タップを物理的に防ぐ
- デメリット:
  - ADR-0012 違反: 「数秒で完結」原則に逆行する (確認 dialog が割り込む)
  - WCAG 2.5.2 (Pointer Cancellation) 違反: 「up event で実行」原則を破る
  - 子供にとって「長押し」概念は preschool 以下で未獲得

### 案 3: 親設定で ON/OFF

- 概要: `display_config.collapsible` を親管理画面で ON/OFF 切替可能化、デフォルト OFF
- メリット: 既存機能を残せる
- デメリット:
  - Pre-PMF で過剰 (#2148 は子供 UX 完成度欠落で、設定機能で逃げると 8 回連続 PO 指摘 (memory `feedback_review_quality_incident.md`) と同型のリスクが再発)
  - デフォルト OFF にしても、親が誤って ON にする可能性ゼロでない (= 本質的解決にならない)

### 案 γ: 子供画面で collapsible 削除、親管理画面のみで保持 (Code.org 整合) ★採用★

- 概要:
  1. `ProdDashboardSections.svelte` で `<CategorySection ... collapsible={false}>` を明示的に渡す
  2. `CategorySection.svelte` で `collapsible={false}` の場合は header の `<button>` 自体を tap 非反応 (`<div>` 描画)、`expanded` を常時 true 固定
  3. `getDefaultDisplayConfig()` で baby/elementary のデフォルト `collapsible: true` を `false` に変更 (子供画面唯一の利用箇所のため、根本対策)
- メリット:
  - 業界 prior art 7/7 全件と整合 (Code.org C2 と同型)
  - ADR-0012 完全整合 (子供画面で「予期しない UI 消滅」を排除)
  - ADR-0010 完全整合 (修正 ~30 行 + E2E 1 spec、1-2h)
  - WCAG 2.5.2 / 2.5.8 抵触リスク消失
  - 親管理画面で将来 collapsible UI を使う場合の prop 設計は残せる (No-gos 整合)
- デメリット: なし (業界 prior art / ADR / WCAG いずれも違反しない)

## 5. γ 採用結論

PO 確定方針 (Issue #2148 タイトル「γ 採用」) と業界 prior art 7 サービス調査結果が完全整合。案 1/2/3 は ADR-0010 / 0012 または WCAG 抵触のため不採用。

## 6. 実装スコープ (Issue AC2/3/4 整合)

| 対象 | 変更内容 |
|------|---------|
| `src/lib/features/child-home/components/ProdDashboardSections.svelte` | `<CategorySection ... collapsible={false}>` 明示的に強制 |
| `src/lib/ui/components/CategorySection.svelte` | `collapsible=false` 時 `<button>` を `<div>` 描画 + `expanded` 常時 true 固定 (二重防御) |
| `src/lib/domain/display-config.ts` | `getDefaultDisplayConfig()` で baby/elementary の `collapsible: true` → `false` (子供画面唯一の利用箇所のため根本対策) |
| `docs/design/06-UI設計書.md §8.2` | 「年齢別デフォルト」表の折りたたみ列を全 5 年齢モードで「なし」に統一 + §8.3 に「子供画面では常時展開」追記 |
| `tests/e2e/child-category-collapsible-disabled.spec.ts` (新規) | 5 年齢モード全件で header tap → 活動グリッド残存 assert |

## 7. 影響範囲確認 (lateral spread / memory `feedback_review_lateral_spread.md` 整合)

| 対象 | 影響 |
|------|------|
| 親管理画面 (`/admin/...`) | `<CategorySection>` 利用箇所なし (grep 確認済み)。本 Issue 影響なし |
| `src/routes/demo/` | #2188 で全削除済み (PR-B3)。`DashboardView.svelte` は存在しない |
| `src/lib/ui/components/CategorySection.svelte` の `compactMode` prop | 削除しない (No-gos 整合)、現状 false 固定で動作するが将来の親管理画面利用のため温存 |
| 「もっと見る」ボタン (`shouldCollapse` 経路) | 削除しない (No-gos 整合)。`collapsible=false` で発火しない構造のため副作用なし |

## 8. 参考リンク

- Khan Academy Kids: https://learn.khanacademy.org/khan-academy-kids/
- Duolingo ABC: https://abc.duolingo.com/ (2022 redesign blog: https://blog.duolingo.com/duolingo-design-principles/)
- ABCmouse: https://www.abcmouse.com/
- Prodigy Math: https://www.prodigygame.com/
- SplashLearn: https://www.splashlearn.com/
- Code.org Hour of Code: https://hourofcode.com/
- スマイルゼミ: https://smile-zemi.jp/
- 進研ゼミ: https://sho.benesse.co.jp/
- NN/g 児童 UX 研究: https://www.nngroup.com/articles/childrens-websites-usability-issues/
- WCAG 2.5.2 Pointer Cancellation: https://www.w3.org/WAI/WCAG21/Understanding/pointer-cancellation.html
- WCAG 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

## 9. 改訂履歴

| 日付 | 変更 |
|------|------|
| 2026-05-18 | 初版作成 (Issue #2148 AC1) |
