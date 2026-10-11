# Graphify (コードベース knowledge graph 化) 評価 設計経緯

> **現状: 撤去済み → graft に置換。** 2026-07-29 に不採用 → #4343 (#4291) で採用 → 2026-09-22 に撤去し [graft](https://github.com/trailhq/Graft) へ置き換えた。**現状の正解は [docs/decisions/README.md](../decisions/README.md) §OSS 採用記録 (graft) / §OSS 調査済み・不採用記録 (Graphify) と `.claude/skills/graft/SKILL.md`** を見ること。末尾の「撤去と graft への置換」節が撤去の判断材料と graft の選定根拠（同じカテゴリの候補との比較・grep との当たりの計測）、それより前は 2026-07-29 の不採用評価（再評価時に「何を測って何を理由に落としたか」を引き継ぐために残す）。

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

### 同じカテゴリの候補との比較

選定条件は撤去の判断材料から決まる: **生成物を git 追跡しない / 常駐プロセスを前提にしない / この Windows 開発機で動く / 呼び出し元を問い合わせられる**。候補の情報は各 OSS の一次情報（リポジトリ・公式ドキュメント・npm）から取り、「起動確認」列は worktree で `npx --yes` を 1 回だけ打った結果（グローバル install はしていない）。

| 候補 | ライセンス | `.svelte` | 呼び出し元の問い合わせ | 常駐プロセス | この開発機 | 判断 |
|---|---|---|---|---|---|---|
| **graft 0.12.1**（採用） | MIT | 索引外 | `graft callers`（名前で結ぶ。下の計測を参照） | なし（CLI をその都度起動。MCP は各自の任意） | 0.12.1 は起動する | 4 条件をすべて満たす唯一の候補 |
| scip-typescript 0.4.0（Sourcegraph） | Apache-2.0 | 対象外（TypeScript コンパイラで解析） | 索引 `index.scip` を出すだけ。`scip` CLI は lint / print / snapshot / stats / test / expt-convert で、参照を引くには Sourcegraph へ upload するか読み手を自作する | 索引作成時のみ（問い合わせに Sourcegraph を使うならサーバー常駐） | `npx --yes @sourcegraph/scip-typescript@0.4.0 --version` が通った | 問い合わせ手段が無い。大きな codebase での OOM を README が警告している |
| universal-ctags | GPL-2.0 | 対象外（`parsers/` に Svelte パーサが無い） | 答えられない。TypeScript パーサは定義の kind だけで参照の role を持たない（`parsers/typescript.c`） | なし | 公式 Windows ビルドあり（未導入） | 呼び出し元が取れない |
| aider の repo map | Apache-2.0 | 対象外（同梱の `*-tags.scm` に svelte が無い） | 無い。aider の対話セッションが LLM に送る文脈の要約で、単体の CLI ではない | aider セッション中のみ | 未確認 | 用途が違う（LLM と API キーが前提） |
| serena | 本体 GPL-3.0-or-later（SolidLSP は MIT） | **対象**（svelte-language-server と typescript-svelte-plugin で `.svelte` と `.ts` の間の参照を辿る） | `find_referencing_symbols`（LSP の参照検索。型で解決する） | **常駐**（MCP サーバー + 言語サーバー。Svelte では言語サーバーが 2 本） | uv で入る（uv はこの機械にある。未導入） | 常駐が前提で、撤去の理由（並走セッションのメモリ不足）とぶつかる |
| code-graph-rag | MIT | 対象外（対応言語の一覧に無い） | Memgraph へ Cypher。自然言語から Cypher への変換は LLM | **常駐**（`cgr daemon up` で Memgraph + Qdrant を Docker で起動） | Docker Desktop はあるが常時起動を前提にしていない | 常駐 DB と LLM が前提 |
| ast-grep 0.45.3 | MIT | 組み込み言語ではない（カスタム言語 / language injection で拡張できるが未検証） | 索引も呼び出し関係も持たない。`ast-grep run -p 'fn($$$)'` で構文として一致する呼び出しを全件列挙する | なし | `npx --yes -p @ast-grep/cli@0.45.3 ast-grep --version` が通った（win32 の prebuilt） | grep の代替であって graft の代替ではない |

`.svelte` からの呼び出しと `$lib` を型で解決できるのは serena だけだった。再評価するなら serena の常駐メモリを実測するところから始める。

