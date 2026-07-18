# 0066. export/import 値域 SSOT — wire schema とドメイン validator は同一値域定数を import する

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-07-12 |
| 起票者 | Dev session (EPIC #3151 slice1) |
| 関連 Issue | #3151 (EPIC) / #3132 / #3104 / #3143 / #3153 |

## コンテキスト

export/import 機能クラスタが 2 サイクル連続で round-trip blocker (#3104 ByteString → #3132 points 値域) を出し統合監査を停止させた。root class は **ドメイン validation (Zod、`src/lib/domain/validation/*.ts`) と wire schema (Valibot、`src/lib/marketplace/schemas/*.ts`) が別ファイル・別ライブラリで値域 literal を二重定義**し、「アプリが許容する値域 ⊆ export/import が往復できる値域 (domain⊆wire)」という不変条件がどこにも機械表明されていなかったこと。

activity-pack だけでも実ドリフトが 5 件生存していた (#3151 調査 + slice1 検証):

| field | domain (Zod) | wire (Valibot、是正前) | 影響 |
|---|---|---|---|
| basePoints | max(100) | maxValue(10000) | 100 倍差。wire が過大受理 (parse-don't-validate 穴) |
| ageMin/Max | max(20) | maxValue(18) | **domain⊄wire**。ageMax=19/20 の行が往復不能 |
| triggerHint | max(30) | maxLength(200) | 二重定義ドリフト |
| description | max(200) | maxLength(500) | 同上 |
| icon | 1〜2 grapheme | maxLength(20) UTF-16 | **表現方式が別**。ZWJ 絵文字 2 個 (22 units) が往復不能 |

## 検討した選択肢（OSS / 確立パターン 2 件以上 — #1350）

### 選択肢 A: schema 変換 OSS で単一 schema から他方を生成 (zod-to-valibot / @valibot/to-json-schema 等)
- 概要: [zod-to-valibot](https://github.com/fabian-hiller/valibot/discussions) 系 codemod / [@valibot/to-json-schema](https://www.npmjs.com/package/@valibot/to-json-schema) + JSON Schema 経由変換
- メリット: schema 全体が単一定義になりドリフトが構造的に消滅
- デメリット: `transform` / `refine` (categoryId opaque 変換 #3575、grapheme refine) は変換非互換で手動断絶が残る。codemod は one-shot でありビルド常設には別途 build step が要る
- Pre-PMF コスト: build step 常設 + 変換損失の検証コストが過大 (#3151 no-gos「JSON Schema codegen build step は deferred」と同判断)

### 選択肢 B: 単一 Valibot schema に完全統合 (domain も Valibot parse に置換、Standard Schema 経由)
- 概要: valibot.dev/guides/infer-types + Standard Schema spec。domain 側 Zod を廃し wire schema を唯一の validator にする
- メリット: 二重定義が物理的に消滅、parse-don't-validate が完全形になる
- デメリット: domain Zod は form action / API 境界 / superForm 系に広く根付いており全面置換は大規模 (EPIC 全量スコープ)。categoryId (domain=id) vs categoryCode (wire=code) の表現差は結局残る
- Pre-PMF コスト: 1 PR に過大。EPIC #3151 の最終形として段階消化する (本 ADR は方向を固定)

### 選択肢 C: 値域定数 SSOT + 実 validator boundary probe fitness (採用、slice1)
- 概要: 値域定数 (`ACTIVITY_BASE_POINTS_MAX` 等) を **domain 層の単一 `as const` 定数**に集約し、Zod / Valibot 両 schema が import して参照する。表現方式が異なる icon は判定関数 (`isValidActivityIcon`) 自体を共有。整合は `tests/unit/architecture/schema-range-ssot.test.ts` が実 validator を oracle に boundary probe で機械表明する (確立パターン: parity gate = `check-dynamodb-stub-parity.mjs` / Architecture Fitness Function = ADR-0061)
- メリット: 新規 dep / build step ゼロで literal 二重定義を排除。ライブラリ並存 (Zod domain + Valibot wire、#2364 bundle 92% 削減の資産) を維持。B への段階移行と両立
- デメリット: schema 構造 (optional/nullable の形) は依然 2 定義。構造ドリフトは fitness probe と round-trip テスト (#3143) が補完する

## 決定

**選択肢 C を採用**する。原則:

1. **値域定数 (数値上限下限 / 文字数上限 / 判定関数) は domain 層に 1 箇所だけ定義**し、domain validator と wire schema の両方が import する。schema 内の値域 literal 直書きは新規追加禁止
2. **表現方式が異なる値域 (icon grapheme 等) は判定関数を共有**する (値でなく述語を SSOT 化)
3. **domain⊆wire 包含を fitness test で機械表明**する (`tests/unit/architecture/schema-range-ssot.test.ts`)。marketplace 全 type は COVERED / explicit TODO のいずれかに分類必須 (silent skip 禁止、no-silent-gap guard)
4. ドリフト発覚時の統一方向は「**既存データの往復を壊さない側**」= domain が先行 SSOT なら wire を domain に合わせる (上限を狭める場合は既存データ実態の物理検証を必須とする)

slice1 (activity-pack) で是正した値: basePoints 10000→100 / age 18→20 / triggerHint 200→30 / description 500→200 / icon maxLength(20)→isValidActivityIcon。狭めた側は preset JSON・seed・demo fixture の実値を全数検証し新境界内であることを確認済 (migration 不要)。

## 結果

- #3132 class (値域ドリフト) の再混入は unit fitness (T1、<30s) が per-PR で検出し、重量 e2e まで到達しない (shift-left、ADR-0061 整合)
- COVERED は marketplace 全 5 type (activity-pack / reward-set / checklist / challenge-set / rule-preset)。slice4 (#3151) で challenge-set / rule-preset を SSOT 化し fitness test の `RANGE_SSOT_TODO` を空にした = **値域 SSOT の完成 (no-silent-gap guard が 5 type 全 COVERED を CI で保証)**。parse-don't-validate 全面化 (選択肢 B 方向)、fast-check property 格上げ、snapshot canary、Content-Disposition filename* は EPIC #3151 の残 AC で段階消化
- domain validator が不在だった 3 type (checklist / challenge-set / rule-preset) は slice3/slice4 で新設した。checklist は SSOT 化前に admin authoring 経路 (`addTemplateItem`) が label / icon 長を無制限に受理していた (往復不能データを authoring 可能) ため domain validator (`checklistItemSchema`) を authoring 経路にも適用した。challenge-set (admin/challenges は #3195/#3227 で読み取り専用ビュー) / rule-preset (settings/rules は取込済 preset の toggle/削除のみ) は任意値の authoring フォームを持たず wire schema が唯一の runtime validator のため、新設 domain validator (`challengeSetItemSchema` / `rulePresetItemSchema`) の役割は「値域 SSOT の正準定義 (wire が import し literal 二重定義を排除) + fitness probe の domain oracle (wire の再ドリフトを CI 検出)」に限定される
- トレードオフ: schema 構造の二重定義は残る (値域のみ SSOT)。構造の不一致は round-trip テスト群 (#3143) が引き続き担う
- accepted residual (icon grapheme narrowing、slice3 checklist + slice4 challenge-set / rule-preset): icon 判定を旧 UTF-16 units (20) から grapheme (≤2) へ統一した結果、ZWJ 家族絵文字 2 個 (22 units) は widening で往復可能化した一方、絵文字 3 個以上を含む icon は narrowing で拒否する。challenge-set / rule-preset は取込元が marketplace preset JSON (wire 検証済) + 任意値 authoring 経路が存在しないため、往復不能データの流入源は理論上皆無 (preset fixture は全数走査で icon 全て 1 grapheme を確認済)。checklist のみ admin authoring 由来の理論残余があるが (a) 絵文字 3 個以上は単一絵文字意図に反する異常データ、(b) Pre-PMF で実ユーザー僅少、(c) preset / demo fixture は違反 0 件、のため本 narrowing 方針を維持し既存データへの影響は PO 受容とする (原則 4「既存データの往復を壊さない側」は widening 分で満たし、narrowing 分は上記異常データ限定として受容)
