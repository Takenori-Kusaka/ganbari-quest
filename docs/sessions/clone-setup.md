# クローン立ち上げ手順 — 5 クローン運用の SSOT

> **このファイルの位置づけ**: 新しいクローンを作ってロールセッションを起動するまでの手順。**環境要件と起動プロンプトの場所を 1 箇所にまとめる**。
>
> **関連**: [チーム憲章](README.md)（ロール体制）/ [label-mailbox.md](label-mailbox.md)（cron テンプレート）/ [agent-concurrency.md](agent-concurrency.md)（`heavy` lock）｜ **関連 Issue**: #4187 / #4199

---

## §1 設計背景

各ロール（PO / Dev / QM / 監査 / Platform）は**別クローン・別セッション**で動く。クローンを増やす手順は**どこにも書かれていなかった**。`CLAUDE.md` の Build & Test はコマンド一覧であって環境要件ではない。

**新規クローンだけが踏む問題がある。** 既存クローンは `node_modules` を持っており install をやり直さないため、依存の要求が上がっても表面化しない。実際 #4187 では、新しく clone した環境で `npm ci` が EBADENGINE で落ち、`pre-ready` が preflight で止まった。

**このファイルが無いと困ること**: クローンを増やすたびに同じ躓きを繰り返し、しかも**躓いた本人しか原因を知らない**状態になる。

---

## §2 前提 — Node の版

**版の SSOT は `.nvmrc`**（#4199）。`package.json` の `engines` と `.npmrc` の `engine-strict=true` により、**要求を満たさない Node では `npm ci` が明示的に失敗する**。

| 宣言 | 値 | 意味 |
|---|---|---|
| `.nvmrc` | `22.23.2` | CI が使う版。exact pin |
| `package.json` の `engines.node` | `>=22.22.2 <23` | 下限 = `jsdom@30` の要求 / 上限 = `better-sqlite3` の ABI 束縛による major skew 防止 |
| `.npmrc` の `engine-strict` | `true` | `engines` を**警告でなく install 失敗**にする。**外さない** — 外すと `engines` の宣言が飾りになる |

```bash
nvm install 22.23.2   # .nvmrc の値
nvm use 22.23.2
node -v               # v22.23.2
```

**PATH に古い node が残っていると、新しい方を隠す。** `nvm` の shim が効かない構成なら実体を確認する:

```bash
where node            # Windows / Git Bash。複数出たら先頭が使われる
```

---

## §3 手順

```bash
# 1. clone（ディレクトリ名はロールごとに固定、§4 の表）
cd E:/Github
git clone https://github.com/Takenori-Kusaka/ganbari-quest.git ganbari-quest-<role>
cd ganbari-quest-<role>
git checkout develop

# 2. Node を .nvmrc に合わせる（§2）
nvm use 22.23.2 && node -v

# 3. 依存 install — 2 ステップとも必要
npm ci
cd infra && npm ci && cd ..
#   infra を忘れると tests/unit/infra/ が Cannot find module 'aws-cdk-lib' で落ちる
#   （prepare script が自動実行するが warning のみで継続するため手動確認する、tests/CLAUDE.md）

# 4. install 結果を確認する
node -e "require('better-sqlite3'); console.log('bs3 OK', process.versions.node)"
ls node_modules/valibot node_modules/canvas-confetti infra/node_modules/aws-cdk-lib >/dev/null && echo "deps OK"

# 5. gh アカウントを合わせる（§4 の表）
gh auth status
node scripts/check-gh-account-before-pr.mjs   # PR を作るロールはこれが exit 0 になること
```

### major を切り替えたら必ず `npm ci` をやり直す

`better-sqlite3` は **ABI 束縛**（node-gyp / V8 API）で、major を跨ぐと再ビルドが要る。**忘れると分かりにくい native エラー**（`NODE_MODULE_VERSION` 不一致 / `ERR_DLOPEN_FAILED`）になる。

他の native（`bcrypt` / `bufferutil` / `sharp` / rollup・oxc・lightningcss 等の napi-rs 系）は **N-API（ABI 安定）**なので再ビルド不要。**版を変えて壊れうるのは `better-sqlite3` 1 本だけ。**