一次情報: [trailhq/Graft](https://github.com/trailhq/Graft) / [sourcegraph/scip-typescript](https://github.com/sourcegraph/scip-typescript) / [scip CLI reference](https://github.com/scip-code/scip/blob/main/docs/CLI.md) / [universal-ctags/ctags](https://github.com/universal-ctags/ctags) ・ [ctags-win32](https://github.com/universal-ctags/ctags-win32) / [aider repo map](https://aider.chat/docs/repomap.html) ・ [aider languages](https://aider.chat/docs/languages.html) / [oraios/serena](https://github.com/oraios/serena) ・ [serena language support](https://oraios.github.io/serena/01-about/020_programming-languages.html) / [vitali87/code-graph-rag](https://github.com/vitali87/code-graph-rag) / [ast-grep languages](https://ast-grep.github.io/reference/languages.html)

### grep との当たりの比較（計測）

**方法**: develop（3e231433b）の worktree で repo root を 1 回 build した索引（2,348 file / 10,797 node / 27,841 edge）に対し、`graft callers <symbol> --depth 1 .` と `git grep -n "<symbol>(" -- src` を比べた。正解は、grep の全ヒットと `git grep -n -w <symbol> -- src` の全出現を 1 行ずつ読み、呼び出し（メンバー呼び出しを含む）かどうかを手で分けたもの。graft は呼び出し元を関数単位で返すため、比較は `src/` 内の**呼び出し元ファイル**単位で行った（graft が返した `tests/` の呼び出し元は数えていない）。シンボルは `$lib` 経由で多くのファイルから import されるもの 5 件と、`.svelte` からだけ呼ばれるもの 1 件（`getAgeTierLabel`）。

| シンボル | 同名の定義 | 呼び出し元（file / 箇所） | graft が返した file | graft の見落とし | graft の誤検出 | grep のヒット行（呼び出し / それ以外） |
|---|---|---|---|---|---|---|
| `getAllChildren` | 1 | 33 / 50 | 33 | 0 | 0 | 51（50 / 定義 1） |
| `getNotificationSettings` | 1 | 3 / 4 | 3 | 0 | 0 | 5（4 / 定義 1） |
| `isCustomRewardUnlocked` | 1 | 4 / 12 | 4 | 0 | 0 | 13（12 / 定義 1） |
| `resolveFullPlanTier` | 1 | 34 / 53 | 34 | 0 | 0 | 54（53 / 定義 1） |
| `findChildById` | 23（repo 層の関数 17 + dsql のメソッド 6） | 20 / 30（うちメンバー呼び出し 9） | **0** | 20 | 0 | 59（30 / 定義 23・interface のシグネチャ 6） |
| `getAgeTierLabel` | 1 | 5 / 6（すべて `.svelte`） | **0** | 5 | 0 | 7（6 / 定義 1） |
| 計 | | 99 / 155 | 74 | 25 | 0 | 呼び出し 155 箇所をすべて含む |

**読み取れること**

- 名前が一意で `.ts` から呼ばれる 4 件は、`$lib/...` 経由の import でも呼び出し元ファイルを全件返し、誤検出も無かった。graft は関数呼び出しを import 文で結ばず、「同じファイル → リポジトリ全体で一意な同名の定義」の順に名前で結ぶ（`dist/graph/resolve.js` の `resolveName`）。`$lib` alias を解決しないことが効くのは、関数を値として渡す参照（import 指定子から辿る `references` edge）の側である（コード読解。計測はしていない）
- **同名の定義が 2 つ以上ある名前は、呼び出し元を 1 件も返さない。** 曖昧な名前は推測せずに捨て、レシーバの型が取れないメンバー呼び出し（`getRepos().child.findChildById(...)`）も捨てる。出力には「ambiguous name is dropped … may undercount」と注意が出る。`src/` の `export function` 宣言 1,523 名のうち 250 名（定義 794）は 2 ファイル以上で定義され、そのうち 227 名は定義がすべて `src/lib/server/db/` にある（repo 層の facade / sqlite / demo が同じ関数名を持つ）。**repo 層は graft callers の死角**である
- **`.svelte` からの呼び出しは返さず、注意も出ない。** `getAgeTierLabel` は `tests/` の呼び出し元 1 件だけが返り、利用箇所 5 file が無いことは出力から分からない
- `graft grep "<symbol>(" --fixed` は索引に入るファイルについて grep と同じ出現を返した（`findChildById` の `src/` 内の呼び出し 30 箇所をすべて含む）。ただし `.svelte` は検索対象に入らない
- `git grep "<symbol>("` は呼び出しを取りこぼさない代わりに、定義・シグネチャの行も拾う（計 34 行）。`typeof <symbol>` のような呼び出しでない参照は拾わないので、rename では `-w` で出現全体を見る

**判断**: 呼び出し元の**列挙**を graft callers に任せると、repo 層と UI 層で黙って 0 件になり、「呼び出し元が無い」と区別できない。graft は場所の特定と呼び出し関係の理解に使い、列挙（rename / 削除 / シグネチャ変更の影響範囲）は grep で行う。root の CLAUDE.md と `.claude/skills/graft/SKILL.md` はこの判断に合わせている。

### 採用形態で退けたもの

- **`graft init` の既定構成 (hook 5 本 + statusLine + MCP)**: UserPromptSubmit / PostToolUse / Stop などでバックグラウンド同期を起動し、statusLine は各開発者の個人設定を project 設定で上書きする。並走セッションの多いこの repo では、常駐・バックグラウンド処理がメモリ不足の再発経路になるため入れない
- **repo の `.mcp.json` への登録**: 上表のとおりセッションごとに約 300MB 常駐する。CLI をその都度起動する形 (常駐ゼロ) を既定にし、MCP は各自の local scope で opt-in とする
- **devDependency として `package.json` に追加**: tree-sitter のネイティブ module を CI / Docker の `npm ci` に持ち込む。ローカル専用の道具に本番ビルドの依存を背負わせない
- **最新版 (0.19.0)**: 0.13.0 以降は依存の `tree-sitter-kotlin` が prebuild を持たず、Windows では install 時のネイティブビルドが失敗して起動できない (trailhq/Graft#323。この repo の開発機で再現)。0.12.1 に固定する

### 残る制約

- `.svelte` は索引外 (0.12.1 の対応言語は TS / JS 系)。`graft callers` / `graft grep` は `.svelte` 内の呼び出しを返さないため、rename・削除の影響範囲は `.svelte` への grep を併用する (skill に明記)。UI 層の探索は `docs/codebase-map.md` + grep を主経路のままとする
- 同名の定義が 2 つ以上ある名前は `graft callers` が 0 件を返す (上の計測)。repo 層の関数の大半がこれに当たるため、呼び出し元の列挙は grep で行う
- 再評価の起点: `.svelte` と `$lib` を型で解決できる候補は serena だけだった (上の比較)。常駐メモリを実測し、並走セッション数に耐えるかを先に確かめる
- 版固定を外す条件: upstream が #323 を解消し、Windows で `npx -y @nanonets/graft@<新版> --version` が通ること
