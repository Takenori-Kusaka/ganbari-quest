# TypeScript 厳格化ポリシー — 採用 / 見送りフラグの SSOT

> **AI エージェント・実装者へ**: `tsconfig.json` / `infra/tsconfig.json` の strict 系フラグを増やす前に本ファイルを読む。
> 「なぜこのフラグを入れる / 入れない」の判断は本ファイルが SSOT。過去に見送ったフラグを再検討する場合も、
> まず「見送り理由」節を確認し、前提が変わったかを判断する（同じ議論の再燃を防ぐ）。

**関連 Issue**: #3877 / **関連 ADR**: ADR-0007（静的解析 tier）/ ADR-0010（Pre-PMF scope）

---

## 1. 設計背景（この方針がないと何が困るか）

TypeScript の strict 系フラグ / type-aware lint は「厳格化で catch できるバグ」と「引っ掛かりすぎて
ノイズ・移行工数になるコスト」のトレードオフを常に持つ。方針を SSOT 化しないと、

- `@tsconfig/strictest` を丸ごと入れて大量の型エラーを出す big-bang が起き、retrofit が破綻する
- 一度見送ったフラグ（`exactOptionalPropertyTypes` 等）が「厳しくすべき」という素朴な動機で再提案され、
  同じ議論と調査を毎回やり直す
- アプリ側と CDK 側で厳格度がバラつき、どちらかだけ緩いまま放置される

本ポリシーは、フラグ別 ROI 評価（一次ソース: TSConfig Reference / Matt Pocock TSConfig Cheat Sheet /
James Milner "Stricter than Strict" / aws-cdk Discussion #23885 / typescript-eslint 公式 / TS #49169）と
現状 tsconfig 監査（#3877）に基づき、採用フラグと見送りフラグ・その理由を固定する。

---

## 2. 設計原則

- **cherry-pick する（プリセット丸呑みしない）**: バグ検出フラグ / lint 系 / build-interop フラグを混在させた
  プリセットは retrofit を難しくする。retrofit を難しくする主因は `exactOptionalPropertyTypes` と
  `noUncheckedIndexedAccess` の 2 つ。個別に採否を判断する。
- **段階導入（big-bang 禁止）**: フラグ有効化で出た違反は同一 PR で 0 まで修正してから恒久 ON にする。
  大量に出て修正しきれないフラグは、既存違反を grandfather する ratchet で「新規違反のみ block」する。
- **tsc で拾えない bug class は lint に委譲する**: `await` 漏れ / 未処理 Promise rejection は tsc に等価フラグが
  無いため type-aware lint（`no-floating-promises` / `no-misused-promises`）で捕捉する。逆に
  未使用変数のような lint 向きの検査は tsc フラグ（`noUnusedLocals` 等）ではなく Biome / ESLint に委譲する。
- **アプリと CDK を両面で揃える**: 片側だけ緩い状態を作らない。両者は別 tsconfig のため個別に Phase 管理し、
  それぞれに独立した型検査 CI gate を持たせる。
- **Pre-PMF 適合（ADR-0010）**: 新規重量ツールを増やさない。既存資産（`type-coverage` 97% /
  svelte-check `--threshold warning` / tsc / ESLint）を再利用する。

---

## 3. 採用フラグ（恒久 ON）

### 3.1 アプリ側 `tsconfig.json`

| フラグ | 効果 | 導入 |
|---|---|---|
| `noUncheckedIndexedAccess` | 配列 / Record 範囲外アクセスの実 crash | 既存 ON |
| `noImplicitOverride` | 基底メソッド改名で override が stale 化 | 既存 ON |
| `noImplicitReturns` | 分岐での return 漏れ | #3877 Phase 1 |
| `noFallthroughCasesInSwitch` | switch 意図しない fallthrough | #3877 Phase 1 |
| `allowUnreachableCode: false` | 到達不能コード | #3877 Phase 1 |
| `allowUnusedLabels: false` | label typo | #3877 Phase 1 |

`.svelte-kit/tsconfig.json` が強制する `verbatimModuleSyntax` / `isolatedModules` / `skipLibCheck` は触らない。
型検査 gate は svelte-check `--threshold warning`（CI hard gate）+ `type-coverage --at-least 97 --strict`。

### 3.2 CDK 側 `infra/tsconfig.json`

| フラグ | 効果 | 導入 |
|---|---|---|
| `noImplicitReturns` | 分岐での return 漏れ | 既存 ON（CDK init 既定） |
| `noImplicitOverride` | override stale 化 | #3877 Phase 1 |
| `noFallthroughCasesInSwitch` | switch fallthrough | #3877 Phase 1（旧: 明示 false） |
| `allowUnreachableCode: false` | 到達不能コード | #3877 Phase 1 |
| `allowUnusedLabels: false` | label typo | #3877 Phase 1 |
| `noUncheckedIndexedAccess` | 範囲外アクセス | #3877（下記 ratchet 参照） |

CDK 側は独立型検査 gate（`cd infra && npx tsc --noEmit`、`infra/package.json` の `typecheck` script）を
CI（`ci.yml` の `lint-and-test` job）に持たせ、アプリ側 svelte-check との厳格度差を埋める。

#### `noUncheckedIndexedAccess`（CDK）の ratchet 判断

