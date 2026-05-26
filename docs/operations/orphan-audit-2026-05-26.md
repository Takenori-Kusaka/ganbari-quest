# Orphan Resource Audit — 2026-05-26 (PR_initial baseline)

EPIC #2362 follow-up — orphan resource detection 10 script の初回実行集約 report。
本ファイルは「現時点で許容している orphan の一覧」と「後続 cleanup PR の roadmap」を示す。

**関連 Issue**: EPIC #2362 (orphan resource cleanup roadmap) / Path B 系 PR (`#2458` / `#2498` 等)
**関連 ADR**: [ADR-0006](../decisions/0006-safety-assertion-erosion-ban.md) (assertion 弱体化禁止) /
[ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md) (Pre-PMF Bucket 判定)

---

## 1. 検出機構サマリ

10 種類の検出 script を導入。各 script は以下 spec で統一:

| script | 検出対象 | 検出件数 (初回) | baseline 件数 | 新規 block (CI gate 後) |
|---|---|---|---|---|
| `check-orphan-tables` | Drizzle ORM schema.ts の `sqliteTable` で定義された全 47 table | 0 | 0 | ≥1 で fail |
| `check-orphan-services` | `src/lib/server/services/*.ts` | 0 | 0 | ≥1 で fail |
| `check-orphan-repos` | `src/lib/server/db/{sqlite,demo,dynamodb}/*.ts` | 6 | 6 (DynamoDB helper sibling-import) | ≥1 で fail |
| `check-orphan-fixtures` | `src/lib/server/demo/*.ts` の `DEMO_*` exports | 2 | 2 (cleanup 候補) | ≥1 で fail |
| `check-orphan-labels` | `src/lib/domain/{labels,terms}.ts` exports | 22 | 22 (DEMO 系 + 後継統合) | ≥1 で fail |
| `check-orphan-ui` | `src/lib/ui/{primitives,components,features}/*.svelte` | 5 | 5 (Skeleton / FeatureGate 等) | ≥1 で fail |
| `check-orphan-assets` | `static/assets/` + `site/assets/` 画像 | 8 | 8 (favicon 候補 / dead .png) | ≥1 で fail |
| `check-orphan-env` | `.env.example` 全 env var | 4 | 4 (GDRIVE_* backup hook 系) | ≥1 で fail |
| `check-skip-deadlines` | `tests/` の metadata-less `.skip` / `.todo` | 26 (8 file) | 26 (8 file 単位許容) | 新規違反 1 件で fail |
| `check-orphan-routes` | `src/routes/**/+page.svelte` | 5 | 5 (動的 goto 経路 / detail page) | ≥1 で fail |
| **合計** | — | **78** | **78** | — |

**設計判断**: 「現状を全て新規 fail させない」ために初回 baseline = 検出件数。新規 orphan は CI で hard fail。
baseline 更新は PO レビュー前提 (`--update-baseline` 後に reason 列を手動で埋める運用)。

---

## 2. category 別所見

### 2.1 `tables` (0 件)

schema.ts の全 47 table が production code (services / routes / features / repo / hooks.server.ts) から
直接 or repo 経由で参照されている clean 状態。
EPIC #2362 / PR #2498 (sibling drop) 系 cleanup の完了が確認できる。

**所見**: 現状 clean。本 CI gate により今後の新規 table 追加で「production code 参照ゼロ」状態の merge は block される。

### 2.2 `services` (0 件)

`src/lib/server/services/*.ts` の全 service が production code から参照されている。
過去の service 群移行 (例: 旧 import-service 系) が綺麗に clean up されている。

### 2.3 `repos` (6 件、全て allowlisted)

| repo | 理由 |
|---|---|
| `dynamodb/auth-keys.ts` | DynamoDB 内部 helper (auth key 構築)、同 layer 内 sibling-import 専用 |
| `dynamodb/bulk-delete.ts` | bulk delete 操作 helper |
| `dynamodb/client.ts` | DynamoDB client 初期化 |
| `dynamodb/counter.ts` | atomic counter 操作 helper |
| `dynamodb/keys.ts` | partition/sort key 構築 |
| `dynamodb/repo-helpers.ts` | DynamoDB repo 共通 helper |

**所見**: いずれも DynamoDB layer 内の sibling-import 専用 (facade 経由不要)。永久 allowlist が妥当。