**クローンごとに `node_modules` は独立している。** major を切り替えたら**全クローンで `npm ci` が要る**:

```bash
for d in po dev qa audit platform; do
  (cd "E:/Github/ganbari-quest-$d" 2>/dev/null && node -e "try{require('better-sqlite3');console.log('OK  '+process.cwd())}catch(e){console.log('NG  '+process.cwd()+' — npm ci が必要')}")
done
```

---

## §4 ロール別 — クローン / 起動プロンプト / cron / gh アカウント

| ロール | クローン | 起動プロンプト（SSOT） | mailbox cron | 拾う label |
|---|---|---|---|---|
| **PO** | `ganbari-quest-po` | [po-session.md](po-session.md) | `37 * * * *` | `state:needs-po` |
| **Dev** | `ganbari-quest-dev` | [dev-session.md](dev-session.md) | `13 * * * *` | `state:needs-dev` / `state:qm-blocked` |
| **QM** | `ganbari-quest-qa` | [qa-session.md](qa-session.md) | `23 * * * *` | `state:dev-done` / `state:ready-to-merge` |
| **監査** | `ganbari-quest-audit` | [audit-team.md](audit-team.md) | `47 * * * *` | `state:needs-audit` |
| **Platform** | `ganbari-quest-platform` | [platform-session.md](platform-session.md) | `43 * * * *` | `state:needs-platform` |

**cron の分は SSOT が [label-mailbox.md §3.4](label-mailbox.md)**。同時刻に集中させないため、また `:00` / `:30` を避けるためにずらしてある。**セッション起動直後に 1 本だけ作る**（cron テンプレートは同 §4）。

`CronCreate` は**セッション内メモリのみ**で、Claude 終了で消え、7 日で失効する。**次のセッションでもう一度作る。**

### gh アカウント（ADR-0022）

| 操作 | アカウント |
|---|---|
| PR 作成 | **`Takenori-Kusaka`**（`check-gh-account-before-pr.mjs` が exit 1 で止める） |
| QA approve / merge | **`ganbariquestsupport-lab`** |

**作成者 ≠ 承認者**を保つため。クローンを跨いで同じアカウントで両方やらない。

---

## §5 躓いたときに最初に見るところ

| 症状 | 原因 | 対処 |
|---|---|---|
| `npm ci` が **EBADENGINE** で落ちる | 実行中の node が `engines` を満たしていない | §2。`where node` で複数 install を疑う（**上げる必要が無く PATH 順の問題**だった実例が #4187） |
| `pre-ready` が **preflight FAIL（sentinel 欠落）** | `npm ci` が完了していない | §3 手順 3。`npm ci` 自体が落ちていないか出力末尾を見る |
| `Cannot find module 'aws-cdk-lib'` | `infra/` の install 漏れ | `cd infra && npm ci`（[tests/CLAUDE.md](../../tests/CLAUDE.md) §テスト環境セットアップ） |
| `NODE_MODULE_VERSION` 不一致 / `ERR_DLOPEN_FAILED` | node の major を変えた後に `npm ci` していない | §3「major を切り替えたら」 |
| 重い検証が **exit 2 で止まる** | 他クローンが `heavy` lock を保持中（**マシン全体で 1 本**） | 待たずに別作業へ（[agent-concurrency.md](agent-concurrency.md)） |
| PR 作成が **PR 起票アカウント検証**で落ちる | gh アカウントが `Takenori-Kusaka` でない | §4。`gh auth switch --user Takenori-Kusaka` |

---

## §6 このファイルの更新ルール

- **Node の版を変えたら §2 の表**を更新する（値の SSOT は `.nvmrc` / `package.json`。ここは参照であって二重管理にしない）
- **ロールを増やしたら §4 の表**に 1 行足す（クローン名 / 起動プロンプト / cron 分 / 拾う label の 4 つが揃って初めて起動できる）
- **新規クローンで躓いたら §5 に 1 行足す**。躓いた本人しか知らない状態にしない
