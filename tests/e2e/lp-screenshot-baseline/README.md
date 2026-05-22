# LP Screenshot Baseline (#1893)

このディレクトリは LP 配信スクリーンショット (`site/screenshots/*.webp`) の visual baseline を保存する。
Issue #1893 (PO-4-7、8 回目指摘) で導入。

## 目的

LP 配信 SS が本番 NUC ユーザの実画面と乖離する事故が **PO 直接指摘 8 回連続** で再発した。
pixelmatch + sharp による visual baseline diff を導入し、「demo seed 刷新 / `?screenshot` モード変更」
等で SS が変化したことを CI で warning レベルで検出する。

## 運用フロー

### baseline 画像の追加

承認済みの SS が撮影できたら、`site/screenshots/<name>.webp` から PNG 変換して本ディレクトリに配置:

```bash
node -e "require('sharp')('site/screenshots/feature-belongings-checklist-desktop.webp').png().toFile('tests/e2e/lp-screenshot-baseline/feature-belongings-checklist-desktop.png')"
```

### diff の検証

`scripts/check-lp-screenshot-baseline.mjs`（あれば）または `pixelmatch` を直接使って、
baseline と現在の `site/screenshots/` を比較。10% 超で warning。

```bash
# 例: feature-belongings-checklist-desktop の diff を確認
node -e "
const fs = require('node:fs');
const sharp = require('sharp');
const pixelmatch = require('pixelmatch').default;

(async () => {
  const baseline = await sharp('tests/e2e/lp-screenshot-baseline/feature-belongings-checklist-desktop.png').raw().toBuffer({ resolveWithObject: true });
  const current = await sharp('site/screenshots/feature-belongings-checklist-desktop.webp').resize(baseline.info.width, baseline.info.height).raw().toBuffer({ resolveWithObject: true });
  const diff = pixelmatch(baseline.data, current.data, null, baseline.info.width, baseline.info.height, { threshold: 0.1 });
  const ratio = diff / (baseline.info.width * baseline.info.height);
  console.log('diff ratio:', (ratio * 100).toFixed(2), '%');
})();
"
```

## 対象 baseline (#1893 AC6)

| ファイル名 | 撮影元 | 用途 |
|----------|--------|------|
| `feature-belongings-checklist-desktop.png` | `/checklist?childId=903` (#2097 PR-B1 で本番ルート化) | machine-tour ② 持ち物チェックリスト |
| `feature-cheer-message-desktop.png` | `/admin/messages` (#2199 で振替 — versus-row4「旅行先・祖父母宅でも続けられる」訴求の家族おうえんメッセージ送信 UI) | versus-row4 おうえんメッセージ送信 |
| `feature-monthly-report-desktop.png` | `/admin/status?childId=903` (#2200 で childId 明示 — elementary fixture けんたくん 3,400P でレーダーチャート 5 軸を埋める) | soft-features 月次レポート |
| `feature-auto-sleep-desktop.png` | `/admin/settings/activities` (scrollTo: `[data-testid="settings-decay-section"]`、#2201 でステータス減少設定にリフレーム、#2410 で #2319 settings 分割に追従 — decay UI は activities サブルートに移動) | soft-features ステータス減少設定 |

## 注意事項

- **baseline 画像は適切に承認された SS のみコミット**する。CI 撮影直後の自動生成画像をそのまま baseline に
  すると、本番乖離があっても warning にならない (#1893 の根本原因と同じ罠を再生産する)
- baseline 画像更新時は PR body に「なぜ更新したか」を必ず記載 (Issue #1893 の AC8 参照)
