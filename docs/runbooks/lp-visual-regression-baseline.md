# LP visual regression baseline 更新 runbook (#2452)

> **目的**: `lp-visual-regression` CI gate (ADR-0053 / #2401) が diff > 10% で hard-fail したとき、開発者が「どのコマンドで baseline を更新するか / いつ更新すべきか / CI fail をどう triage するか」を 1 ファイルで参照できるようにする。

---

## §1. 設計背景

### 1.1 この runbook がないと困ること

`lp-visual-regression` gate は意図的な LP 変更 (新 section / hero illustration / 文言差替) のたびに必ず diff > 10% で fail する。fail 自体は設計通りだが、更新コマンド・判断基準・CI artifact の取得方法が `scripts/check-lp-visual-regression.mjs` の冒頭コメント・`.github/workflows/lp-visual-regression.yml`・`docs/CLAUDE.md` ratchet 表に散在しており、「正しい更新手順」へ即座に到達できない。本 runbook はその参照先を 1 箇所に集約する。

### 1.2 baseline の所在 (3 者の対比 — 混同注意)

`screenshot` という語が指す実体が 3 つあり、混同すると誤った更新操作につながる。

| 実体 | パス | git 追跡 | 役割 |
|------|------|---------|------|
| **baseline** | `scripts/lp-screenshot-baseline/*.webp` | **git-tracked (SSOT)** | 比較の正解。PR に同梱して更新する |
| **current** | `site/screenshots/*.webp` | **git-ignored** (`.gitignore` `site/screenshots/`) | CI が撮影する現状 SS。commit しない |
| **PR 証跡 SS** | `screenshots` branch (`scripts/capture.mjs --pr <N>`) | 別 branch | PR レビューの Before/After 証跡。**LP baseline とは無関係** (§3 (C) 参照) |

`lp-visual-regression` gate は **baseline (git-tracked) と current (CI 撮影、git-ignored) を pixelmatch で比較**する。更新対象は baseline のみ。

---

## §2. 設計原則

| 原則 | 理由 |
|------|------|
| **baseline は git-tracked SSOT** | ADR-0053 (pixelmatch 採用) / ADR-0013 (LP truth: visual も「実装の事実」の一部)。cloud SaaS 管理ではなく `scripts/lp-screenshot-baseline/` に集約する |
| **閾値 `DEFAULT_THRESHOLD_PCT = 10` の恒久緩和は ADR 合意必須** | `docs/CLAUDE.md` LP メトリクス ratchet 表の方針。`--threshold` での一時上書きで CI fail を黙らせない |
| **偶発フォント rendering 差分は baseline 更新で隠さない** | preview server 起動タイミング等で生じる flake は baseline を上書きするのではなく、原因 (撮影 setup / waitForStable) を調査する |
| **triage は最小 (Pre-PMF)** | ADR-0010 整合。意図的更新 / 偶発 flake の 2 分岐で判断し、多段 decision tree を作らない |

---

## §3. 仕様

### (A) baseline 更新コマンド

意図的な LP 変更後、ローカルで以下を実行する。

```bash
# 1. current SS を撮影 (preview server を起動した状態で。全グループ撮影)
node scripts/capture-hp-screenshots.mjs --webp
#    特定群のみ撮り直す場合: --only carousel|feature|age|growth|<name>
#    例: node scripts/capture-hp-screenshots.mjs --webp --only feature-belongings-checklist

# 2. current → baseline へ上書き
node scripts/check-lp-visual-regression.mjs --update-baseline

# 3. baseline を commit (git-tracked SSOT なので PR に同梱する)
git add scripts/lp-screenshot-baseline/
git commit -m "chore: LP visual baseline 更新 (意図的 LP 変更を反映)"
```

`--update-baseline` は `site/screenshots/` (current) の全 `*.webp` を `scripts/lp-screenshot-baseline/` (baseline) へ copy する。current が空の場合は `node scripts/capture-hp-screenshots.mjs --webp` を促して exit 2 で停止するため、必ず先に撮影する。

### (B) 更新の判断基準

diff > 10% で fail したとき、**意図的か偶発かを判定してから**操作を選ぶ。

| 状況 | 操作 |
|------|------|
| 意図的な LP 変更 (新 section / hero illustration / 文言含む) | (A) で baseline 更新し PR に同梱 |
| 偶発的差分 (フォント rendering / 撮影タイミング flake) | **baseline を更新しない**。実装 / 撮影 setup を見直し、再撮影で diff が収まるか確認 |
| 意図しない regression (demo 固有 UI 映り込み / dialog 干渉 / レイアウト破壊) | **baseline を更新しない**。実装を修正する |

判定材料は CI artifact の diff PNG + JSON report (§3 (D))。`--threshold` での一時上書きや baseline 上書きで fail を隠蔽してはならない。

### (C) rebase 後の baseline sync

> **混同注意**: baseline は `git-tracked` のため、通常どおり `git add` / `commit` した時点で作業ツリーに含まれる。実装 branch を `git push --force-with-lease` で rebase しても、baseline はコミットの一部として追従するので **追加の sync 操作は不要**。
>
> `src/routes/CLAUDE.md` §「rebase 後の screenshots branch push 必須（#2063）」の `screenshots` branch は、`scripts/capture.mjs --pr <N>` が PR レビューの Before/After 証跡 SS を push する **別 branch** の話であり、LP visual baseline とは**無関係**。両者を混同して「baseline も screenshots branch に push する」必要はない。

baseline を更新したコミットを rebase で取り込む際は、通常の `git rebase origin/main` で baseline `*.webp` も含めて取り込まれる。conflict した場合は baseline ファイルを最新 (意図した) 版に解決し、再 commit する。

### (D) CI 失敗時の triage

`lp-visual-regression` workflow (`.github/workflows/lp-visual-regression.yml`、job `visual-regression-check` / step 名 `LP visual regression (pixelmatch diff)`) が fail したときの調査手順。

**1. artifact を取得する**

| artifact 名 | 内容 | 条件 | retention |
|------------|------|------|-----------|
| `lp-visual-regression` | `lp-visual-regression.json` (per-image diff %) + `tmp/visual-regression-diffs/*.png` (diff PNG) | `if: always()` (成功時も) | 14 日 |
| `lp-visual-regression-current-ss` | CI 撮影 current SS (`site/screenshots/`) | `if: failure()` (fail 時のみ) | 14 日 |

GitHub Actions の該当 run → Artifacts から download し、JSON で diff % を、diff PNG で差分箇所を確認する。

**2. 2 分岐で triage する**

- **意図的変更だった** → ローカルで §3 (A) を実行し baseline を更新、PR に同梱して再 push
- **偶発 flake / 意図しない regression だった** → baseline を更新せず、実装 / 撮影 setup を見直す (§3 (B))

**3. `missing` (撮影漏れ) も fail 対象**

baseline にあるが current にない image があると、check は `[FAIL] 撮影漏れ` として exit 1 する。capture step は `continue-on-error: true` のため、`capture-hp-screenshots.mjs` が一部 testid タイムアウトで途中失敗しても workflow は次の check step に進む。`missing` が出た場合はまず capture step のログ (撮影失敗した image) を確認し、撮影 setup を修正する。baseline 削除で「missing を消す」対処は LP truth (ADR-0013) 違反なので行わない。

---

## §4. 関連

- [ADR-0053](../decisions/0053-lp-visual-regression-pixelmatch.md) — pixelmatch 採用根拠 (OSS 6 件比較) + baseline git-tracked SSOT 方針
- `scripts/check-lp-visual-regression.mjs` — pixelmatch 比較 + `--update-baseline` 本体
- `scripts/capture-hp-screenshots.mjs` — current SS 撮影 (`--webp` / `--only`)
- `.github/workflows/lp-visual-regression.yml` — CI gate (job `visual-regression-check`、artifact upload)
- `.github/workflows/pages.yml` — GitHub Pages deploy 時に LP SS を撮影
- [`docs/CLAUDE.md`](../CLAUDE.md) LP メトリクス ratchet 表 `lp-visual-regression` 行 — 閾値 (diff ≤ 10%) と緩和ポリシー SSOT
- `src/routes/CLAUDE.md` §「rebase 後の screenshots branch push 必須（#2063）」 — 本 runbook (C) で混同を解いた **別概念**の screenshots branch 運用
- 既存 runbook 例: [`account-deletion-email-automation.md`](account-deletion-email-automation.md) (体裁参考)