### 2.4 `fixtures` (2 件、cleanup 候補)

- `DEMO_CHILD_ACHIEVEMENTS`
- `DEMO_MARKETPLACE_SPECIAL_REWARDS`

**所見**: 後続 follow-up PR で `src/lib/server/demo/demo-data.ts` から削除可能。

### 2.5 `labels` (22 件、demo 撤去由来の大きな cleanup roadmap)

PR-B3 #2188 で `src/routes/demo/**` を全削除した際、対応する `DEMO_*_LABELS` 系定数が
labels.ts に取り残されている (PR-B3 scope 外として後送り) 18 件 + 後継統合済の compound 4 件:

- **PR-B3 由来 (18)**: `DEMO_SIGNUP_LABELS` / `DEMO_TOP_LABELS` / `DEMO_SETTINGS_LABELS` /
  `DEMO_STATUS_LABELS` / `DEMO_MEMBERS_LABELS` / `DEMO_POINTS_LABELS` / `DEMO_REWARDS_LABELS` /
  `DEMO_CHILD_HOME_LABELS` / `DEMO_ADMIN_HOME_LABELS` / `DEMO_REPORTS_LABELS` /
  `DEMO_LAYOUT_LABELS` / `DEMO_CHILD_CHECKLIST_LABELS` / `DEMO_ACTIVITIES_LABELS` /
  `DEMO_CHECKLISTS_LABELS` / `DEMO_CHALLENGES_LABELS` / `DEMO_CHILD_ACHIEVEMENTS_LABELS` /
  `ACTIVITIES_INTRODUCE_LABELS` / `LICENSE_PLAN_LABELS`
- **後継統合済 (4)**: `ACTIVITY_PRIORITY_LABELS` (→ `ACTIVITY_PRIORITY_FORM_LABELS`) /
  `ADMIN_CHILDREN_LABELS` (→ `ADMIN_CHILDREN_PAGE_LABELS`) /
  `NavCategoryId` / `ThemeKey` (type exports、別 type に統合済)

**所見**: 後続 cleanup PR で `labels.ts` から 22 export を削除可能 (大きな labels.ts 圧縮効果)。
ADR-0045 SSOT の atom (terms.ts) には影響なし。

### 2.6 `ui` (5 件、cleanup 候補)

- `FeatureGate.svelte` — feature flag gate、後継 ADR 確認後 cleanup
- `LoadingButton.svelte` — Button.svelte の `loading` prop に統合済
- `PremiumModal.svelte` — premium 表示 modal、利用箇所撤去で dead
- `RedemptionResultOverlay.svelte` — Dialog primitive に統合済
- `Skeleton.svelte` — Loading state を別パターンに置換

**所見**: 後続 cleanup PR で 5 component を削除可能 (UI footprint 圧縮)。stories.svelte も同時削除対象。

### 2.7 `assets` (8 件、dead asset)

