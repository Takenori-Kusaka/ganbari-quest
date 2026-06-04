# 0060. 「全対応完了」宣言の 10 項目検証義務 (チケット close ≠ 完了)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-06-04 |
| 起票者 | Claude (補佐、PO 判断適用) |
| 関連 Issue | #2525 (Epic) / #2892 (本 ADR + 設計書同期 PR) |
| 関連 docs SSOT | [phase1-license-key-removal-final-requirements.md §5](../design/billing-redesign/phase1-license-key-removal-final-requirements.md) (10 項目初出) |

## コンテキスト

Epic #2525 Phase 7 で「license key atom 5 step 完了」と報告した直後、PO が 5 秒 grep で LP / アプリに「ライセンスキー」言及が 125+ file 残存しているのを発見した。「関連チケットを close したから完了」という判断が、機構撤廃の実態 (アプリ `src/` に 142 occurrence / 28 file、LP `site/` 3 file、メールテンプレ、設計書 5 file) と乖離した虚偽完了報告を生んだ。

「漏れたらそこだけやる」を繰り返した結果、Stripe Subscription に移行したはずの顧客接点で「ライセンスキー」を読ませ続ける意味破綻状態が放置された。これは個別の見落としではなく、**完了の証明をチケット status に委ねた構造的失敗**である。

大規模変更 (機構撤廃 / rename / データモデル変更) において、チケット close は作業着手の終了を示すに過ぎず、変更の網羅的完遂を保証しない。完了宣言の前に、独立した機械検証で「本当に消えたか / 代替が機能するか / 設計書が同期したか」を確認する義務を横断原則として固定する必要がある。

## 検討した選択肢 (OSS / 確立パターン最低 2 件必須 — #1350)

### 選択肢 A: Definition of Done (DoD) checklist (Scrum 確立パターン)
- 概要: Scrum Guide の Definition of Done。完了条件を事前に列挙し全項目充足を完了の定義とする。業界標準 (Scrum.org / SAFe / Atlassian が推奨)。
- メリット: 文化的・宣言的。機械検証できない定性項目 (顧客接点の意味整合等) も拾える。導入コスト 0 (ルール文書のみ)。
- デメリット: 自己申告に依存すると形骸化する (本件はまさにこれ。「完了」と言いつつ未検証)。

### 選択肢 B: CI gate のみ (機械検証、`check-license-key-leak.mjs` 等)
- 概要: leak gate / grep gate を CI hard-fail に組み込み、残存を機械的に拒否する。本リポジトリは `check-no-plan-literals.mjs` / `check-hardcoded-strings.mjs` 等で多数採用済。
- メリット: 自己申告を排除し client-independent。再混入も恒久ブロック。
- デメリット: 機械検証できる項目 (grep / build) に限られる。「設計書の意味整合」「代替手段が顧客体験として成立するか」は CI で表現できない。

### 選択肢 C: A + B 併用 (本決定)
- 概要: DoD checklist (定性・横断) を CI gate (定量・恒久) で裏打ちする。検証は実装 Agent の自己申告でなく独立 grep / gate で行う。
- メリット: 定性 (DoD) と定量 (CI) が相補。本件の根因 (自己申告依存) を CI で塞ぎ、CI で表現できない意味整合を DoD で拾う。
- Pre-PMF コスト: 新規 script 不要 (既存 gate 流用)。ルール文書化のみで導入コスト最小 (ADR-0010 Bucket A 整合)。

## 決定

大規模変更 (機構撤廃 / rename / データモデル変更) の「全対応完了」宣言は、以下 **10 項目検証を必須**とする。10 項目は `phase1-license-key-removal-final-requirements.md` §5 が初出 SSOT。本 ADR で横断原則化する:

1. **機械削除完了** — import / 参照残存が grep で 0
2. **E2E + build 起動** — 5 年齢モード回帰 PASS + production build 起動成功
3. **振る舞い不変 test** — 冗長層除去後も entitlement 等の振る舞いが不変 (integration test)
4. **DB 全 backend** — sqlite / dynamodb / demo / fixture の 4 backend で整合
5. **LP / メール / 法務** — 顧客接点文言 (LP href / メール件名 / 法務文書) を全書換
6. **旧 URL redirect** — LEGACY_URL_MAP entry + E2E spec
7. **用語 grep 0 + CI gate 恒久化** — 用語残存 0 を確認し、leak gate を CI hard-fail に恒久組込
8. **代替手段確定** — 撤廃機能の代替経路 (Stripe Coupon / webhook 等) を確定・検証
9. **env / Secrets 実体撤去** — CDK / Secrets / GitHub Variables の 3 系統から撤去
10. **設計書 archive / deprecation 同期** — 撤廃機構の設計書に deprecation header + 参照元 link 同期

検証は実装 Agent の自己申告でなく、**独立した grep / CI gate で確認**する。チケット close は完了の証明にならない。

## 結果

- 「関連チケット close = 完了」判断を禁止し、10 項目の独立検証を完了宣言の前提とする。
- 項目 7 の「CI gate 恒久化」により、機械検証可能な残存は再混入も恒久ブロックされる (自己申告依存の根因を塞ぐ)。
- 項目 10 の徹底により、設計 docs が撤廃済機構を「現役 SSOT 顔」で残す事故 (本 Epic で 5 file 残存) を防ぐ。
- トレードオフ: 完了までの工数は増える。ただし「N 回目の漏れ発見 → 再着手」の手戻りコストの方が大きく、Pre-PMF でも課金等クリティカル領域では別格の慎重さが正当化される ([[billing-critical-extra-caution]])。
- 本 ADR は機械強制できない「完了の定義」原則であり、CLAUDE.md / CI gate / テンプレでは表現しきれないため ADR 化する (新規 ADR 追加 gate 条件 1 充足)。
