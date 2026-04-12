# 0029. Safety Assertion Erosion Ban — 既存セーフティの段階的弱体化を禁ずる

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-12 |
| 起票者 | PO |
| 関連 Issue | #911, #914 |
| 関連 ADR | ADR-0017（テスト品質ラチェット）, ADR-0020（品質ラチェット強制）, ADR-0021（デプロイ検証ゲート）, ADR-0026（ライセンスキーアーキテクチャ） |

## コンテキスト

### 発端 — #911 の事例

PR #863 が `assertLicenseKeyConfigured()` を本体コードに追加した際、対応する `AWS_LICENSE_SECRET` の **CI Secrets / SSM / NUC .env への配布が後回し**になり、結果として `deploy.yml` / `deploy-nuc.yml` が **25 連続失敗**し、本番デプロイが約 10 時間停止した（#911）。

このとき発生しかけた誘惑は次の 4 種だった：

1. production check を warn に落として CI を通す（**Assertion Erosion**）
2. `NODE_ENV === 'test'` で skip する分岐を本体に混入させる（**Test Theater**）
3. `ALLOW_LEGACY_LICENSE_KEYS=true` を恒久化する（**Stale Feature Flag**）
4. secret 配布を別 PR に切って CI を「green に偽装」する（**Goodhart's Law** — 指標を満たすことが目的化）

### 業界用語マッピング

- **Normalization of Deviance** — Diane Vaughan が Challenger 事故の組織分析で用いた語。許容されない逸脱が「いつの間にか日常化」する組織病理。安全マージンを毎回 5% ずつ削っても 1 回ごとには事故にならず、20 回後に致命傷となる。
- **Test Theater** — Yegor Bugayenko / Kent Beck らの語。実際には何も検証していないが「テストが通っている」という外観だけを取り繕う行為。
- **Fail-Open / Fail-Closed** — OWASP Top 10 2025 A10（Server-Side Request Forgery / 認可不備）の指針。security / licensing / billing / auth では **fail-closed がデフォルト**であり、guard を緩める変更は明示的な脅威モデル更新を必要とする。
- **Chesterton's Fence** — G.K. Chesterton の寓話。「なぜそこに柵があるか分からないなら、撤去してはならない」。既存の assertion を消す前に、それが追加された経緯と当時の脅威モデルを必ず確認すること。
- **Pragmatic Programmer "Board it up"** — David Thomas / Andrew Hunt。緩和（蓋）を入れるなら、いつ・誰がそれを取り外すかをセットで明記する。

Pre-PMF / 1 人体制では、PR レビュー時の社会的圧力（自分の PR を通したい）と納期圧力（とりあえず動かしたい）が同時にかかり、エンジニア出身者は構造的に Assertion Erosion を起こしやすい。**機械的に止める仕組み**が必要となる。

## 決定

### 禁止 5 項目

以下を含む PR は Copilot / PO レビューで `[must]` 所見として検出し、ADR-0029 への明示的な supersede 手続きなしには承認しない。

#### ① throw を含む production guard を warn に落とす変更

```ts
// NG
- if (!process.env.AWS_LICENSE_SECRET) {
-     throw new Error('AWS_LICENSE_SECRET is required in production');
- }
+ if (!process.env.AWS_LICENSE_SECRET) {
+     console.warn('AWS_LICENSE_SECRET not set, falling back to legacy');
+ }
```

理由: fail-closed → fail-open へのサイレントなダウングレードは OWASP A10 違反であり、警告ログは production の noise に埋もれて誰も読まない。

#### ② NODE_ENV === 'test' 等で本体コードの assertion を skip する分岐の混入

```ts
// NG
function assertLicenseKeyConfigured() {
+   if (process.env.NODE_ENV === 'test') return; // テスト用 escape hatch
    if (!process.env.AWS_LICENSE_SECRET) throw new Error(...);
}
```

理由: 本体コードに test escape hatch を入れるとそれ自体が production リグレッションの温床となる。テスト側で `vi.mock` / DI を使うこと（後者は許容）。

#### ③ ALLOW_LEGACY_* / DISABLE_* / SKIP_* の既定値を true にする変更

```diff
- ALLOW_LEGACY_LICENSE_KEYS=false
+ ALLOW_LEGACY_LICENSE_KEYS=true  # 一時的、後で戻す
```

