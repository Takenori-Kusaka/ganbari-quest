# Graphify (コードベース knowledge graph 化) 評価 設計経緯

> **現状: 撤去済み → graft に置換。** 2026-07-29 に不採用 → #4343 (#4291) で採用 → 2026-09-22 に撤去し [graft](https://github.com/trailhq/Graft) へ置き換えた。**現状の正解は [docs/decisions/README.md](../decisions/README.md) §OSS 採用記録 (graft) / §OSS 調査済み・不採用記録 (Graphify) と `.claude/skills/graft/SKILL.md`** を見ること。末尾の「撤去と graft への置換」節が撤去の判断材料、それより前は 2026-07-29 の不採用評価（再評価時に「何を測って何を理由に落としたか」を引き継ぐために残す）。

## 議論の発端

- **日時**: 2026-07-29
- **発端 Issue / セッション**: Issue 非紐づけ（PO 依頼「リポジトリを調査してこのプロダクトへの適合性、効果性を踏まえて検討し、導入価値があれば導入」）/ 参照ルール: #1350（OSS 先調査ルール）
- **問題意識**: コードベース探索性（どこに何があるか / 変更の影響範囲はどこか）の向上手段として [Graphify](https://github.com/Graphify-Labs/graphify)（knowledge graph 化 CLI、Apache-2.0 / YC S26）が候補に挙がった。現状の探索資産は CLAUDE.md 階層 + `docs/codebase-map.md`（人手 SSOT）+ grep + dependency-cruiser（ADR-0007 §7）+ `impact-analysis` skill であり、これらを置き換える / 補完する価値があるかを実測で判定する必要があった。

## 実測条件

以下はすべて HEAD `2f4573d3` の本リポジトリに対する実測値である（カタログ情報からの引用ではない）。

| 項目 | 実測値 | 取得方法 |
|---|---|---|
| グラフ規模 | 20,973 nodes / 39,750 edges | `graphify update . --no-cluster` |
| ビルド時間 | 2m13s（ローカル AST のみ・API キー不要） | 同上 |
| `.svelte` カバレッジ | 237〜238 files → 479 nodes（全て `L1` = ファイルレベル、コンポーネント内部構造なし） | `graph.json` の node を拡張子別集計 |
| 対比: `.ts` / `.md` | `.ts` 1,514 files → 9,629 nodes / `.md` 8,370 nodes | 同上 |
| 日本語健全性 | 日本語 node 7,578 件 / U+FFFD 混入 0 件 | `graph.json` を Python で走査 |
| `god-nodes` | 中核を正しく検出（`ChildId` 457 edges / `getRepos()` 420 / `requireTenantId()` 125） | `graphify god-nodes --top 12` |
| `query` | BFS が 434 nodes にヒット → 42 件に truncate、内容はハブノイズ優位（`logger` / `labels.ts` / `ChildId`） | `graphify query "how does marketplace import assign items to children"` |
| `explain` / `path` | SvelteKit の `+page.server.ts` / `+server.ts` 同名衝突でルート層が識別不能 | `graphify explain "labels.ts"` |
| `cites`（code→ADR） | 979 edge。`git grep -ohE 'ADR-[0-9]{4}'` 1 コマンドで 56 ADR を件数付き取得でき増分なし | 実測比較 |
| `affected` | import 逆引き。dependency-cruiser（ADR-0007 §7）+ `impact-analysis` skill の layer 1-2 と重複、同 skill が担保する派生 artifact 22 カテゴリ（testid / baseline / SS / 設計書参照 / CI config）は非カバー | `graphify affected "requireTenantId()" --depth 2` の出力突合 |
| `graph.json` サイズ | 21.6MB | `ls -la graphify-out/` |

**未実測（ドキュメント読解による推測）**: `graphify claude install` の挙動 — CLAUDE.md への追記に加え、PreToolUse hook を `Bash|Grep` / `Read|Glob` matcher で登録し（`--strict` でセッション初回の生 Read をブロック）、探索を graph 経由に誘導する、という理解は `install.py` の `_claude_pretooluse_hooks` と `always_on/claude-md.md` の**読解に基づく推測**であり、実際に `graphify claude install` を実行して確認してはいない。導入すれば CLAUDE.md 階層 + `docs/codebase-map.md` の SSOT ナビが（`query` で劣化を実測した）BFS に置き換わる、という侵襲性評価も同じ確度である。

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A: Graphify を導入し `graphify claude install` まで実施 | knowledge graph をコード探索の主経路に据える | PO 依頼の本線。探索性が構造的に改善するなら人手 SSOT の保守コストを下げられる |
| 案 B: Graphify を導入するが hook は入れず CLI 単体で併用 | `god-nodes` 等の有用サブコマンドのみ手動利用 | 侵襲性を避けつつ増分価値だけ取る折衷案 |
| **採用案: 不採用 + 記録を残す** | 導入せず、不採用根拠と再評価トリガを `docs/decisions/README.md` §OSS 調査済み・不採用記録 に薄いインデックス行として残す | 現時点の適合性が低く、かつ「同じ候補が再度挙がる」ことが確実に予想されるため |

## 棄却理由

### 案 A 棄却理由（フル導入 + hook）

- **UI 層がグラフ上の空白になる**: `tree-sitter-svelte` 非対応のため `.svelte` 237〜238 files が全て `L1` ファイルレベル node（479 nodes）にとどまる。SvelteKit + Svelte 5 が主戦場の本リポジトリで、探索の主経路を「UI 層が空白なグラフ」に切り替えるのは劣化になる。**これが不採用の決定要因**
  - **採用後の再実測 (#4395)**: 現行 `graphify-out/graph.json` では `.svelte` 250 file が 492 node で、うち 242 が symbol レベル (`L1` 以外) だった。「全て `L1`」は現行版では成り立たない。ただし粒度は `.ts` の 6.6 node/file に対し 2.0 node/file で依然として粗く、**UI 層の探索を graph に寄せない**という運用判断は維持する
- **ルート層が識別不能**: SvelteKit の `+page.server.ts` / `+server.ts` 同名衝突で `explain` / `path` がルートを区別できない
- **`query` が既存 Grep 以下**: BFS 434 nodes → 42 件 truncate でハブノイズ（`logger` / `labels.ts` / `ChildId`）が優位を占め、狙った grep より当たらない
- **hook による SSOT ナビの置換が侵襲的（推測、未実測）**: 上記「未実測」節のとおり、`Bash|Grep` / `Read|Glob` matcher の PreToolUse hook が CLAUDE.md 階層 + `docs/codebase-map.md` の探索導線を BFS に誘導すると読める。実測した `query` 品質を踏まえるとこの置換は避けたい

### 案 B 棄却理由（CLI 単体併用）

- **増分価値が既存資産と重複**: `cites`（code→ADR 979 edge）は `git grep -ohE 'ADR-[0-9]{4}'` で代替可能（ADR 月 1 棚卸の現役参照判定はこれで足りる）。`affected` は dependency-cruiser + `impact-analysis` skill の layer 1-2 と重複し、同 skill が本来狙う派生 artifact 22 カテゴリは非カバー
- **有用だったのは `god-nodes` のみ**: 中核（`ChildId` / `getRepos()` / `requireTenantId()`）を正しく検出したが、この 1 コマンドのために下記の運用コストを常時負う ROI が成立しない（ADR-0010 Pre-PMF）
- **運用コストが恒常的**: `graph.json` 21.6MB は git commit 不可。commit しなければ全員が 2m13s の再ビルドを負い、かつ放置すれば陳腐化する

## 採用案とその理由（不採用 + 記録を残す）

現時点のスタック適合性が低く（UI 層が空白）、増分価値のある機能が既存資産と重複するため導入しない。ただし **判断を捨てずに記録する**。Graphify は活発な新興 OSS であり、記録がなければ候補として再浮上するたびに同じ調査（インストール + 2 分超のグラフ構築 + 適合性分析 + 既存資産との突合）を繰り返すことになる。

記録は `docs/decisions/README.md` §OSS 調査済み・不採用記録 に **1 行のインデックス**として置き、詳細（実測値・棄却理由・確度）は本 rationale に置く。§OSS 採用記録 が「`npm install` 前にまず参照するインデックス」と役割を明記しているのと対をなす構造で、README 側は「調べたか / 結論 / 何が変われば覆るか」だけを 1 行で答え、深掘りは本ファイルに委ねる。

**再評価トリガ**: `tree-sitter-svelte` 対応が入る（本評価の決定要因が消える）/ v1.0.0 正式リリース時点の Svelte・SvelteKit 対応状況。

## 残された懸念・フォローアップ

- [ ] `graphify claude install` の hook 挙動は未実測のまま。再評価時（`tree-sitter-svelte` 対応後）に実際に install して侵襲性を実測する
- [ ] `.svelte` カバレッジの実測値は集計方法により 237 / 238 files と 1 件差がある（拡張子別集計と file 走査の差）。結論（全て `L1` ファイルレベル node のみ）には影響しない
- [ ] 探索性の課題自体は残る。人手 SSOT（CLAUDE.md 階層 + `docs/codebase-map.md`）の保守コストが顕在化した場合は、別手段（dependency-cruiser の出力活用等）を検討する

## 関連

- **議論源**: PO 依頼（2026-07-29）/ PR #4092
- **参照する既存ルール**: #1350（OSS 先調査ルール）/ [ADR-0007 §7](../decisions/0007-static-analysis-tier-policy.md)（dependency-cruiser required 昇格、#3895）/ [ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md)（Pre-PMF スコープ判断）
- **記録先**: [docs/decisions/README.md](../decisions/README.md) §OSS 調査済み・不採用記録 (撤去後。後任の graft は §OSS 採用記録)
- **重複判定した既存資産**: `.claude/skills/impact-analysis/SKILL.md` / [docs/codebase-map.md](../codebase-map.md)

## 撤去と graft への置換（2026-09-22）

### 撤去の判断材料

採用 (#4343) 時の設計は「生成物 `graphify-out/` を git 追跡し、新しい clone がチェックアウト直後から構造を引ける (コールドスタート解消)」だった。この 1 点を成立させるために、次の装置が順に積み上がった。どれも前の装置の副作用への対処である。

| 装置 | 対処した副作用 |
|---|---|
| `.husky/post-commit` を develop / main 限定に (#4536) | 全 branch で再生成すると並行 PR がすべて `graphify-out` だけで conflict した |
| `.github/workflows/graphify-refresh.yml` + bot PR (#4536) | develop / main は直接 push できないため、再生成を bot PR で流す必要が出た |
| `.gitattributes` の semantic merge driver + `scripts/prepare.mjs` の登録 (#4442) | 行単位 merge が `graph.json` を JSON.parse 不能に壊したまま追跡されていた |
| `scripts/lib/graphify-hook-appendix.mjs` (#4638) | `graphify hook install` が追跡ファイルに開発者の絶対パスを焼き込み、main を汚した |
| Dockerfile 3 本の COPY 追随 (#4811) | 上の module を prepare が import したため、Docker の `npm ci` が落ちた |
| `.github/graphify/requirements.txt` の hash pin 30 件 (#4866) | workflow が入れる Python 依存が無 pin だった。Dependabot の version update とは両立しない |
| `graphify-artifacts-parseable` test + CI path filter | 壊れた `graph.json` を知らせる経路が無かった |

最後に、refresh PR #4959 (変更 29,455 行 / 3 file) は develop の最新 48771c2 から再生成され unit-test (1) / (2) 以外の 37 context が緑のまま、完了待ちのバックグラウンド処理がマシンのメモリ不足で停止した。**生成物を git に載せる前提そのものが、装置の連鎖と PR 検証の重さを生んでいる**と判断し、ツールごと撤去する。

### graft を選んだ理由

graft (`@nanonets/graft`, MIT) はグラフを **clone ごとのローカルキャッシュ** (`/graft/`、git 追跡しない) として持ち、問い合わせのたびに変更ファイルだけを差分で取り込む。上表の装置は、生成物を追跡しない時点で**すべて不要になる** (conflict も merge driver も refresh PR も起きない)。

| 項目 | 実測値 (2026-09-22、develop 48771c2 相当 + 本変更) |
|---|---|
| 初回構築 | 68.6 秒 / ピーク約 1.4GB (プロセスツリーの working set) |
| グラフ規模 | 2,290 file / 10,664 node / 27,743 edge (TS / JS のみ) |
| 問い合わせ 1 回 | 約 1.6 秒 (鮮度確認込み) |
| ローカルキャッシュ | 79MB (git 追跡しない) |
| MCP サーバー常駐 | 1 セッションあたり約 300MB (npx ラッパー 106MB + 本体 194MB) |

### 採用形態で退けたもの

- **`graft init` の既定構成 (hook 5 本 + statusLine + MCP)**: UserPromptSubmit / PostToolUse / Stop などでバックグラウンド同期を起動し、statusLine は各開発者の個人設定を project 設定で上書きする。並走セッションの多いこの repo では、常駐・バックグラウンド処理がメモリ不足の再発経路になるため入れない
- **repo の `.mcp.json` への登録**: 上表のとおりセッションごとに約 300MB 常駐する。CLI をその都度起動する形 (常駐ゼロ) を既定にし、MCP は各自の local scope で opt-in とする
- **devDependency として `package.json` に追加**: tree-sitter のネイティブ module を CI / Docker の `npm ci` に持ち込む。ローカル専用の道具に本番ビルドの依存を背負わせない
- **最新版 (0.19.0)**: 0.13.0 以降は依存の `tree-sitter-kotlin` が prebuild を持たず、Windows では install 時のネイティブビルドが失敗して起動できない (trailhq/Graft#323。この repo の開発機で再現)。0.12.1 に固定する

### 残る制約

- `.svelte` は索引外 (0.12.1 の対応言語は TS / JS 系)。`graft callers` / `graft grep` は `.svelte` 内の呼び出しを返さないため、rename・削除の影響範囲は `.svelte` への grep を併用する (skill に明記)。UI 層の探索は `docs/codebase-map.md` + grep を主経路のままとする
- 版固定を外す条件: upstream が #323 を解消し、Windows で `npx -y @nanonets/graft@<新版> --version` が通ること