| asset | 削除可能性 |
|---|---|
| `static/assets/favicon/brand-comparison.png` | favicon ブランド検討比較画像、本番未参照 |
| `static/assets/favicon/candidate-1.png` | favicon 候補画像 |
| `static/assets/favicon/candidate-2.png` | favicon 候補画像 |
| `static/assets/favicon/candidate-3.png` | favicon 候補画像 |
| `static/assets/lp/core-loop-summary.png` | LP は .webp のみ参照、.png は dead (#1907 同種事例) |
| `site/assets/lp/core-loop-summary.png` | 同上、site/ 側の dead .png |
| `static/assets/marketing/press-key-visual.png` | マーケティング素材、未参照 |
| `site/assets/ui/versus-arrow.svg` | #1838 versus section 削除に伴う dead |

**所見**: 後続 cleanup PR で物理削除可能。合計 ~1.5 MB 程度の dead bytes (favicon 候補は元解像度大)。

### 2.8 `env` (4 件、GDRIVE backup hook 系)

`GDRIVE_CLIENT_ID` / `GDRIVE_CLIENT_SECRET` / `GDRIVE_FOLDER_ID` / `GDRIVE_REFRESH_TOKEN` —
いずれも `.env.example` 内 optional 記載のみで、`scripts/hooks/gdrive-upload.cjs` (記載のみ未配備) と
の対応が完全には取れていない。

**所見**: 後続 cleanup PR で .env.example から削除 OR hook script を実装して復活、いずれか判断。

### 2.9 `skip-deadlines` (26 件、8 file)

ADR-0006 強化 (assertion 弱体化禁止 + skip metadata 強制) の初回適用。

| file | skip 件数 | 優先度 |
|---|---|---|
| `tests/e2e/production-smoke.spec.ts` | 10 | 中 (production env 依存) |
| `tests/e2e/features.spec.ts` | 7 | 高 (機能 spec 大型) |
| `tests/e2e/dialog-queue.spec.ts` | 4 | 中 |
| `tests/e2e/auth-flow.spec.ts` | 1 | 高 |
| `tests/e2e/error-page-fallback.spec.ts` | 1 | 低 |
| `tests/e2e/password-field.spec.ts` | 1 | 中 |
| `tests/e2e/pin-activity.spec.ts` | 1 | 高 |
| `tests/e2e/smoke.spec.ts` | 1 | 高 |

**所見**: 後続 cleanup PR で各 skip に直前コメントで `Issue #<番号>` または `@owner` / `deadline` を
追加。ADR-0006 強化のため期限を切って完遂する (例: 2026-08 末まで)。

### 2.10 `routes` (5 件、動的遷移経路)

- `/[uiMode]/history` / `/[uiMode]/home/initial-points` / `/[uiMode]/shop` — 子供画面の動的遷移
- `/admin/certificates/[id]` — certificate id を含む動的 detail page
- `/view/[token]` — viewer token 経由公開閲覧

**所見**: 検出 regex の dynamic param expansion 改善で誤検出抑制余地あり。後続改善で baseline 解除候補。

---

## 3. 後続 cleanup roadmap (推奨 PR 分割)

本 PR は **検出機構の導入 + baseline 確定** で完結する。実際の dead code 削除は category 別に
小さい PR で行う:

### Path C-1: labels cleanup (高効率、22 削除)
`labels.ts` から DEMO 系 18 + 後継統合 4 = 22 export を削除。LP HTML 影響なし (atom 経由)。

### Path C-2: UI components cleanup (5 削除)
`Skeleton.svelte` / `LoadingButton.svelte` / `FeatureGate.svelte` / `PremiumModal.svelte` /
`RedemptionResultOverlay.svelte` + 対応 stories.svelte を削除。

### Path C-3: assets cleanup (~1.5 MB)
favicon 候補 4 + dead .png 2 + marketing 1 + versus-arrow.svg = 8 file 削除。

### Path C-4: fixtures cleanup (2 削除)
`demo-data.ts` から `DEMO_CHILD_ACHIEVEMENTS` / `DEMO_MARKETPLACE_SPECIAL_REWARDS` 削除。

### Path C-5: env / hook 整理
GDRIVE backup hook の方針確定 (廃止 or 復活)。.env.example 整理。

### Path C-6: skip metadata 整備 (26 件、複数 PR 推奨)
ADR-0006 強化遵守。期限を切って各 skip に Issue # / @owner / deadline を追記。

---

## 4. CI 動作確認

```bash
# 全 10 script を順次実行 (CI mode = baseline 越え 1 件で exit 1)
for s in tables services repos fixtures labels ui assets env routes; do
  node scripts/check-orphan-$s.mjs || { echo "FAIL: $s"; exit 1; }
done
node scripts/check-skip-deadlines.mjs || { echo "FAIL: skip-deadlines"; exit 1; }
echo "ALL PASS"
```

初回実行 (本 PR 時点): 全 10 script PASS、合計 78 件の既知 orphan は baseline 内で許容済。

---

## 5. baseline 更新運用

新規 orphan を意図的に許容する場合 (Pre-PMF Bucket B 等):

```bash
# 1. 新規 orphan を baseline に追加
node scripts/check-orphan-<category>.mjs --update-baseline

# 2. baseline JSON の "reasons" 列を手動で埋める (PR レビュー前提)
$EDITOR scripts/orphan-baselines/<category>.json

# 3. PR 経由で commit、PO レビュー必須
```

baseline 編集を伴う PR は QA review で必ず「reason の妥当性」を確認すること。

---

## 6. 次回 retrospective 予定

- **3 ヶ月後 (2026-08)**: baseline 棚卸 — cleanup 完了で baseline から外せるものを確認
- **6 ヶ月後 (2026-11)**: 検出 logic の改善検討 — 誤検出 / 取りこぼし事例の反映