理由: 「一時的」フラグは恒久化する。明示的な supersede 手続きが必要。

#### ④ health check / retry / timeout を根本原因未解明のまま増やす変更

```diff
- timeout: 3000,
+ timeout: 30000, // たまに失敗するので延ばす
```

理由: 「たまに失敗する」は症状であり、原因を特定するまで延長してはならない（root-cause-analyst パターン）。

#### ⑤ .skip / .todo / // @ts-expect-error / // eslint-disable の追加

許容される唯一の形式：

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- #1234, owner: @kusaka, deadline: 2026-05-01
const x: any = ...;
```

Issue 番号、owner、30 日以内の deadline コメントの **3 点セット**が無いものは自動拒否。

### Fail-Closed 原則の再確認

`security` / `licensing` / `billing` / `auth` 系の guard は OWASP Top 10 2025 A10 に従い fail-closed をデフォルトとする。緩和には脅威モデル更新と新規 ADR を必要とする。

### 境界の判別法（1 文）

> **その緩和を取り消すときの owner と deadline が PR 本文に書かれているか。書かれていない緩和はすべて禁止。書かれている緩和は許容。**

これは Pragmatic Programmer "Board it up" 原則の引用であり、緩和そのものを禁じるものではない。**「いつ誰がそれを外すかが明示されているか」**だけが境界となる。

### 例外手続き

禁止 5 項目を実行してよい唯一のルートは「**別 ADR を書き、当該 ADR を supersede する**」こと。PR 単独では不可。supersede ADR には次を必須記載：

- 緩和される ADR 番号
- 緩和の必要性（脅威モデルがどう変わったか）
- 新しい fail-mode（fail-open に倒す場合の代替検知メカニズム）
- 緩和を逆転する条件と deadline

### Chesterton's Fence 欄

safety check を**削除する** PR は次を本文に必須記載：

- 削除される assertion が**追加された過去 PR 番号**（git blame 一発）
- 当時の**脅威モデル**（その PR の説明・関連 Issue から引用）
- 現在その脅威モデルがどう変わったか（変わっていないなら削除不可）

### 新規 env / secret 追加チェックの自動化

`scripts/check-new-required-env.mjs` を新設し、PR diff から `assert*Configured()` / `throw new Error('...required...')` / `process.env.X || (() => { throw ... })()` パターンを検出する。検出された env 名（例: `AWS_LICENSE_SECRET`）について、PR 本文に **「配布済み:」証跡** が無ければ CI を red にする。詳細は ADR 末尾の運用ノートを参照。

## 結果

- Pre-PMF 1 人体制でも Assertion Erosion を機械的に止められる
- 「とりあえず CI を緑に」する誘惑が PR 単位で物理的に阻止される
- 緩和が必要な場合は ADR 経由となり、合議的・記録的な意思決定が強制される
- #911 のような「assertion 追加 → 配布忘れ → 25 連続失敗」が再発しない

## 関連

- #911 — assertion 追加 → 配布忘れ → 25 連続デプロイ失敗（本 ADR の発端）
- #914 — 本 ADR + 自動化スクリプトの起票 Issue
- ADR-0017 — テスト品質ラチェット（品質を上げる方向の縛り）
- ADR-0020 — テスト品質ラチェット強制（プロセスの縛り）
- ADR-0021 — デプロイ検証ゲート（デプロイ後の縛り）
- ADR-0026 — ライセンスキーアーキテクチャ（fail-closed の実装根拠）

## References

- Diane Vaughan, *The Challenger Launch Decision: Risky Technology, Culture, and Deviance at NASA*, University of Chicago Press, 1996.
- OWASP Top 10 2025 — A10:2025 Server-Side Request Forgery / Authorization Failures: https://owasp.org/Top10/
- Yegor Bugayenko, *Test Theater* — https://www.yegor256.com/2018/06/19/inverse-test-driven-development.html
- Google SRE Workbook, *Chapter 16 — Canarying Releases*: https://sre.google/workbook/canarying-releases/
- David Thomas & Andrew Hunt, *The Pragmatic Programmer*, 20th Anniversary Edition, Addison-Wesley, 2019, §"Tracer Bullets" / §"Boarded-Up Windows".
- G.K. Chesterton, *The Thing*, 1929 — Chesterton's Fence parable: https://fs.blog/chestertons-fence/
