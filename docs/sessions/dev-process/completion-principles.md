# 完遂原則 — やりきり / 全 AC 完遂 / fix-forward

> Dev セッションが「最終 goal に到達するまで完遂する」ための原則集。困難時に「逃げる」癖を構造的に止める。

**SSOT 位置付け**: [dev-process/README.md](README.md) の各論。関連: [anti-patterns.md](anti-patterns.md)（逃げシグナル語の検出）

---

## 1. 「やりきり」の定義

User の言う「やりきり」は **「1 PR で完遂」ではなく「全 phase を実施スケジュールに含め、申し送りを残さない」** の意。

- 「やりきり」= 永続 deferral / 申し送り禁止。全 phase / sub-PR が実施スケジュールに含まれていることが必須
- 「やりきり」≠ 「1 PR で完遂」。scope 分割（PR-3a/b/c のような分割）は OK
- 分割 PR は「後続 PR は実施する」前提を PR description / docs / 次の作業ステップで明示する
- EPIC close 時は「sub-PR で残っているものはないか」を必ず確認する

> 誤解例: customer use case Q&A で「Phase 2/3 を PMF 後ではなく今やり切る」と合意したのを「1 PR に全部入れる」と誤解釈し、3 repo + 17 services + 30 routes + 86 tests + admin UX + E2E + SS を 1 PR で完遂させようとして単一セッション完遂困難に陥った。

---

## 2. Dev は全 AC を完遂できる

Dev セッションは EPIC の AC を「PO 操作必須」「dogfood 待ち」を理由に open 維持してはいけない。Dev 側で代替実装する手段が必ずある。

| AC 種類 | Dev 側実装方法 |
|---|---|
| 実機動作確認 + SS 添付 | `node scripts/capture.mjs --flow <flow>` で全 5 年齢モード × breakpoint 撮影、screenshots branch へ push |
| 本番環境で送信 + 受信確認 | preview server + webpush mock + SES mock で代替 E2E、または `DEBUG_*` env で再現 |
| Stripe Checkout 動作確認 | `page.route()` で Stripe API mock + `DEBUG_PLAN` env、`tests/e2e/<flow>-checkout.spec.ts` |
| dogfood 観察期間中の異常なし | E2E spec で edge case を網羅、AC として実装で代替 |
| ランブック PO ドライラン | Dev 側で先行してチェックリスト形式の検証ガイド + 動作確認 spec を充実させ、PO 作業を最小化 |
| LP truth 整合性確認 | `grep -rn "<keyword>" site/ docs/` で監査 + 不一致あれば修正 |
| 累積観察コメント | `gh issue comment` で補強コメント投稿 |

**例外（物理的に Dev で再現不可）**: AWS Console での IAM policy 目視 / 実 OAuth provider のリダイレクト先確認。ただし「再現不可能」は **30 分以上調査して mock / E2E / 検証 spec での代替を試みた後の最終判定**とする。最初から PO 委譲は禁止。

---

## 3. 困難時は fix-forward（close / scope reset で逃げない）

困難遭遇時に「PR を close して再起動」「scope を分割」「Phase を切り直す」「follow-up Issue 起票」で premature clean state に逃げない。PO 視点では「何度試しても close されて最終 goal に到達しない」と映る。

### 困難時の振る舞い（順序厳守）

1. 「これは難しい / 行き詰まった」と気付いた瞬間に PR / Issue close 判断を一旦凍結
2. 同じ PR で fix-forward — close & restart は最終手段、PO 明示承認なしに実行しない
3. scope 分割の誘惑も同等に警戒 — Phase 化 / follow-up Issue 起票が「最終 goal を後回しにする逃げ」になっていないか自問
4. 進捗を「成果物（動く機能 / 統合された UI）」で測る — PR 数 / commit 数 / Phase 数で測らない
5. 困難時こそ最終 goal 到達に時間を集中 — 「綺麗な state にする」より「動くものを完遂」を優先

### scope 分割が正当なケース（全て満たす場合のみ）

- 最終 goal が 1 PR で実装不可能なほど大きい（例: schema migration + data backfill + UI 三段階）
- 各 phase が独立してデプロイ可能な単位
- PO が scope 分割を明示承認している
- 各 phase 完了時点で PO 視点でも進捗が見える（= ユーザに見える機能が増える）

---

## 4. はりぼて実装に逃げない（妥協前に世界中の OSS / パターンを調査）

実装方法が不明な時、「それっぽい代替案」に逃げて shim / 置換実装 / 部分実装で満足しない。妥協前に以下を必ず実行する。

1. **世界中の OSS / サービスを調査**（最低 30 分）— npm / GitHub / awesome-* リスト / 同種問題の Issue・PR
2. **公開ライブラリ / アルゴリズムを調査** — npm / GitHub / Stack Overflow / 公式ドキュメント
3. **設計パターン適合性検証** — GoF / DDD / Hexagonal / Repository / Service / DI / Strategy / Observer / Adapter / SvelteKit 固有パターン（`createContext` / `$state` / load chain）
4. **妥協が発生する場合は PO に明示質問** — 選択肢を 2〜3 個用意（例:「OSS X は bundle +50KB だが機能 Y に必要。Pre-PMF として許容するか、独自実装 30 行を選ぶか」）
5. **PR body §OSS 先調査に調査結果を明記** — 調査キーワード / 検討した OSS・パターン（不採用含む）/ 採用根拠

ADR-0014 / #1350（OSS 先調査ルール: 10 行超の独自実装前に OSS を最低 2 件調査）と整合。

> はりぼて典型シグナル（書き始めたら即停止）: 「shim として」「足場として」「POC scope で」「Tier N で本格統合」「ひとまず動く」「とりあえず」「demo と本番で違うが許容範囲」「等価性は別 Issue で」。`any` / `as unknown as X` で型を逃がすのも同類。

---

## 5. Done 基準

`[x]` を付ける前に、ゴール欄の各項目が **文字通り達成されているか**を実機 / 証跡で確認する。

- ローカル検証全 PASS（biome / svelte-check / vitest / playwright）
- ゴールのチェックリスト全項目に根拠（commit hash / テスト結果 / SS パス / grep 結果）
- UI 変更は実機ビジュアル確認 + SS。「手動確認依頼」は許容しない
- 「成果・結果」欄に具体的エビデンスを記載
- 設計書同期が必要な変更は同期完了が Done 条件（ADR-0001、別 Issue 切出し禁止）

「実画面未確認でゴールに `[x]`」「チケット提案と異なる方式で実装しながら達成と報告」は検証偽装。

---

## 6. スクラップ & ビルド時ははりぼて修正をしない

機能削除・根本 modify を行うスクラップ & ビルド作業では応急処置を積み重ねない。

- 削除対象はコメントアウトでなく完全削除（コンポーネント・サービス・型・テスト・シードデータ全て）
- 一時的な互換レイヤー（`_旧変数名` / re-export / `// removed` コメント）を残さない
- 既存コードに条件分岐を重ねるのでなく設計から見直す
- 作業量が増えることを理由に手を抜かない（品質 > 速度）