本フラグは一般に「高ノイズ・ratchet 必須」だが、CDK コードは construct instantiation 中心で
配列 / Record indexing が少なく、**#3877 時点で有効化しても既存違反が 0 件**だった。したがって
betterer / tsc-baseline / typescript-strict-plugin 等の**別 baseline ツールは導入せず**、フラグを恒久 ON にして
CDK 型検査 gate（`tsc --noEmit`）自体を ratchet とする（既存違反 0 のため「新規違反のみ block」が自動的に成立）。
既存資産で完結し新規重量ツールを増やさない Pre-PMF 適合の選択（ADR-0010）。

### 3.3 type-aware lint（アプリ + CDK 両面、**CI 限定の分離 config**）

`@typescript-eslint` の type-checked ルールで以下を `error` として有効化。tsc に等価フラグの無い
bug class を機械捕捉する（最高 ROI）。

| ルール | 効果 |
|---|---|
| `no-floating-promises` | `await` 漏れ / 未処理 Promise rejection |
| `no-misused-promises` | void 期待箇所への async 関数渡し等 |

- **性能隔離（重要）**: `parserOptions.projectService` は型プログラムをロードするため lint が重い。これを
  default の `eslint.config.js` に載せると**ローカル / pre-push / pre-ready の eslint 全体が遅くなり定常
  dev ループの足を引っ張る**。そのため type-aware ルールは**分離 config `eslint.typed.config.js` に隔離**し、
  **CI 専用 step（`npm run lint:typed`）でのみ実行**する。`eslint.config.js`（ローカル / pre-push /
  pre-ready 用）には projectService も type-aware ルールも載せず**非 type-aware のまま高速維持**する。
- **scope**: `src/**/*.ts` + `infra/lib/**/*.ts` + `infra/bin/**/*.ts`（production / server コード）。
  Phase 1 は correctness 系 2 ルールに絞る（ルール全部盛りは CI 時間を膨張させるため）。
- **除外**: `tests/**/*.ts`（Vitest mock `mockImplementationOnce(async () => …)` で `no-misused-promises` が
  false-positive を出す + `projectService` の型ロードで lint が重い。await 漏れはテスト失敗で顕在化する）/
  `src/service-worker.ts`（`WorkerGlobalScope` 用に `projectService` 非解決）/ `infra/lambda/**`
  （`infra/tsconfig.json` の include 外 = 別バンドル）。
- **CI gate**: `ci.yml` `lint-and-test` の "ESLint type-aware" step（`npm run lint:typed`）が `error` 検出で
  hard-fail。既存 lint-and-test job に単一 TS program 分の型ロード（実測 ~1 分）を加算するのみ。
- **回帰保証**: `tests/unit/architecture/type-aware-lint.test.ts` が「floating promise を書くとルールが error を出す」
  ことと「`eslint.typed.config.js` で両ルールが `error` 有効」+「default `eslint.config.js` に type-aware /
  projectService を載せていない（高速維持）」を fitness function として検証する。

---

## 4. 見送りフラグ（意図的に入れない）

再検討する場合は、下記「見送り理由」の前提が変わったかをまず確認する。

| フラグ / ルール | 見送り理由 |
|---|---|
| `exactOptionalPropertyTypes` | **CDK は技術的に不可**（aws-cdk-lib 型と非互換、AWS が WONTFIX = aws-cdk Discussion #23885）。アプリ側も third-party 型（headlessui / tseslint 等）との摩擦が大きい。効果に対しコスト超過。 |
| `noPropertyAccessFromIndexSignature` | `obj.key` vs `obj["key"]` の書式強制で **runtime 安全性を上げない style flag**（Milner "enforced style" 除外）。 |
| `noUnusedLocals` / `noUnusedParameters`（tsc） | 未使用変数 / 引数は **lint 委譲**。typescript-eslint 公式も `no-unused-vars` を tsc フラグより推奨。tsc で入れると型検査と混ざり retrofit を難しくする。 |
| lint `strict-boolean-expressions` | 高ノイズ・opinionated。typescript-eslint 公式が「厳格すぎ」と自己申告し recommended preset 非収録。 |
| `@tsconfig/strictest` 丸呑み | バグ検出 flag + lint 系 + build/interop を混在させたプリセットで retrofit を難しくする。cherry-pick 方針（§2）に反する。 |

### 決裁済み事項（#3877）

- **CDK `strictPropertyInitialization` は `false` を維持**: CDK construct は field をコンストラクタ内の
  helper メソッドで初期化するパターンが多く、`true` 化は実害の低い大量違反を生む。効果に対しコスト超過のため false 維持。
- **Phase 2 候補（本ポリシーでは未導入、将来判断）**: lint `no-unsafe-*` / `no-unnecessary-condition`
  （strict-type-checked）は効果はあるがノイズ中程度のため、導入する場合は ratchet 前提で別途評価する。

---

## 5. 更新ルール

- `tsconfig.json` / `infra/tsconfig.json` に strict 系フラグを増減したら本ファイル §3 / §4 を同期更新する。
- type-aware lint のルール / scope を変えたら §3.3 と `eslint.config.js` のコメントを同期する。
- 見送りフラグを採用に転じる場合は、§4 の見送り理由の前提が崩れたことを PR 本文で示す。
