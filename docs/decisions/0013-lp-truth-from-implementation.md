# 0013. LP 文言は実装の事実を SSOT とする原則

- **Status**: Accepted
- **Date**: 2026-04-21
- **Related Issue**: #1310 (#1307 umbrella 派生 B9-ADR-LP-TRUTH)

## コンテキスト

2026-04 時点で「シールガチャ」という LP 文言が、実装 (`src/lib/server/services/stamp-card-service.ts` の日 1 回 cap login omikuji) と 3 年以上食い違ったまま運用されていた。

根本原因は、プライシング戦略書 / LP コピー / 販促文言が時系列で先行し、設計書 / 実装がそれを追認する**逆転構造**。過去の「未実装機能削除」パス (#315 / #418 / #426) は実装の存在は検証したが、LP が描写する mechanic と実装の mechanic の食い違いまでは検証していなかった。

LP は販促アウトプットであり、将来機能への期待・想定顧客像・価格戦略判断が先行して言語化される場でもある。これ自体は正常な業務活動だが、LP の文言が「仕様」として扱われ始めると、実装が追認する形の retrofit design doc が発生し、AC 検証 / E2E / CI / ADR のどれでもドリフトを検出できなくなる。

## 決定

### 1. LP 文言は実装の事実を SSOT として書かれる

`site/**` / `src/lib/domain/plan-features.ts` / `docs/design/19-プライシング戦略書.md` 等の販促文書は、**現在のコードで確認できる mechanic のみ**を記述する。

### 2. Committed / Aspirational の明示分離

販促文書は以下 2 セクションに分離する:

- **Committed (実装済)**: 現在の production コードで動作する mechanic。LP / pricing ページに載せて良い
- **Aspirational (目標)**: 将来の候補 / 価格戦略の仮説。LP / pricing ページには載せない、内部文書 (`docs/design/*-strategy.md` 等) 限定

### 3. Retrofit design doc 禁止

設計書 (`docs/design/*.md`) は LP の文言を後追いで追認するのではなく、実装を記述する。LP → 設計書 の方向で仕様が流れる場合、以下のいずれかを先に行う:

- (a) 実装を先に追加してから LP 文言を書く
- (b) LP 文言は Aspirational セクションに留める

### 4. LP 文言変更時の PR 要件

LP (`site/**`) / `plan-features.ts` の文言を変更する PR は、PR 本文に **「この文言が描写する mechanic のコードパス」** を明示する (具体的な関数名 / ファイルパス / テストパス)。該当コードパスが存在しない場合は Aspirational セクションへ移す or 実装 Issue を先に切る。

本ルールは別 Issue (#1314 B9-PR-TEMPLATE) で PR template に強制実装する。

### 5. CI での構造的担保

`scripts/check-lp-plan-sync.mjs` は現状 LP ↔ `plan-features.ts` の文字列同期を検証する。将来 (別 Issue #1313 B9-CI-VOCABULARY 以降) で以下に拡張したい:

- `plan-features.ts` の各エントリが、実装コードの該当コードパスに到達できるかを確認
- LP に登場する mechanic 語彙 (ガチャ / デイリー / ボーナス 等) の白リスト化

## 結果

- **pricing-strategy.md 等の販促文書は Committed / Aspirational セクション分離が必須**（既存文書は #1312 B9-DOCS で対応）
- 新 LP 文言追加時は先に実装 contract を確認するフローが定着
- LP ドリフトの検出が PR 単位で可能になる (`scripts/check-lp-plan-sync.mjs` + PR 本文コードパス明示)
- Anti-engagement 原則 (ADR-0012) の LP 文言射程 (`forbiddenTerms` 拡張) は本 ADR と連動し構造担保される

### トレードオフ

- 販促チームと実装チームを分離している大規模組織向けベストプラクティスとは逆方向 (Pre-PMF 個人開発段階では人的分離が不可能なため本 ADR で構造担保する)
- Aspirational を載せられないため「価格戦略の挑戦的提示」はしづらい — ただし不一致リスクのほうが大きいため採用

## Alternatives considered

- **LP を aspirational にしつつ「将来実装予定」注記**: 親層の信頼損失 (年単位で未実装が残存するリスク)、法的にも誤認惹起懸念あり → 却下
- **販促担当と実装担当の人的分離**: Pre-PMF では人的リソース上不可能 → 却下
- **現状維持 (LP が事実上の仕様として成立する)**: #1307 B9 で再発確認済み → 却下

## 関連

- ADR-0001 (設計書は Single Source of Truth) — 本 ADR は同原則の LP 文言への拡張
- ADR-0012 (Anti-engagement 原則) — 語彙レベルの禁忌は本 ADR と連動
- Umbrella: #1307 (B9 LP「ガチャ」呼称と実装の不整合解消)
- Blocks: #1311 (B9-LP ガチャ除去) / #1312 (B9-DOCS) / #1313 (B9-CI-VOCABULARY) / #1314 (B9-PR-TEMPLATE)
