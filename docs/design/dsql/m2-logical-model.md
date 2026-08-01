# M2 論理データモデル（Logical Data Model / relational・DBMS 非依存）— がんばりクエスト

> **状態**: M2 成果物（初版・M2 board 未レビュー）。**入力 = M1 概念モデル**（`docs/design/dsql/m1-conceptual-model.md`、Round 1〜6 で 0 must 収束・確定済）。関連: EPIC #3424（DSQL 移管）/ M2 プロセス定義 `docs/design/dsql/detailed-design-process.md` §M2。
>
> **層の位置づけ（ANSI-SPARC）**: 本書は **論理層（logical schema）** に限定する。M1 概念層の entity / 関係 / 集約 / 不変条件を **リレーショナルに写像**し、正規化・関数従属・候補キー / 主キー / 外部キー・導出関係を relational だが **DBMS 非依存**に定義する。
>
> **DBMS 非依存の宣言（本書が扱わないもの＝すべて M3 物理設計の責務）**: 物理データ型（int / bigint / varchar / uuid / jsonb 等）、主キーの物理形式・凍結・生成方式（連番 / uuid / 合成）、索引（index / covering / ASYNC index）、JSON 格納方針、CHECK 制約の SQL 構文、派生量を物理的に materialize するか否か、トランザクション / 楽観制御 / 分散配置機構、FK の物理実装（DSQL は FK 非対応 → app/CHECK 担保は M3）、方言差（DSQL / sqlite）。本書はこれらに一切踏み込まない。論理レベルの relation / 属性（論理型）/ 関数従属 / 正規形 / 候補キー / 主キー / 外部キー / 参照整合宣言 / 導出関係 のみを記述する。
>
> **M1 忠実写像の原則**: M1 の決定（PointLedger は経済点数の唯一権威、per-child 主軸、残高＝台帳総和の派生、非経済値・KPI スナップショットは述語で scope 外、LoyaltyState 記念チケットは点数経済外の別通貨、チェックリストのみ family master+配信+進捗の 3 層 等）を **覆さず・足さず** relational に写像する。M1 に ER 構造を与えられなかった軽微概念（L-14 の一部）は §6 未決論点として明示し、勝手に構造を作らない（no-silent-gap）。

---

## §0 論理型の語彙（DBMS 非依存の抽象型）

属性のデータ型は以下の **論理型**（抽象ドメイン）で記述する。物理型（可変長上限・数値精度・格納幅・エンコーディング）は M3 で確定する。

| 論理型 | 意味 | 例 |
|---|---|---|
| `識別子` | 概念の同一性（物理形式＝代理連番 / uuid / 自然複合 は M3） | Family の同一性 |
| `文字列` | 可変長テキスト（原子値） | 家族名・ニックネーム |
| `コード` | 短い列挙的自然キー文字列 | カテゴリコード |
| `整数` | 整数（点数・XP・回数・枠番号 等） | 付与ポイント |
| `数値` | 小数を含みうる量 | 換算レート・誕生日ボーナス倍率・標準偏差 |
| `真偽` | ブール | 取消済か |
| `日付` | 暦日（時刻なし） | 記録日・週の開始 |
| `時刻` | 時刻（日付なし） | リマインダ時刻 |
| `日時` | 瞬間（instant） | 記録日時・発生日時 |
| `列挙<…>` | 有限値集合（値集合の確定は M3 の場合その旨明記） | 役割 = owner/parent/child |
| `秘匿値` | 平文非保持で照合可能な秘密 | 保護者 PIN |
| `参照<R>` | 他リレーション R への外部キー参照（論理的参照整合） | 参照<CHILD> |
| `値オブジェクト<…>` | 同一性を持たず原子的に読み書きされる不透明複合値（L-18 で read パターン上「展開不要」と確認したもののみ） | 戦闘時ステータス |

> **参照整合の宣言原則**: すべての `参照<R>` は論理的な外部キー制約（参照先タプルの存在・所有家族境界の一致）を宣言する。DSQL の FK 非対応は物理問題であり **M3 が app 側 / CHECK 相当でどう担保するかを決める**。M2 は「論理的にどの参照が整合すべきか」を宣言する。

> **テナント到達（I-CHILD-FAM）の写像原則**: 子供スコープの各リレーションは直近の所有者（`参照<CHILD>` または `参照<FAMILY>`）への FK を宣言する。家族への到達は FK 連鎖（… → CHILD → FAMILY）で一意に定まる。**各リレーションに family 識別子を非正規化冗長配置するか否か（テナント隔離・クエリ最適化目的）は M3 の物理判断**であり、論理層は FK 連鎖で家族所有を表現する（M1 §2「導出経路は概念では不問」/ L-01 の明示所有を FK で担保）。

---

## §1 リレーション一覧（集約別）

記法: 各リレーションに **属性（論理型・注記）/ 候補キー CK / 主キー PK / 外部キー FK / 主要 FD / 正規形** を示す。`{…}` は属性集合。導出属性は「導出」と明記し §4 に集約（基底リレーションには保持しない＝ materialize 判断は M3）。

集約グループ（M1 §4.2）を relation グループとして反映する。**各集約ルートのトランザクション整合境界は M1 の集約境界と一致**し、集約横断参照は論理 FK（結果整合の実現は M3）。

### §1.1 集約 Family（C1/C2、縮小後ルート）+ 家族方針・1:1 従属

M1 §4.2 で Family ルートは「不変条件を担う概念のみ」。家族方針・認証資格・契約は **family 識別子を候補キーとする 1:1（または 1:0..1）従属リレーション** に縦分解する（各々独立概念＝L-14 decompose の写像、疎な広幅 Family を避け BCNF を保つ）。縦分解を物理的に 1 表へ clustering するか別表にするかは M3。

#### R-FAMILY（家族 = 最上位テナント境界）
- 属性: `{ 家族同一性: 識別子, 家族名: 文字列, 作成日時: 日時, 最終活動日時: 日時, 既定子供: 参照<CHILD>?（任意, DefaultChildSelection の写像）}`
- CK: `{家族同一性}` / PK: `{家族同一性}`
- FK: `既定子供 → R-CHILD`（任意, 同一家族内の子供に限る＝論理制約）
- FD: `家族同一性 → 家族名, 作成日時, 最終活動日時, 既定子供`
- 正規形: 3NF（全非キー属性が主キーに完全関数従属、推移従属なし）

#### R-USER（利用者 = 家族に閉じない独立参照, Q-02=A）
- 属性: `{ 利用者同一性: 識別子, メールアドレス: 文字列（家族横断で一意）, 認証プロバイダ: 列挙<値集合はベンダ名を持ち込まない>, 表示名: 文字列? }`
- CK: `{利用者同一性}`, `{メールアドレス}`（自然候補キー・UNIQUE） / PK: `{利用者同一性}`
- FD: `利用者同一性 → メールアドレス, 認証プロバイダ, 表示名` ／ `メールアドレス → 利用者同一性`（相互従属＝両者候補キー）
- 正規形: 3NF。**自然キー露出**: メールアドレスを業務候補キー（UNIQUE）として露出する（DynamoDB の opaque 単一 id 一律強制を排す, L-12）。PK にメールを採るか安定同一性を採るかの選択は §3。

#### R-MEMBERSHIP（所属 = 利用者×家族の連関, 役割 1 つ, L-09/I-MEM）
- 属性: `{ 家族: 参照<FAMILY>, 利用者: 参照<USER>, 役割: 列挙<owner/parent/child>, 参加日時: 日時, 招待者: 参照<USER>?, 対象子供: 参照<CHILD>?（role=child 行のみ非 NULL・UNIQUE, I-CHILD-USER の写像）}`
- CK: `{家族, 利用者}`（自然連関キー）。現行 single（Q-07=A, 1 利用者=1 所属）では `{利用者}` が最小候補キー。**`対象子供` は候補キーでなく「条件付き一意制約（filtered unique）＝role=child 部分集合上の一意」**（nullable ゆえ候補キーの NOT NULL 要件を満たさない。0..1:0..1 の写像自体は一意 FK で正しい, Round 2 [should]） / PK: `{家族, 利用者}`
- FK: `家族 → R-FAMILY`, `利用者 → R-USER`, `招待者 → R-USER`, `対象子供 → R-CHILD`（**Round 1 [must]4 反映**: M1 `CHILD |o--o| MEMBERSHIP`（role=child, 0..1:0..1, I-CHILD-USER）を担う FK。role=child 行のみ非 NULL、同一家族の子供に限る＝ §5 述語）
- FD: `{家族, 利用者} → 役割, 参加日時, 招待者, 対象子供`
- 正規形: 3NF。役割を単一の所属関係に集約し二重書き（L-09）を排除。I-MEM（役割 1 つ）は「役割が主キーでなく従属属性＝1 タプル 1 役割」で写像。I-OWN（owner ちょうど 1 名）は単一リレーション内の**述語制約**（family ごとに役割=owner のタプルが 1 件）で §5 にマップ。
- **PK 選択の根拠（Round 1 [should]）**: Q-07=A（1 利用者 1 家族）下の最小候補キーは `{利用者}` だが、PK には連関自然キー `{家族, 利用者}`（非最小 superkey）を採る。将来 M:N 反転（§9）時に `{利用者}` が候補キーでなくなっても連関キー PK が安定して残る（連関安定性優先）。非最小である旨は承知の上での選択。

#### R-INVITE（招待）
- 属性: `{ 招待同一性: 識別子, 家族: 参照<FAMILY>, 付与役割: 列挙<owner/parent/child>, 状態: 列挙<pending/accepted/…（値集合 M3）>, 宛先メール: 文字列, 対象の子供: 参照<CHILD>?, 有効期限: 日時 }`
- CK: `{招待同一性}` / PK: `{招待同一性}`
- FK: `家族 → R-FAMILY`, `対象の子供 → R-CHILD`（任意, 同一家族）
- FD: `招待同一性 → 家族, 付与役割, 状態, 宛先メール, 対象の子供, 有効期限`
- 正規形: 3NF

#### R-CONSENT_RECORD（同意記録 = 追記のみ, I-CONS）
- 属性: `{ 同意同一性: 識別子, 家族: 参照<FAMILY>, 同意本人: 参照<USER>, 種別: 列挙<ConsentType>, 版: 文字列, 同意日時: 日時, 取得時環境: 値オブジェクト<IP/UA 等・原子捕捉 Q-09> }`
- CK: `{同意同一性}`。自然候補キー `{家族, 同意本人, 種別, 版, 同意日時}` / PK: `{同意同一性}`
- FK: `家族 → R-FAMILY`, `同意本人 → R-USER`
- FD: `同意同一性 → {家族, 同意本人, 種別, 版, 同意日時, 取得時環境}`
- 正規形: 3NF。**「現在の同意」は本リレーションからの導出（§4 D-CONSENT）**であり別保持しない（I-CONS）。取得時環境は L-18 で不透明原子値と確認済のため値オブジェクト（展開しない）。

#### R-PARENT_GATE_CREDENTIAL（保護者ゲート認証, 家族 1:1, ADR-0050）
- 属性: `{ 家族: 参照<FAMILY>, 保護者PIN: 秘匿値, 連続失敗回数: 整数, ロック解除時刻: 日時?, リセット適用痕跡: 文字列（運用リセットの冪等印）}`
- CK: `{家族}`（1:1 従属＝family が候補キー） / PK: `{家族}`
- FK: `家族 → R-FAMILY`
- FD: `家族 → 保護者PIN, 連続失敗回数, ロック解除時刻, リセット適用痕跡`
- 正規形: 3NF。署名セッションは無状態でリレーション化しない（M1 §2 注 / L-14c）。

#### R-EMAIL_LOGIN_LOCKOUT（メールログインロック = メール単位・家族非依存, I-EMAIL-LOCK）
- 属性: `{ 対象メール: 文字列, 連続失敗回数: 整数, ロック解除時刻: 日時?, 最終失敗時刻: 日時? }`
- CK: `{対象メール}` / PK: `{対象メール}`
- FK: なし（家族非依存。R-USER への FK は張らない＝ユーザー未登録メールもロック対象になりうるため。論理的にメール文字列で識別）
- FD: `対象メール → 連続失敗回数, ロック解除時刻, 最終失敗時刻`
- 正規形: 3NF。保護者ゲート PIN ロック（家族単位）とは別機構（別上限・別期間）。

#### R-SUBSCRIPTION_STATE（契約状態, 家族 1:1, Q-01=A）
- 属性: `{ 家族: 参照<FAMILY>, 契約状態: 列挙<trial/active/past_due/canceled/free>, プラン: 参照<PLAN>?, プラン有効期限: 日時?, トライアル使用日時: 日時? }`
- CK: `{家族}` / PK: `{家族}`
- FK: `家族 → R-FAMILY`, `プラン → R-PLAN`
- FD: `家族 → 契約状態, プラン, プラン有効期限, トライアル使用日時`
- 正規形: 3NF。権利（entitlement）は状態から算出する導出であり保持しない（M1 §6 `isEntitledTo`）。I-SUB（トライアル二度取り禁止・状態遷移系列）は §5 に述語マップ。

#### R-TRIAL_HISTORY（トライアル履歴 = 追記のみ）
- 属性: `{ 履歴同一性: 識別子, 家族: 参照<FAMILY>, …（開始/終了/層 等, M1 §3.1 では属性未詳細）}`
- CK: `{履歴同一性}` / PK: `{履歴同一性}` / FK: `家族 → R-FAMILY`
- 正規形: 3NF（追記イベント, 自然キーなし→識別子）。属性詳細は M1 で未展開のため M3 で確定（本書は entity→relation 写像を保証, 属性列は M1 の粒度に従う）。

#### R-CANCELLATION_REASON（解約理由 = 追記のみ）
- 属性: `{ 理由同一性: 識別子, 家族: 参照<FAMILY>, カテゴリ: 列挙, 自由記述: 文字列?, 発生日時: 日時 }`
- CK: `{理由同一性}` / PK: `{理由同一性}` / FK: `家族 → R-FAMILY`
- 正規形: 3NF

#### R-LOYALTY_STATE（ロイヤルティ状態, 家族 1:0..1）— **記念チケットは点数経済外の別通貨**
- 属性: `{ 家族: 参照<FAMILY>, 継続月数: 整数, 記念チケット数: 整数, 最終加算月: 文字列 }`
- CK: `{家族}` / PK: `{家族}` / FK: `家族 → R-FAMILY`
- FD: `家族 → 継続月数, 記念チケット数, 最終加算月`
- 正規形: 3NF。**繰越 [note] 反映**: `記念チケット数` は **PointLedger（点数経済）とは独立の第 2 通貨のカウンタ**であり、I-BAL / I-LEDGER-AUTH の対象外（残高＝台帳総和に入らない）。§4 D-LOYALTY で「別通貨」として明示。記念チケットに独立台帳を設けるか（消費監査可能性）は §6 未決論点（M1 はカウンタとしてのみ定義しており、本書は M1 を覆さずカウンタ写像を採る）。

#### R-ACCOUNT_LIFECYCLE（アカウント状態機械, 家族 1:1, I-LIFECYCLE）
- 属性: `{ 家族: 参照<FAMILY>, 状態: 列挙<active/soft-deleted/purged>, 論理削除日時: 日時?, 猶予プラン層: 参照<PLAN_TIER>?, 物理削除予定日: 日付? }`
- CK: `{家族}` / PK: `{家族}` / FK: `家族 → R-FAMILY`, `猶予プラン層 → R-PLAN_TIER`（Round 2 [should]: [must]1 で猶予日数を R-PLAN_TIER へ外出しし「層＝tier」と整合、`参照<PLAN>` の曖昧を解消）
- FD: `家族 → 状態, 論理削除日時, 猶予プラン層, 物理削除予定日`
- 正規形: 3NF

#### R-DECAY_POLICY（減衰方針, 家族 1:1, L-17）
- 属性: `{ 家族: 参照<FAMILY>, 強度: 列挙<none/gentle/normal/strict>, 猶予日数: 整数 }`
- CK: `{家族}` / PK: `{家族}` / FK: `家族 → R-FAMILY`
- 正規形: 3NF

#### R-APPROVAL_POLICY（承認方針, 家族 1:0..1）
- 属性: `{ 家族: 参照<FAMILY>, 自動承認するか: 真偽 }`
- CK: `{家族}` / PK: `{家族}` / FK: `家族 → R-FAMILY`
- 正規形: 3NF

#### R-POINT_CONVERSION_POLICY（ポイント換算方針, 家族 1:0..1）
- 属性: `{ 家族: 参照<FAMILY>, 単位表示モード: 列挙, 通貨: 文字列, 換算レート: 数値 }`
- CK: `{家族}` / PK: `{家族}` / FK: `家族 → R-FAMILY`
- 正規形: 3NF。換金オペレーション（負エントリの発生）とは別概念（M1 §3.4）＝算定入力のみ。

#### R-NOTIFICATION_SETTINGS（通知設定, 家族 1:0..1）
- 属性: `{ 家族: 参照<FAMILY>, リマインダ有効: 真偽, リマインダ時刻: 時刻?, 連続通知有効: 真偽, 静音開始: 時刻?, 静音終了: 時刻? }`
- CK: `{家族}` / PK: `{家族}` / FK: `家族 → R-FAMILY`
- FD: `家族 → リマインダ有効, リマインダ時刻, 連続通知有効, 静音開始, 静音終了`
- 正規形: 3NF。M1 の `静音時間帯: 値オブジェクト` を **静音開始/静音終了 の 2 原子属性に展開**（時間帯は範囲述語に使われうるため展開が自然, Q-04 基準）。単一の不透明値でよければ値オブジェクトのままとする選択は M3 の read パターン確認事項（本書は展開を既定）。

#### R-BONUS_RULE（ボーナスルール群, family master, 1:N, ADR-0055）
- 属性: `{ ルール同一性: 識別子, 家族: 参照<FAMILY>, 条件種別: 列挙, 発火条件_指標: 文字列?, 発火条件_閾値: 数値?, 加算点: 整数?, 倍率: 数値?, 有効か: 真偽 }`
- CK: `{ルール同一性}` / PK: `{ルール同一性}` / FK: `家族 → R-FAMILY`
- FD: `ルール同一性 → 家族, 条件種別, 発火条件_*, 加算点, 倍率, 有効か`
- 正規形: 3NF。M1 の `発火条件: 値オブジェクト` を評価に使う意味ある属性へ展開（Q-04）。効果は記録時に基礎点へ畳み込む（独立台帳エントリを生まない, L-19）＝別リレーションを生じない。

### §1.2 集約 ChildProfile（C3）+ 休養日

#### R-CHILD（子供 = 所有スコープの identity アンカー）
- 属性: `{ 子供同一性: 識別子, 家族: 参照<FAMILY>, ニックネーム: 文字列, 生年月日: 日付?, 手動固定年齢帯: 列挙<baby/preschool/elementary/junior/senior>?（手動固定時のみ非 NULL）, テーマ: 文字列, アバター画像参照: 参照<CHARACTER_IMAGE>?, 表示_色: 文字列?, 表示_装飾: 文字列?（DisplayConfig 展開）, 誕生日ボーナス倍率: 数値, 前回誕生日ボーナス付与年: 整数?, アーカイブ済か: 真偽, アーカイブ理由: 列挙? }`
- CK: `{子供同一性}` / PK: `{子供同一性}`
- FK: `家族 → R-FAMILY`, `アバター画像参照 → R-CHARACTER_IMAGE`（任意, 同一子供所有）
- FD: `子供同一性 → 家族, ニックネーム, 生年月日, 手動固定年齢帯, テーマ, …（列挙）`
- 導出注記: **年齢は保持しない**（生年月日と現在時刻からの導出＝I-AGE, §4 D-AGE）。**Round 1 [must]2 反映（stale-on-birthday anomaly 除去）**: 当初 `年齢帯モード` を常時格納していたが、非固定時に `生年月日 → 年齢帯モード` の導出 FD が残り L-10 の年齢と同型の誕生日跨ぎ stale anomaly を起こす。→ 列を **`手動固定年齢帯`（nullable、手動固定時のみ非 NULL＝手動固定フラグを兼ねる）** に改名し、**実効年齢帯は D-AGE で導出**（手動固定年齢帯が非 NULL ならその値が権威、NULL なら D-AGE の導出値）。これで非固定行に導出 FD が残らない。
- 正規形: 3NF（`手動固定年齢帯` は手動固定という別事実であり生年月日から導出されない＝推移従属なし）。`表示構成: 値オブジェクト` を意味ある原子属性に展開（M1 §3.2 明示指示「個別の意味ある属性へ展開」）。

#### R-REST_DAY（休養日 = 減衰猶予日, I-DECAY 入力）
- 属性: `{ 子供: 参照<CHILD>, 対象日: 日付, 理由: 文字列? }`
- CK: `{子供, 対象日}`（自然複合キー） / PK: `{子供, 対象日}` / FK: `子供 → R-CHILD`
- FD: `{子供, 対象日} → 理由`
- 正規形: 3NF

### §1.3 集約 ActivityCatalog（C4, 記録の「設定」）

#### R-CHILD_ACTIVITY（子供の活動, per-child instance, L-02）
- 属性: `{ 活動同一性: 識別子, 子供: 参照<CHILD>, カテゴリ: 参照<CATEGORY>, 名称: 文字列, アイコン: 文字列, 基礎ポイント: 整数, 優先度: 列挙<must/optional>, 1日あたり上限: 整数, メインクエストか: 真偽, 表示するか: 真偽, 取込元テンプレート: 参照<外部プリセット>?（帰属記録のみ, M1 scope 外の弱参照）}`
- CK: `{活動同一性}` / PK: `{活動同一性}`
- FK: `子供 → R-CHILD`, `カテゴリ → R-CATEGORY`。`取込元テンプレート` は **テナント外公開プリセットへの弱い帰属参照**（M1 §10 で公開プリセットは M1 scope 外）＝論理 FK を張らない帰属記録（存在しない/削除済でも活動は存続, L-05 型の歴史性）。
- FD: `活動同一性 → 子供, カテゴリ, 名称, アイコン, 基礎ポイント, 優先度, 1日あたり上限, メインクエストか, 表示するか, 取込元テンプレート`
- 正規形: 3NF。家族マスタ活動は存在しない（per-child instance, L-02）。

#### R-ACTIVITY_PREFERENCE（ピン留め設定, 活動 1:0..1）
- 属性: `{ 活動: 参照<CHILD_ACTIVITY>, ピン留め: 真偽, 表示順: 整数? }`
- CK: `{活動}` / PK: `{活動}` / FK: `活動 → R-CHILD_ACTIVITY`
- 正規形: 3NF（活動 1:0..1 の縦分解）

#### R-ACTIVITY_MASTERY（習熟度, 活動 1:0..1）
- 属性: `{ 活動: 参照<CHILD_ACTIVITY>, 累計回数: 整数（導出候補）, 習熟レベル: 整数（導出）}`
- CK: `{活動}` / PK: `{活動}` / FK: `活動 → R-CHILD_ACTIVITY`
- 導出注記: `累計回数` は当該活動の取消されていない記録数の導出（§4 D-MASTERY）、`習熟レベル` は累計回数の関数（I-DERIVED）。基底リレーションは identity（活動）＋導出量。materialize 判断は M3。
- 正規形: 3NF

#### R-DAILY_MISSION（今日のミッション, I-MISSION）
- 属性: `{ 対象日: 日付, 活動: 参照<CHILD_ACTIVITY>, 完了か: 真偽（導出候補）}`（**子供は保持せず活動経由で導出**、Round 2 [must] 是正）
- CK: `{対象日, 活動}`（唯一の候補キー） / PK: `{対象日, 活動}`
- FK: `活動 → R-CHILD_ACTIVITY`（子供は R-CHILD_ACTIVITY.子供 経由で到達＝**R-ACTIVITY_LOG と同じ活動経由参照**でモデル内一貫）
- FD: `{対象日, 活動} → 完了か`
- 正規形: **BCNF**（Round 2 [must] 是正）。Round 1 で「3NF だが非 BCNF／子供=冗長 prime／R-STAMP_ENTRY 同水準」と framing したのは**誤り**: `活動 → 子供` は「非超キー `活動` → 非 prime `子供`」の **3NF 定義違反**（R-STAMP_ENTRY は両決定項が候補キーの真正 BCNF で別次元）。正規化は M2 の責務ゆえ M3 送りにせず、**`子供` 属性 + FK を削除し活動経由導出**とすることで唯一候補キー `{対象日,活動}` の BCNF に是正した。子供＝活動所有子供が自明化するため「活動所有子供＝本行子供」述語も不要化。
- 導出注記: 子供 = 活動.子供（導出）。完了状態は記録履歴から再判定可能（I-MISSION / I-ADD）＝ D-MISSION-DONE。

### §1.4 集約 GrowthJournal（C5, I-REC の atomic 境界。点数は含まない）

#### R-ACTIVITY_LOG（活動記録）
- 属性: `{ 記録同一性: 識別子, 活動: 参照<CHILD_ACTIVITY>, 記録日: 日付, 記録日時: 日時, 付与ポイント: 整数（記録時捕捉・非権威観測値）, 連続日数: 整数（記録時確定・不変観測値）, 連続ボーナス: 整数（記録時確定・不変観測値）, 取消済か: 真偽 }`
- CK: `{記録同一性}` / PK: `{記録同一性}` / FK: `活動 → R-CHILD_ACTIVITY`
- FD: `記録同一性 → 活動, 記録日, 記録日時, 付与ポイント, 連続日数, 連続ボーナス, 取消済か`
- 正規形: 3NF。**制御された冗長（正規化違反ではない）**: `付与ポイント` は PointLedger（権威）と重複するが、これは **記録時に捕捉した非権威な歴史的観測値**（I-LEDGER-AUTH / I-SATELLITE-RECON, L-05 と同型の業務イベント不変性）。権威は R-POINT_LEDGER_ENTRY。`連続日数/連続ボーナス`（streak）は記録時確定の不変観測値で再導出しない（I-STREAK-VS-COMBO, 導出関係でなく歴史的事実）。

#### R-STATUS（カテゴリ別ステータス, I-STATUS, 子供×カテゴリで一意）
- 属性: `{ 子供: 参照<CHILD>, カテゴリ: 参照<CATEGORY>, 累計XP: 整数（導出）, レベル: 整数（導出）, 到達最高XP: 整数（導出）}`
- CK: `{子供, カテゴリ}`（自然複合キー, I-STATUS） / PK: 同上
- FK: `子供 → R-CHILD`, `カテゴリ → R-CATEGORY`
- 導出注記: `累計XP = Σ成長 − Σ減衰`（R-STATUS_HISTORY からの導出, I-DERIVED, §4 D-XP）、`レベル = f(累計XP)`、`到達最高XP = max(履歴の変化後の値)`。基底は identity（子供, カテゴリ）＋導出量。materialize は M3。
- 正規形: 3NF。自然同一性で語る（L-12）＝ opaque 単一 id を強制しない。

#### R-STATUS_HISTORY（成長・減衰履歴 = 追記のみ）
- 属性: `{ 履歴同一性: 識別子, 子供: 参照<CHILD>, カテゴリ: 参照<CATEGORY>, 変化量: 整数, 変化種別: 列挙<gain/daily_decay/…（値集合 M3）>, 変化後の値: 整数, 記録日時: 日時 }`
- CK: `{履歴同一性}`。自然候補キー `{子供, カテゴリ, 記録日時, 変化種別}`（同時刻同種の分離は M3） / PK: `{履歴同一性}`
- FK: `子供 → R-CHILD`, `カテゴリ → R-CATEGORY`。（`{子供, カテゴリ}` は R-STATUS への論理 FK でもある）
- FD: `履歴同一性 → 子供, カテゴリ, 変化量, 変化種別, 変化後の値, 記録日時`
- 正規形: 3NF。R-STATUS の導出源。

#### R-EVALUATION（週次評価, Child 衛星）
- 属性: `{ 評価同一性: 識別子, 子供: 参照<CHILD>, 週の開始: 日付, 週の終了: 日付, ボーナスポイント: 整数（捕捉観測値・非権威）}`
- CK: `{評価同一性}`。自然候補キー `{子供, 週の開始}` / PK: `{評価同一性}`
- FK: `子供 → R-CHILD`
- 正規形: 3NF。`ボーナスポイント` は weekly_bonus 付与の捕捉観測値（権威は PointLedger, I-SATELLITE-RECON）。

#### R-EVALUATION_SCORE（カテゴリ別スコア, L-04 展開）
- 属性: `{ 評価: 参照<EVALUATION>, カテゴリ: 参照<CATEGORY>, スコア: 数値 }`
- CK: `{評価, カテゴリ}`（連関自然キー） / PK: 同上
- FK: `評価 → R-EVALUATION`, `カテゴリ → R-CATEGORY`
- FD: `{評価, カテゴリ} → スコア`
- 正規形: 3NF。旧スコア埋め込み文書を独立要素へ展開（L-04）。

> **GrowthJournal 集約整合 (I-REC)**: R-ACTIVITY_LOG 1 件生成 + R-STATUS 更新 + R-STATUS_HISTORY 追記 + R-ACTIVITY_MASTERY 更新 は同一集約の atomic 境界（部分成立不可）。**点数は本集約に含めず**、確定後に R-POINT_LEDGER_ENTRY へ `activity` 付与事象を要請（集約横断・結果整合）。これは静的リレーション制約でなくトランザクション不変条件＝ §5 で「M3 realization」とマップ。

### §1.5 集約 PointLedger（C5, 残高非負を守る唯一の境界）

#### R-POINT_LEDGER_ENTRY（点数事象 = 追記のみ, 経済点数の唯一権威, I-LEDGER-AUTH）
- 属性: `{ エントリ同一性: 識別子, 子供: 参照<CHILD>, 増減量: 整数（正=付与/負=裁量消費 or award逆転/中立=繰越）, 種別: 列挙<付与/裁量消費/award逆転/繰越 の各種別・代表例は M1 §3.3・値集合と CHECK 集合の確定は M3>, 説明: 文字列, 由来参照: 参照<弱・任意>?, 発生日時: 日時 }`
- CK: `{エントリ同一性}` / PK: `{エントリ同一性}` / FK: `子供 → R-CHILD`
- FD: `エントリ同一性 → 子供, 増減量, 種別, 説明, 由来参照, 発生日時`
- 正規形: 3NF。**残高は本リレーションの導出**（§4 D-BALANCE, I-BAL）＝独立事実として保持しない（L-03「残高二重保持」を排す）。`由来参照` は衛星集約への弱い業務参照（削除耐性を持つ任意 FK, 論理整合は弱制約）。**種別の個数を断言しない**（M1 Round 4 の過剰主張撤去に整合）＝値集合は M3。

### §1.6 集約 RewardExchange / ChecklistProgress / StampCard / Battle / ChildChallenge（C6/C7, Child 所有小集約）

#### R-SPECIAL_REWARD（ごほうび, per-child）
- 属性: `{ ごほうび同一性: 識別子, 子供: 参照<CHILD>, 名称: 文字列, 説明: 文字列, 必要ポイント: 整数, 陳列系統: 列挙, 付与者: 参照<MEMBERSHIP>? }`
- CK: `{ごほうび同一性}` / PK: `{ごほうび同一性}` / FK: `子供 → R-CHILD`, `付与者 → R-MEMBERSHIP`
- 正規形: 3NF

#### R-REDEMPTION_REQUEST（交換申請, I-REDEEM の歴史性）
- 属性: `{ 申請同一性: 識別子, 子供: 参照<CHILD>, 対象ごほうび: 参照<SPECIAL_REWARD>?（任意参加=削除後も存続）, 状態: 列挙<申請中/承認/却下/失効>, 申請時のごほうび名称: 文字列（不変捕捉）, 申請時の必要ポイント: 整数（不変捕捉）, 申請日時: 日時, 保護者メモ: 文字列? }`
- CK: `{申請同一性}` / PK: `{申請同一性}` / FK: `子供 → R-CHILD`, `対象ごほうび → R-SPECIAL_REWARD`（**任意参加 FK**: 参照先削除を許す弱参照）
- FD: `申請同一性 → 子供, 対象ごほうび, 状態, 申請時のごほうび名称, 申請時の必要ポイント, 申請日時, 保護者メモ`
- 正規形: 3NF。**制御された冗長（L-05 維持）**: 申請時の名称・必要ポイントは対象ごほうびの現値と重複しうるが、これは業務イベントの不変な歴史的捕捉（I-REDEEM）＝非正規化の悪でない。承認＝ R-POINT_LEDGER_ENTRY に負エントリ 1 件（reward_redemption）＝ I-REDEEM-CONSUME（§5）。

#### R-CHECKLIST_LOG（日次達成記録, I-CHECKLIST, 配信前提）
- 属性: `{ 進捗同一性: 識別子, 子供: 参照<CHILD>, テンプレート: 参照<CHECKLIST_TEMPLATE>, 対象日: 日付, 全完了か: 真偽, 付与ポイント: 整数（捕捉観測値・非権威）}`
- CK: `{進捗同一性}`。自然候補キー `{子供, テンプレート, 対象日}`（I-CHECKLIST 一意） / PK: `{進捗同一性}`
- FK: `子供 → R-CHILD`, `テンプレート → R-CHECKLIST_TEMPLATE`。**複合 FK `{子供, テンプレート} → R-CHECKLIST_ASSIGNMENT`**（Round 1 [should] 反映）: 「配信済テンプレのみ進捗を持つ」（I-CHECKLIST）を [C] 述語でなく **[R] 参照整合**に格上げ（配信されていない (子供,テンプレ) の進捗行を参照整合違反として排除）。
- 正規形: 3NF。`付与ポイント` は checklist 付与の捕捉観測値（権威は PointLedger）。

#### R-CHECKLIST_ITEM_RESULT（項目別チェック結果, L-04 展開）
- 属性: `{ 進捗: 参照<CHECKLIST_LOG>, 対象項目: 参照<CHECKLIST_ITEM>, チェック済か: 真偽 }`
- CK: `{進捗, 対象項目}` / PK: 同上 / FK: `進捗 → R-CHECKLIST_LOG`, `対象項目 → R-CHECKLIST_ITEM`
- **行間整合述語（Round 1 [should]）**: `対象項目.テンプレート = 進捗.テンプレート`（結果の項目は進捗と同一テンプレートに属す＝別テンプレ項目の誤紐付けを排除）。FK だけで表せないタプル間述語＝ §5 [C]。
- 正規形: 3NF

#### R-CHECKLIST_OVERRIDE（当日上書き = 子供×日の項目増減, 特定テンプレに紐づかない）
- 属性: `{ 上書き同一性: 識別子, 子供: 参照<CHILD>, 対象日: 日付, 操作: 列挙<追加/削除>, 項目名: 文字列, アイコン: 文字列? }`
- CK: `{上書き同一性}`。自然候補キー `{子供, 対象日, 項目名, 操作}` / PK: `{上書き同一性}` / FK: `子供 → R-CHILD`
- 正規形: 3NF。M1 §3.4「特定テンプレに紐づかない子供×日の項目調整」＝テンプレ FK を持たない。

#### R-CHILD_CHALLENGE（チャレンジ, per-child, 進捗 inline）
- 属性: `{ チャレンジ同一性: 識別子, 子供: 参照<CHILD>, 題名: 文字列, 期間種別: 列挙, 開始日: 日付, 終了日: 日付, 目標_指標: 文字列, 目標_対象カテゴリ: 参照<CATEGORY>?, 現在値: 整数（進捗・droppable）, 目標値: 整数（年齢調整済）, ごほうび_点数: 整数?, ごほうび_メッセージ: 文字列?, 達成済か: 真偽, ごほうび受領済か: 真偽, 連動グループキー: 文字列?（きょうだい表示用）}`
- CK: `{チャレンジ同一性}` / PK: `{チャレンジ同一性}` / FK: `子供 → R-CHILD`, `目標_対象カテゴリ → R-CATEGORY`
- FD: `チャレンジ同一性 → 子供, 題名, 期間種別, 開始日, 終了日, 目標_*, 現在値, 目標値, ごほうび_*, 達成済か, ごほうび受領済か, 連動グループキー`
- 正規形: 3NF。M1 の `目標条件/ごほうび条件: 値オブジェクト` を意味ある属性に展開（Q-04）。`連動グループキー` は表示上の束ね（L-06, グループ実体リレーションを作らない＝家族横断・競争は撤去済）。達成報酬（child_challenge 付与）は基幹付与（exactly-once eventual, I-ADD 注）＝ R-POINT_LEDGER_ENTRY へ要請。

#### R-STAMP_CARD（週次スタンプカード, I-CHECK-1WK, 子供×週で 1 枚）
- 属性: `{ カード同一性: 識別子, 子供: 参照<CHILD>, 週の開始: 日付, 週の終了: 日付, 状態: 列挙, 交換ポイント: 整数 }`
- CK: `{カード同一性}`。自然候補キー `{子供, 週の開始}`（I-CHECK-1WK 一意） / PK: `{カード同一性}` / FK: `子供 → R-CHILD`
- 正規形: 3NF

#### R-STAMP_ENTRY（押印, 枠ごと, I-STAMP-1DAY）
- 属性: `{ カード: 参照<STAMP_CARD>, 枠番号: 整数, 押印日: 日付, おみくじ結果: 列挙?, スタンプ種別: 参照<STAMP_MASTER>? }`
- CK: `{カード, 枠番号}`（自然複合キー）。**別候補キー `{カード, 押印日}`**（1 日 1 押印, I-STAMP-1DAY） / PK: `{カード, 枠番号}`
- FK: `カード → R-STAMP_CARD`, `スタンプ種別 → R-STAMP_MASTER`（任意, おみくじ枠）
- FD: `{カード, 枠番号} → 押印日, おみくじ結果, スタンプ種別` ／ `{カード, 押印日} → 枠番号, …`（両候補キー）
- 正規形: 3NF（2 候補キー間の従属は候補キー→非キーのみ, BCNF 保持）

#### R-LOGIN_BONUS（日次ログインボーナス, I-LOGIN-1DAY）
- 属性: `{ 子供: 参照<CHILD>, ログイン日: 日付, ランク: 列挙, 付与ポイント: 整数（捕捉観測値）, 連続日数: 整数（記録時確定の観測値）}`
- CK: `{子供, ログイン日}`（自然複合キー, I-LOGIN-1DAY） / PK: 同上 / FK: `子供 → R-CHILD`
- FD: `{子供, ログイン日} → ランク, 付与ポイント, 連続日数`
- 正規形: 3NF。`連続日数` は記録時確定の観測値（streak 同型, 再導出しない）。

#### R-DAILY_BATTLE（日次バトル, I-BATTLE-1DAY）— **戦果値は非経済の内部値・台帳外**
- 属性: `{ 子供: 参照<CHILD>, 日付: 日付, 敵識別: 整数, 状態: 列挙, 勝敗: 列挙, 戦果値: 整数（バトル内部の演出値・台帳付与でない・残高に入らない）, 戦闘時ステータス: 値オブジェクト<Q-06=A・不透明> }`
- CK: `{子供, 日付}`（自然複合キー, I-BATTLE-1DAY, 1 日 1 戦） / PK: 同上 / FK: `子供 → R-CHILD`
- FD: `{子供, 日付} → 敵識別, 状態, 勝敗, 戦果値, 戦闘時ステータス`
- 正規形: 3NF。**戦果値は I-SATELLITE-RECON の述語で自動的に scope 外**（台帳に入らない非経済値）＝ PointLedger 権威争いの対象でない。`戦闘時ステータス` は L-18 で不透明原子値と確認済＝値オブジェクト（展開しない）。

#### R-ENEMY_COLLECTION（討伐図鑑）
- 属性: `{ 子供: 参照<CHILD>, 敵識別: 整数, 初討伐日時: 日時（導出）, 討伐回数: 整数（導出）}`
- CK: `{子供, 敵識別}`（自然複合キー） / PK: 同上 / FK: `子供 → R-CHILD`
- 導出注記（Round 1 [should]）: `討伐回数`/`初討伐日時` は当該（子供,敵識別）の R-DAILY_BATTLE 勝利行の集約（count）/ 最小（min 日時）＝ **§4 D-ENEMY**（D-MASTERY と対称）。**可変集約ゆえ update anomaly を持ち captured observation の免罪符が効かない**（勝利のたびに再集約が必要）→ 導出分類が正。基底は identity（子供, 敵識別）＋導出量。materialize は M3。
- 正規形: 3NF

### §1.7 集約 ChecklistTemplate（C7, family master — ADR-0055 唯一の例外, 3 層）

#### R-CHECKLIST_TEMPLATE（家族マスタ）
- 属性: `{ テンプレート同一性: 識別子, 家族: 参照<FAMILY>, 名称: 文字列, 項目あたりポイント: 整数, 全完了ボーナス: 整数, 時間帯: 列挙 }`
- CK: `{テンプレート同一性}` / PK: `{テンプレート同一性}` / FK: `家族 → R-FAMILY`
- 正規形: 3NF

#### R-CHECKLIST_ITEM（項目, テンプレート 1:N）
- 属性: `{ 項目同一性: 識別子, テンプレート: 参照<CHECKLIST_TEMPLATE>, 名称: 文字列, 頻度: 列挙, 方向: 列挙 }`
- CK: `{項目同一性}` / PK: `{項目同一性}` / FK: `テンプレート → R-CHECKLIST_TEMPLATE`
- 正規形: 3NF

#### R-CHECKLIST_ASSIGNMENT（配信 = テンプレ×子供の M:N 解決連関）
- 属性: `{ テンプレート: 参照<CHECKLIST_TEMPLATE>, 子供: 参照<CHILD>, 配信日時: 日時? }`
- CK: `{テンプレート, 子供}`（連関自然キー） / PK: 同上
- FK: `テンプレート → R-CHECKLIST_TEMPLATE`, `子供 → R-CHILD`（テンプレの家族＝子供の家族＝論理制約）
- FD: `{テンプレート, 子供} → 配信日時`
- 正規形: 3NF。**本モデル唯一の M:N を連関リレーションに解決**（M1 §3.4「配信される M:N=assignment」の写像）。進捗（R-CHECKLIST_LOG）は本 assignment の存在を前提（I-CHECKLIST）。

### §1.8 集約 Child 衛星（C8 関わりと節目）

#### R-PARENT_MESSAGE（保護者メッセージ, I-MSG-SENDER）
- 属性: `{ メッセージ同一性: 識別子, 受信子供: 参照<CHILD>, 送信者: 参照<MEMBERSHIP>, 種別: 列挙<stamp/text/reward_notice>, 本文: 文字列?, スタンプコード: 文字列?, ボーナス点: 整数?, 送信日時: 日時, 既読提示日時: 日時? }`
- CK: `{メッセージ同一性}` / PK: `{メッセージ同一性}`
- FK: `受信子供 → R-CHILD`, `送信者 → R-MEMBERSHIP`（**役割 parent/owner のみ・送信者家族＝受信子供家族**＝ §5 述語 I-MSG-SENDER）
- 正規形: 3NF

#### R-SIBLING_CHEER（きょうだい応援, I-CHEER, 送り手・受け手とも子供）
- 属性: `{ 応援同一性: 識別子, 送り手子供: 参照<CHILD>, 受け手子供: 参照<CHILD>, スタンプコード: 文字列, 送信日時: 日時, 既読提示日時: 日時? }`
- CK: `{応援同一性}` / PK: `{応援同一性}`
- FK: `送り手子供 → R-CHILD`, `受け手子供 → R-CHILD`（**同一家族内の別の子供**＝ §5 述語 I-CHEER: 送り手家族＝受け手家族 ∧ 送り手≠受け手）
- 正規形: 3NF。M1 §3.5 の SIBLING_CHEER（受け手）/ SIBLING_CHEER_SENT（送り手）の 2 関係は、**単一リレーションの 2 つの子供参照（送り手・受け手）に統合**（1 応援イベント＝1 タプル, 二重帰属を作らない）。

#### R-CERTIFICATE（証書, I-CERT-IMMUT）
- 属性: `{ 証書同一性: 識別子, 子供: 参照<CHILD>, 種別: 列挙, 題名: 文字列, 説明: 文字列, 授与日時: 日時, 付帯情報: 値オブジェクト<発行後不変・不透明> }`
- CK: `{証書同一性}` / PK: `{証書同一性}` / FK: `子供 → R-CHILD`
- 正規形: 3NF。`付帯情報` は L-18 で不透明原子値と確認済＝値オブジェクト。I-CERT-IMMUT（授与後不変）は §5 に述語マップ。

#### R-CHARACTER_IMAGE / R-CUSTOM_VOICE（メディア参照, I-MEDIA-EXT — 参照とメタのみ）
- R-CHARACTER_IMAGE 属性: `{ 画像同一性: 識別子, 子供: 参照<CHILD>, 外部実体参照: 文字列（ドメイン外ストレージのキー）, メタ_生成日時: 日時?, メタ_種別: 列挙? }`
- R-CUSTOM_VOICE 属性: `{ 音声同一性: 識別子, 子供: 参照<CHILD>, 外部実体参照: 文字列, メタ_種別: 列挙? }`
- CK/PK: 各 `{…同一性}` / FK: `子供 → R-CHILD`
- 正規形: 3NF。**実バイトはドメイン外**（I-MEDIA-EXT）＝リレーションは参照とメタのみ。purge の到達範囲に外部実体消去を含む（I-PURGE, §5）。

### §1.9 集約 Family 衛星（C8, 追記ログ・独立ライフサイクル資源）

#### R-GRADUATION_CONSENT（卒業同意）— nickname/message はドメイン内容, KPI は概念外プロジェクション
- 属性: `{ 卒業同意同一性: 識別子, 家族: 参照<FAMILY>, 対象の子供: 参照<CHILD>, 公開表示名: 文字列, 卒業の言葉: 文字列?, 事例公開同意: 真偽, 同意日時: 日時, 卒業時点数KPI: 整数?（概念外プロジェクション・非権威）, 利用期間日数KPI: 整数?（概念外プロジェクション）}`
- CK: `{卒業同意同一性}` / PK: `{卒業同意同一性}` / FK: `家族 → R-FAMILY`, `対象の子供 → R-CHILD`
- 正規形: 3NF。`卒業時点数KPI/利用期間日数KPI` は同意時点の **KPI スナップショット（L-07 型の概念外プロジェクション）**＝ I-SATELLITE-RECON の述語で scope 外（台帳付与でない）。M1 の指摘どおり「経済点数の観測値に見えるが権威でない KPI」＝論理的に PointLedger と reconcile しない。

#### R-PUSH_SUBSCRIPTION（通知購読, I-PUSH-ROLE, 保護者のみ）
- 属性: `{ 購読同一性: 識別子, 家族: 参照<FAMILY>, 購読元所属: 参照<MEMBERSHIP>, エンドポイント参照: 文字列, 失効日時: 日時? }`
- CK: `{購読同一性}` / PK: `{購読同一性}` / FK: `家族 → R-FAMILY`, `購読元所属 → R-MEMBERSHIP`（**役割 parent/owner のみ**＝ §5 述語 I-PUSH-ROLE の依り所, M1 §4.2 注）
- 正規形: 3NF

#### R-NOTIFICATION_LOG（通知送信ログ = 追記のみ）
- 属性: `{ ログ同一性: 識別子, 家族: 参照<FAMILY>, 種別: 列挙, 対象子供: 参照<CHILD>?, 送信日時: 日時, 結果: 列挙? }`
- CK: `{ログ同一性}` / PK: `{ログ同一性}` / FK: `家族 → R-FAMILY`, `対象子供 → R-CHILD`（任意）
- 正規形: 3NF

#### R-VIEWER_TOKEN（閲覧専用リンク）
- 属性: `{ トークン同一性: 識別子, 家族: 参照<FAMILY>, ラベル: 文字列, 有効期限: 日時, 失効日時: 日時? }`
- CK: `{トークン同一性}` / PK: `{トークン同一性}` / FK: `家族 → R-FAMILY`
- 正規形: 3NF

#### R-CLOUD_EXPORT（クラウド共有エクスポート）
- 属性: `{ エクスポート同一性: 識別子, 家族: 参照<FAMILY>, 種別: 列挙, 受渡PIN: 秘匿値, 状態: 列挙<pending/building/ready/failed>, 有効期限: 日時, ダウンロード回数: 整数, 最大回数: 整数 }`
- CK: `{エクスポート同一性}` / PK: `{エクスポート同一性}` / FK: `家族 → R-FAMILY`
- 正規形: 3NF

#### R-USAGE_LOG（利用ログ = 追記のみ, L-16 Family 一本化）
- 属性: `{ 利用ログ同一性: 識別子, 家族: 参照<FAMILY>, 対象の子供: 参照<CHILD>?（任意）, 種別: 列挙, 発生日時: 日時 }`
- CK: `{利用ログ同一性}` / PK: `{利用ログ同一性}` / FK: `家族 → R-FAMILY`, `対象の子供 → R-CHILD`（任意）
- 正規形: 3NF。**Family 集約に一本化**（対象子供は任意属性）＝二重帰属（L-16）を解消。

### §1.10 グローバル参照（家族に属さない共有参照）

#### R-CATEGORY（カテゴリ, グローバル固定 5 軸, Q-10=A）
- 属性: `{ カテゴリコード: コード（運動/勉強/生活/交流/創造）, 名称: 文字列 }`
- CK: `{カテゴリコード}`（自然キー） / PK: `{カテゴリコード}` / FK: なし
- 正規形: 3NF。テナント境界なし。

#### R-STAMP_MASTER（スタンプ種別）
- 属性: `{ スタンプコード: コード, 名称: 文字列, レアリティ: 列挙? }`
- CK: `{スタンプコード}` / PK: `{スタンプコード}` / FK: なし
- 正規形: 3NF

#### R-AGE_BENCHMARK（年齢基準値, R-STATUS の参照）
- 属性: `{ 年齢: 整数, カテゴリ: 参照<CATEGORY>, 平均: 数値, 標準偏差: 数値 }`
- CK: `{年齢, カテゴリ}`（**U-1 決裁済 2026-07-05**: 実データ調査で `AGE_BENCHMARK ‖–o{ STATUS`（status はカテゴリ別）との整合により `(年齢, カテゴリ)` に確定。M1 §3.3 mermaid も category 弁別子を追記済） / PK: `{年齢, カテゴリ}` / FK: `カテゴリ → R-CATEGORY` / 物理 `market_benchmarks(age, category_id)`
- FD: `{年齢, カテゴリ} → 平均, 標準偏差`
- 正規形: 3NF。**U-1 決裁確定（2026-07-05、§6 U-1）**: 当初は「M1 属性列にカテゴリ明記がない」ため `{年齢}` を既定にしていたが、実データ調査で `AGE_BENCHMARK ‖–o{ STATUS`（ステータスはカテゴリ別）との整合上カテゴリ別基準値が正と board 決裁 → `{年齢, カテゴリ}` に確定（M1 mermaid にも category 弁別子を反映済）。物理 PK 凍結は `market_benchmarks(age, category_id)`（GLOBAL_MASTER_PK_MANIFEST）。

#### R-PLAN（プラン参照, 契約の値集合）
- 属性: `{ プランコード: コード, プラン層: 参照<PLAN_TIER>, …（価格等は課金 scope 外）}`
- CK: `{プランコード}` / PK: `{プランコード}` / FK: `プラン層 → R-PLAN_TIER`
- FD: `プランコード → プラン層`
- 正規形: 3NF。M1 は「プラン＝増減しうる集合の 1 値」。**Round 1 [must]1 反映（推移従属の分解）**: 当初 `プランコード → プラン層 → 猶予日数` の推移従属を持ち 3NF 違反だったため、`猶予日数`（プラン層で定まる, I-LIFECYCLE）を R-PLAN_TIER に外出し、R-PLAN は `プランコード → プラン層` のみ保持する。**プランの完全カタログ・価格は課金 scope（M1 §10 で LP/課金は別 scope）**＝本書は参照点のみ定義。

#### R-PLAN_TIER（プラン層 → 猶予日数, I-LIFECYCLE の grounding）
- 属性: `{ プラン層: 列挙, 猶予日数: 整数 }`
- CK: `{プラン層}` / PK: `{プラン層}` / FK: なし
- FD: `プラン層 → 猶予日数`
- 正規形: 3NF（[must]1 の分解後、推移従属を除去）。R-SUBSCRIPTION_STATE.プラン / R-ACCOUNT_LIFECYCLE.猶予プラン層 は R-PLAN → R-PLAN_TIER 経由で猶予日数へ到達する（`猶予プラン層` は R-PLAN_TIER への直接参照でもよい＝物理 lookup 経路は M3）。**代替案（M3 送り）**: 猶予日数を課金 scope として M2 論理属性から外し M3 で定義する選択もあり（価格 defer と整合）。本書は I-LIFECYCLE を論理的に grounding するため分解を採る。

#### R-BILLING_EVENT_OBSERVATION（課金イベント冪等観測点）
- 属性: `{ イベント同一性: 識別子（課金基盤のイベント id）, 観測日時: 日時, …（冪等判定に必要な最小属性）}`
- CK: `{イベント同一性}` / PK: `{イベント同一性}` / FK: なし（家族参照は課金 realization 依存＝M3）
- 正規形: 3NF。M1 §4.1/§4.2「webhook 冪等イベントは将来の課金複雑度材料としてグローバル参照に残す」の写像。詳細属性は課金 scope（M3）。

---

## §2 関数従属と正規形の総括

### §2.1 正規形の論拠（3NF を既定とし、明示した制御冗長を例外開示。BCNF 逸脱候補は Round 2 で是正）

> **全称を張らない（M1 の教訓）**: 「全リレーション 3NF」の全称断言はしない。各リレーションは **3NF（下記に明示した制御された派生冗長を除く）** を満たす。BCNF 逸脱の候補だった R-DAILY_MISSION は Round 2 で導出属性削除により BCNF に是正した（下記）。悉皆断言でなく例外を列挙・述語で定義する。

- **部分従属の排除**: 複合候補キーを持つリレーション（R-STATUS `{子供,カテゴリ}`、R-REST_DAY `{子供,対象日}`、R-DAILY_MISSION `{対象日,活動}`、R-STAMP_ENTRY、R-CHECKLIST_ASSIGNMENT、R-EVALUATION_SCORE、R-CHECKLIST_ITEM_RESULT、R-AGE_BENCHMARK 等）で、非キー属性はキー全体に完全従属（キーの真部分集合に従属する属性を持たない）。連関リレーションは属性が最小（連関事実のみ）で部分従属が生じない。
- **推移従属の排除**: 非キー属性間の推移 FD を除去する（例: R-CHILD の年齢帯↔年齢の推移は **手動固定年齢帯のみ格納し実効年齢帯を導出**（[must]2）することで根絶。R-STATUS の レベル↔累計XP、R-SUBSCRIPTION_STATE の entitlement↔状態 は導出属性を基底から外して根絶。R-PLAN の プランコード→プラン層→猶予日数 は R-PLAN_TIER 分解（[must]1）で根絶）。
- **導出量の分離**: 総和・畳み込み・関数で定義される量（残高 / 累計XP / 習熟累計回数 / レベル / 年齢 / 現在の同意 / 討伐回数）は基底属性にせず **§4 導出関係**として定義。これにより「同一事実の 2 保持」（L-03）と推移従属を同時に排す（I-DERIVED の論理写像）。
- **制御された派生冗長の明示区別（3NF の例外として開示）**: R-ACTIVITY_LOG.付与ポイント / R-CHECKLIST_LOG.付与ポイント / R-EVALUATION.ボーナスポイント / R-LOGIN_BONUS.付与ポイント（捕捉観測値）、R-REDEMPTION_REQUEST.申請時捕捉値、R-ACTIVITY_LOG/R-LOGIN_BONUS.連続日数（streak）は、PointLedger 権威やごほうび現値・記録履歴と重複しうるが、**記録時に確定する不変の歴史的観測値**であり更新時異常を起こさない（追記後不変・権威側を正とする reconcile）＝ L-05 / I-SATELLITE-RECON。R-CHILD.手動固定年齢帯も「手動固定という別事実」の派生冗長ではない格納。これらを 3NF の「明示した制御冗長」として区別する。
- **BCNF への是正（Round 2 [must]、M3 送りにしない）**: R-DAILY_MISSION は当初 `活動 → 子供`（非超キー→非 prime）を持ち **3NF 違反**だった（Round 1 の「3NF だが非 BCNF／冗長 prime／R-STAMP_ENTRY 同水準」framing は誤り。R-STAMP_ENTRY は両決定項が候補キーの真正 BCNF で別次元）。**正規化は M2 の責務**ゆえ M3 送りにせず、`子供` 属性 + FK を削除し活動経由導出とすることで唯一候補キー `{対象日,活動}` の BCNF に是正した（R-ACTIVITY_LOG が既に子供を持たず活動経由参照するのと一貫）。

### §2.2 M:N 関係の連関解決
本モデルの M:N は **ChecklistTemplate ↔ Child（配信）** の 1 組のみ（M1 §3.4）。→ **R-CHECKLIST_ASSIGNMENT** に解決（連関自然キー `{テンプレート, 子供}`）。他のすべての関係は 1:1 / 1:0..1 / 1:N であり連関を要しない（per-child 主軸により多くが 1:N に単純化＝ADR-0055 の効果）。

### §2.3 集約境界 → relation グループの対応
M1 §4.2 の集約を relation グループとして反映（トランザクション整合境界の写像。集約横断は論理 FK＝結果整合の realization は M3）:

| 集約ルート（M1 §4.2） | relation グループ（本書 §1） |
|---|---|
| Family（縮小後）+ 家族方針 | R-FAMILY + R-MEMBERSHIP/INVITE/CONSENT_RECORD/PARENT_GATE_CREDENTIAL/EMAIL_LOGIN_LOCKOUT/SUBSCRIPTION_STATE/TRIAL_HISTORY/CANCELLATION_REASON/LOYALTY_STATE/ACCOUNT_LIFECYCLE/DECAY_POLICY/APPROVAL_POLICY/POINT_CONVERSION_POLICY/NOTIFICATION_SETTINGS/BONUS_RULE |
| PointLedger | R-POINT_LEDGER_ENTRY（+ 導出 D-BALANCE） |
| ChildProfile | R-CHILD + R-REST_DAY |
| GrowthJournal | R-ACTIVITY_LOG + R-STATUS + R-STATUS_HISTORY + R-ACTIVITY_MASTERY + R-EVALUATION + R-EVALUATION_SCORE |
| ActivityCatalog | R-CHILD_ACTIVITY + R-ACTIVITY_PREFERENCE + R-DAILY_MISSION |
| StampCard | R-STAMP_CARD + R-STAMP_ENTRY |
| ChecklistProgress | R-CHECKLIST_LOG + R-CHECKLIST_ITEM_RESULT + R-CHECKLIST_OVERRIDE |
| Battle | R-DAILY_BATTLE + R-ENEMY_COLLECTION |
| RewardExchange | R-SPECIAL_REWARD + R-REDEMPTION_REQUEST |
| ChildChallenge | R-CHILD_CHALLENGE |
| ChecklistTemplate（family master） | R-CHECKLIST_TEMPLATE + R-CHECKLIST_ITEM + R-CHECKLIST_ASSIGNMENT |
| Child 衛星 | R-PARENT_MESSAGE/SIBLING_CHEER/CERTIFICATE/CHARACTER_IMAGE/CUSTOM_VOICE。**FixedIntervalReward（M1 §4.2 の Child 衛星集約命名）は §3 ER 未構造化ゆえリレーション未確定 → §6 U-8（構造保留）**。発行結果は R-SPECIAL_REWARD として現れる |
| Family 衛星 | R-GRADUATION_CONSENT/PUSH_SUBSCRIPTION/NOTIFICATION_LOG/VIEWER_TOKEN/CLOUD_EXPORT/USAGE_LOG |
| グローバル参照 | R-CATEGORY/STAMP_MASTER/AGE_BENCHMARK/PLAN/PLAN_TIER/BILLING_EVENT_OBSERVATION |

> **注**: R-EVALUATION/R-EVALUATION_SCORE は M1 §4.2 で「Child 衛星（週次評価）」だが、成長状態の一部として GrowthJournal グループに近接配置した（weekly_bonus を PointLedger へ要請する点は他衛星と同型）。集約整合境界としては独立（GrowthJournal の atomic 境界を膨らませない, M1 §4.2 注）。物理 clustering は M3。

---

## §3 キー戦略

### §3.1 自然キー vs 代理キーの論理的選択（M1「合成 id 廃止・自然キー露出」L-12 の反映）
M1 は DynamoDB 遺産の「単一 opaque 識別子の一律強制 + 採番カウンタ + 辞書順パディング」を排し、**自然な同一性がある概念はそれで語る**と決めた（L-12）。M2 はこれを **候補キー宣言レベル**で反映する（PK の物理形式＝連番/uuid/自然複合の格納は M3）:

| 分類 | リレーション | 論理 PK 選択 | 根拠 |
|---|---|---|---|
| **自然複合キーを PK に採用** | R-STATUS `{子供,カテゴリ}` / R-REST_DAY `{子供,対象日}` / R-DAILY_MISSION `{対象日,活動}`（唯一 CK, Round 2 で子供属性削除し BCNF）/ R-LOGIN_BONUS `{子供,ログイン日}` / R-DAILY_BATTLE `{子供,日付}` / R-ENEMY_COLLECTION `{子供,敵識別}` / R-CHECKLIST_ASSIGNMENT `{テンプレ,子供}` / R-EVALUATION_SCORE `{評価,カテゴリ}` / R-CHECKLIST_ITEM_RESULT `{進捗,項目}` / R-STAMP_ENTRY `{カード,枠番号}` / R-MEMBERSHIP `{家族,利用者}` | 自然複合キー | 自然同一性が存在し安定・一意（I-STATUS/I-CHECK-1WK 系の写像）。opaque id を被せない |
| **自然単一キーを PK に採用** | R-CATEGORY `{カテゴリコード}` / R-STAMP_MASTER `{スタンプコード}` / R-PLAN `{プランコード}` / R-PLAN_TIER `{プラン層}` / R-EMAIL_LOGIN_LOCKOUT `{対象メール}` | 自然コード / メール | 安定した自然識別子。列挙的コード・整数キーで露出（R-AGE_BENCHMARK は U-1 決裁で `{年齢, カテゴリ}` 複合キー化ゆえ本行から除外、§1.10 参照） |
| **1:1 従属で親キーを PK に採用** | R-PARENT_GATE_CREDENTIAL/SUBSCRIPTION_STATE/ACCOUNT_LIFECYCLE/DECAY_POLICY/APPROVAL_POLICY/POINT_CONVERSION_POLICY/NOTIFICATION_SETTINGS/LOYALTY_STATE `{家族}` / R-ACTIVITY_MASTERY/ACTIVITY_PREFERENCE `{活動}` | 親の識別子 | 1:1（1:0..1）従属は親キーが候補キー。縦分解で親を PK 共有 |
| **代理識別子を PK に採用（自然キー不在 or 不安定/PII）** | R-FAMILY / R-USER / R-CHILD / R-CHILD_ACTIVITY / R-ACTIVITY_LOG / R-POINT_LEDGER_ENTRY / R-STATUS_HISTORY / R-SPECIAL_REWARD / R-REDEMPTION_REQUEST / R-CHILD_CHALLENGE / R-STAMP_CARD / R-CHECKLIST_TEMPLATE/ITEM / R-CHECKLIST_LOG / R-CHECKLIST_OVERRIDE / R-EVALUATION / R-INVITE / R-CONSENT_RECORD / R-TRIAL_HISTORY / R-CANCELLATION_REASON / R-BONUS_RULE / 各衛星（PARENT_MESSAGE/SIBLING_CHEER/CERTIFICATE/CHARACTER_IMAGE/CUSTOM_VOICE/GRADUATION_CONSENT/PUSH_SUBSCRIPTION/NOTIFICATION_LOG/VIEWER_TOKEN/CLOUD_EXPORT/USAGE_LOG） | 代理識別子 | 安定した自然キーがない（イベント/追記ログ）か、自然キー候補が可変・PII（メール等）。**自然候補キーがある場合は §1 で UNIQUE 候補キーとして併記**（例 R-USER `{メールアドレス}`、R-CHILD_ACTIVITY は自然キー無し、R-STAMP_CARD `{子供,週の開始}`、R-CHECKLIST_LOG `{子供,テンプレ,対象日}`、R-EVALUATION `{子供,週の開始}`）し、業務一意性を保証 |

> **§3.1 補足（自然キー露出と代理キーの併存）**: 代理 PK を採るリレーションでも、M1 の自然同一性（I-*）を **UNIQUE 候補キー**として必ず宣言する（例 R-STAMP_CARD の `{子供,週の開始}`＝I-CHECK-1WK）。これにより「代理キーで JOIN しつつ自然一意性は制約で担保」でき、DynamoDB 型の opaque id 一律強制（自然一意性を制約化しない歪み）を回避する。R-USER はメールを PK にせず代理 PK＋メール UNIQUE とする（メールは可変・PII でリレーション参照の安定キーに不適＝更新伝播コスト回避）。**物理形式（連番/uuid/生成方式）と PK 凍結（§P1 非可逆性）は M3**。

### §3.2 外部キー（参照整合）の宣言
- すべての `参照<R>`（§1 各リレーションの FK 行）は **論理的参照整合**（参照先タプル存在）を宣言する。
- **任意参加 FK（弱参照・削除耐性）**: R-REDEMPTION_REQUEST.対象ごほうび（I-REDEEM: ごほうび削除後も申請存続）/ R-CHILD_ACTIVITY.取込元テンプレート（テナント外プリセット, 削除耐性）/ R-POINT_LEDGER_ENTRY.由来参照（衛星への弱参照）。これらは「参照先が消えても本タプルは存続」＝論理的に nullable かつ ON DELETE 非カスケードの意味を持つ（実装は M3）。
- **家族境界一致の論理制約**: 集約横断 FK は「参照元と参照先が同一家族に属す」ことを要求する（例 R-PARENT_MESSAGE.送信者所属家族＝受信子供家族、R-SIBLING_CHEER 送受両子供同一家族、R-CHECKLIST_ASSIGNMENT テンプレ家族＝子供家族）。これは FK だけで表せない**タプル間述語**＝ §5 の不変条件マップに委ね、静的宣言可能な部分（FK 存在）と述語部分（家族一致）を区別する。（Round 3 [must]: R-DAILY_MISSION は Round 2 で `子供` 属性を削除し子供＝活動経由導出としたため「活動所有子供＝本行子供」述語が自明化・不要化済＝本例から除外。復活させると BCNF 是正が巻き戻るため置かない。）
- **DSQL FK 非対応は物理問題**: 上記はすべて**論理宣言**。DSQL が FK を張れない事実に対する app 側/CHECK 相当の担保方式は **M3 の責務**（M1 §10 / 本プロセス §M2 決裁条件 c）。

### §3.3 §P1 非可逆性への配慮（論理レベルの前置き）
PK 物理凍結（一度確定すると非可逆な PK 形式選択）は M3 の判断だが、M2 は **その判断を安全にする論理的前提**を置く: (a) 自然複合キーを採るリレーションは自然同一性が M1 不変条件で保証され安定（誕生日跨ぎ等で変わらない値＝子供/カテゴリ/週開始/日付）。(b) 代理 PK を採るリレーションは自然候補キーを UNIQUE で併記し、将来 PK 形式を変えても業務一意性が制約で不変。(c) 可変・PII 属性（メール）は PK にしない（更新伝播の非可逆コストを避ける）。→ M3 の PK 凍結が「自然一意性を失う/PII を巻き込む」事故を論理層で予防する。

---

## §4 導出属性・導出関係（materialize 判断は M3）

M1 の派生量統一則（I-DERIVED）を論理的に「導出関係（derived relation / query）」として定義する。**基底リレーションに保持せず、事象履歴のフォールドとして意味論的に定義**する。物理的に materialize（実体化列 / 集計表）するか都度畳み込むかは **M3 の判断**（M1 §10）。

| 導出名 | 定義（意味論） | 由来不変条件 | 権威源 |
|---|---|---|---|
| **D-BALANCE** | ある子供のポイント残高 = その子供の R-POINT_LEDGER_ENTRY 全行の `増減量` の総和 | I-BAL | **R-POINT_LEDGER_ENTRY のみ**（唯一権威, I-LEDGER-AUTH）。衛星の捕捉観測値（各 付与ポイント）は source にしない |
| **D-XP** | ある子供×カテゴリの累計XP = R-STATUS_HISTORY の当該 `変化量` 総和（成長 − 減衰）。到達最高XP = 履歴 `変化後の値` の最大 | I-DERIVED / I-STATUS | R-STATUS_HISTORY |
| **D-LEVEL** | ステータスのレベル = 累計XP の関数 / 習熟レベル = 習熟累計回数の関数 | I-DERIVED | D-XP / D-MASTERY |
| **D-MASTERY** | ある活動の習熟累計回数 = 当該 R-ACTIVITY_LOG のうち取消されていない行数 | I-DERIVED | R-ACTIVITY_LOG |
| **D-ENEMY** | ある子供×敵識別の討伐回数 = 当該 R-DAILY_BATTLE 勝利行の count、初討伐日時 = 同 min(日付/日時) | I-DERIVED | R-DAILY_BATTLE |
| **D-AGE** | 子供の年齢 = 生年月日と現在時刻の関数。年齢帯モード（実効） = 手動固定でなければ D-AGE の関数（誕生日跨ぎ自動遷移） | I-AGE | R-CHILD.生年月日 |
| **D-CONSENT** | ある家族×利用者×種別の「現在の同意」 = R-CONSENT_RECORD の最新 `同意日時` エントリ（追記ログからの都度導出） | I-CONS | R-CONSENT_RECORD |
| **D-MISSION-DONE** | 今日のミッションの完了状態 = 当該（対象日,活動）の記録履歴から再判定（子供は活動経由導出、Round 3 [note] で表記統一） | I-MISSION / I-ADD | R-ACTIVITY_LOG |
| **D-ENTITLEMENT** | 家族の権利（利用可能機能） = R-SUBSCRIPTION_STATE.契約状態 の関数（別保持しない） | M1 §6 | R-SUBSCRIPTION_STATE |

> **retention 間引きと総和保存（I-DERIVED 一般則）**: 履歴（R-POINT_LEDGER_ENTRY / R-STATUS_HISTORY）を間引く場合、フォールド結果を保存する要約事象を残し導出量を不変に保つ ── 残高なら **中立の `carryover` エントリ**（R-POINT_LEDGER_ENTRY の中立種別, 増減量が総和保存）、ステータスなら**等価な履歴チェックポイント**。これにより D-BALANCE / D-XP は間引き後も不変。**間引きの物理機構（compaction）は M3**、論理は「総和保存の要約事象を残す」制約のみ課す。

> **非経済値・別通貨の分離（M1 忠実写像）**:
> - **D-BALANCE の scope は経済点数のみ**。R-DAILY_BATTLE.戦果値（非経済の内部演出値）・R-GRADUATION_CONSENT の KPI スナップショット は **台帳に入らず D-BALANCE に寄与しない**。I-SATELLITE-RECON の述語により「台帳付与に裏付けられない点数次元の値」は自動的に reconcile scope 外＝これらは PointLedger と突合しない（列挙でなく述語での scope 外化を論理レベルでも維持）。
> - **D-LOYALTY（別通貨・I-DERIVED の穴）**: R-LOYALTY_STATE.記念チケット数 は **PointLedger 経済とは独立の第 2 通貨のカウンタ**（繰越 [note] 反映）。D-BALANCE とは別次元で、I-BAL / I-LEDGER-AUTH / I-BAL-NONNEG の対象外。**ただし M1 がカウンタ定義（増減履歴なし）ゆえ、I-DERIVED のフォールド等価則が適用できない唯一の量＝派生整合ギャップ**（Round 1 [should] で §6 U-2 を「未決」から「派生整合ギャップ」に格上げ）。本書は M1 を覆さずカウンタを既定写像とし、第 2 通貨台帳化（穴を塞ぐ）を board 判断に委ねる。
> - **captured observation は導出でない**: R-ACTIVITY_LOG.連続日数/連続ボーナス、R-LOGIN_BONUS.連続日数（streak 系）、各 付与ポイント は**記録時確定の不変観測値**であって導出関係ではない（I-STREAK-VS-COMBO）。再計算せず、権威（PointLedger）との整合は I-SATELLITE-RECON の結果整合 reconcile で担保。

---

## §5 トレーサビリティ

### §5.1 リレーション → M1 entity / 集約
§1 で各リレーションに集約グループを明示済（§2.3 の対応表が SSOT）。**M1 の全 ER entity（§3.1〜§3.5 の 6 mermaid）が漏れなくリレーションに写像されていること**を以下で確認する（no-silent-gap）:

- C1/C2（§3.1）: FAMILY/USER/MEMBERSHIP/INVITE/CONSENT/PARENT_GATE_CREDENTIAL/EMAIL_LOGIN_LOCKOUT/SUBSCRIPTION_STATE/TRIAL_HISTORY/CANCELLATION_REASON/LOYALTY_STATE/ACCOUNT_LIFECYCLE → R-* 12 対応（漏れなし）
- C3/C4（§3.2）: CHILD/REST_DAY/CHILD_ACTIVITY/ACTIVITY_LOG/ACTIVITY_MASTERY/ACTIVITY_PREFERENCE/DAILY_MISSION/CATEGORY → R-* 8 対応
- C5（§3.3）: POINT_LEDGER_ENTRY/STATUS/STATUS_HISTORY/EVALUATION/EVALUATION_SCORE/DECAY_POLICY/BONUS_RULE/AGE_BENCHMARK → R-* 8 対応
- C6/C7（§3.4）: SPECIAL_REWARD/REDEMPTION_REQUEST/APPROVAL_POLICY/POINT_CONVERSION_POLICY/CHECKLIST_TEMPLATE/CHECKLIST_ITEM/（配信 M:N→ASSIGNMENT）/CHECKLIST_LOG/CHECKLIST_ITEM_RESULT/CHECKLIST_OVERRIDE/CHILD_CHALLENGE/STAMP_CARD/STAMP_ENTRY/STAMP_MASTER/LOGIN_BONUS/DAILY_BATTLE/ENEMY_COLLECTION → R-* 17 対応
- C8（§3.5）: PARENT_MESSAGE/SIBLING_CHEER(+SENT を統合)/CERTIFICATE/GRADUATION_CONSENT/CHARACTER_IMAGE/CUSTOM_VOICE/PUSH_SUBSCRIPTION/NOTIFICATION_SETTINGS/NOTIFICATION_LOG/VIEWER_TOKEN/CLOUD_EXPORT/USAGE_LOG → R-* 12 対応（SIBLING_CHEER/SENT は 1 リレーションに統合＝§1.8 記載）
- グローバル: CATEGORY/STAMP_MASTER/AGE_BENCHMARK/PLAN/PLAN_TIER（[must]1 分解で追加）/BILLING_EVENT_OBSERVATION
- **DefaultChildSelection** → R-FAMILY.既定子供（属性写像）。**BonusRule/DecayPolicy/…（KVS 昇格分, L-14a）** → 各 R-* 対応済。**UI 一過性フラグ（L-14b）/ 無状態セッション（L-14c）** → リレーション化しない（§6 で明示除外）。
- **FixedIntervalReward（M1 §4.2 Child 衛星集約）** → §3 ER 未構造化ゆえリレーション未確定、**§6 U-8 で構造保留**（発行結果は R-SPECIAL_REWARD として現れる）。M1 命名集約を無注記で欠かないための明示ポインタ（no-silent-gap）。

### §5.2 外部キー → M1 関係
| FK（本書） | M1 関係（§3 mermaid） |
|---|---|
| R-MEMBERSHIP.家族/利用者 | FAMILY ‖–o{ MEMBERSHIP / USER ‖–‖ MEMBERSHIP |
| R-CHILD.家族 | FAMILY ‖–o{ CHILD |
| R-CHILD_ACTIVITY.子供/カテゴリ | CHILD ‖–o{ CHILD_ACTIVITY / CATEGORY ‖–o{ CHILD_ACTIVITY |
| R-ACTIVITY_LOG.活動 | CHILD_ACTIVITY ‖–o{ ACTIVITY_LOG |
| R-POINT_LEDGER_ENTRY.子供 | CHILD ‖–o{ POINT_LEDGER_ENTRY |
| R-STATUS.子供/カテゴリ | CHILD ‖–o{ STATUS / CATEGORY ‖–o{ STATUS |
| R-STATUS_HISTORY.子供,カテゴリ | STATUS ‖–o{ STATUS_HISTORY |
| R-CHECKLIST_ASSIGNMENT.テンプレ/子供 | CHECKLIST_TEMPLATE }o–o{ CHILD（配信 M:N） |
| R-CHECKLIST_LOG.テンプレ/子供 | CHILD ‖–o{ CHECKLIST_LOG / CHECKLIST_TEMPLATE ‖–o{ CHECKLIST_LOG |
| R-REDEMPTION_REQUEST.対象ごほうび | SPECIAL_REWARD |o–o{ REDEMPTION_REQUEST（任意参加） |
| R-MEMBERSHIP.対象子供 | CHILD \|o–o\| MEMBERSHIP（role=child, 0..1:0..1, I-CHILD-USER, [must]4 で追加） |
| R-CONSENT_RECORD.同意本人 | USER ‖–o{ CONSENT（同意した本人, Round 2 [should] で trace 追加） |
| R-EMAIL_LOGIN_LOCKOUT（メール） | USER ‖–o\| EMAIL_LOGIN_LOCKOUT。**FK でなく email 値一致で表現**（未登録メールもロック対象になりうるため R-USER への格納 FK を張らない, §1.1 注） |
| R-CHECKLIST_LOG.{子供,テンプレート} | CHECKLIST_TEMPLATE }o–o{ CHILD（配信）への複合 FK（I-CHECKLIST 配信済前提の [R] 化, [should]） |
| R-PARENT_MESSAGE.送信者 | MEMBERSHIP ‖–o{ PARENT_MESSAGE |
| R-SIBLING_CHEER.送り手/受け手 | CHILD ‖–o{ SIBLING_CHEER(_SENT) |
| R-PUSH_SUBSCRIPTION.購読元所属 | FAMILY ‖–o{ PUSH_SUBSCRIPTION（購読元 membership 参照, M1 §4.2 注） |
| R-STATUS → R-AGE_BENCHMARK | AGE_BENCHMARK ‖–o{ STATUS。**年齢は導出属性（D-AGE）ゆえ格納 FK でなく導出参照**（実効年齢での M3 lookup、格納した年齢列を持たない, [should]） |
| （他 FAMILY 1:1/1:N 従属・衛星 FK は §1 各行に対応） | §3.1/§3.5 の各関係 |

### §5.3 M1 不変条件 → 論理制約のマッピング
論理制約の種別: **[K]** キー制約（候補/主キー一意性）/ **[R]** 参照整合（FK）/ **[C]** CHECK 相当の論理述語（単一リレーション内の値/タプル述語）/ **[D]** 導出規則（§4）/ **[M3]** 静的リレーション制約で表現不能なトランザクション/結果整合の不変条件＝realization は M3。

| 不変条件（M1 §5） | 論理制約写像 |
|---|---|
| I-OWN（owner ちょうど 1 名） | [C] R-MEMBERSHIP: family ごとに 役割=owner が 1 件（リレーション内タプル述語） |
| I-MEM（役割 1 つ） | [K] R-MEMBERSHIP PK `{家族,利用者}`＋役割は従属属性（1 タプル 1 役割） |
| I-CHILD-USER | [R]/[C] R-MEMBERSHIP.対象子供（role=child 行の **条件付き一意制約 filtered unique** + FK → R-CHILD, [must]4/Round 2 [should]）で 0..1:0..1 を写像＋ [C] 対象子供家族＝所属家族 |
| I-PIN-LOCK / I-EMAIL-LOCK | [C] R-PARENT_GATE_CREDENTIAL / R-EMAIL_LOGIN_LOCKOUT の失敗回数・ロック期限述語（別機構） |
| I-PIN-RESET | [M3] 検証済ワンタイム確認＋冪等リセット＝トランザクション/機構（静的制約でない） |
| I-CONS（追記のみ・現在同意導出） | [C] 追記のみ（更新/削除禁止述語）＋ [D] D-CONSENT |
| I-SUB（唯一契約・トライアル二度取り禁止・状態遷移） | [K] R-SUBSCRIPTION_STATE PK `{家族}`（唯一）＋ [M3] 状態遷移系列・トライアル二度取り禁止（遷移制約） |
| I-CHILD-FAM（全子供スコープ→1 家族） | [R] 各子供スコープ R-* の 子供/家族 FK（連鎖で家族一意）＝全域参加（NOT NULL FK） |
| I-LOG | [R] R-ACTIVITY_LOG.活動 FK（記録子供＝活動所有子供は**自明**: 子供は活動経由導出で R-ACTIVITY_LOG は記録子供属性を持たない＝別述語を要さない。R-DAILY_MISSION と同型） |
| I-LEDGER-AUTH（経済点数の唯一権威） | [D] D-BALANCE を R-POINT_LEDGER_ENTRY のみから導出（衛星観測値を source にしない）＝設計上の権威分離 |
| I-SATELLITE-RECON（述語 scope） | [M3] 台帳付与に対応する衛星観測値のみ結果整合 reconcile（非台帳点数値は述語で自動 scope 外）＝結果整合機構 |
| I-BAL（残高＝総和） | [D] D-BALANCE |
| I-BAL-NONNEG（裁量消費の非負・目標） | [M3] 裁量消費時の残高読取→負エントリ append の同期整合（overspend 不能）＝トランザクション不変条件（現行 convert 非原子の収斂も M3） |
| I-NEG-BAL（負残高中の消費禁止） | [M3] 負残高中の新規裁量消費拒否（トランザクション述語） |
| I-DERIVED（派生量統一則） | [D] §4 全導出＋間引き時の総和保存要約事象（carryover/checkpoint） |
| I-STATUS（子供×カテゴリ一意・XP=成長−減衰） | [K] R-STATUS PK `{子供,カテゴリ}`＋ [D] D-XP |
| I-DECAY（日次減衰・休養日/猶予/none で停止） | [M3] 日次減衰ジョブ＋ R-REST_DAY/R-DECAY_POLICY を入力とする述語（バッチ機構） |
| I-STREAK-VS-COMBO | [C] streak は R-ACTIVITY_LOG/R-LOGIN_BONUS の記録時確定不変観測値（導出でない）／combo は独立 R-POINT_LEDGER_ENTRY 行（二重定義しない） |
| I-REC（記録 3 者の atomic） | [M3] GrowthJournal 集約の atomic トランザクション（部分成立不可）＝機構 |
| I-ADD（追加効果の結果整合冪等） | [M3] 集約横断の冪等結果整合（droppable 装飾／基幹付与 exactly-once の区別） |
| I-AGE | [D] D-AGE（年齢・実効年齢帯を保持しない） |
| I-CHECK-1WK | [K] R-STAMP_CARD UNIQUE `{子供,週の開始}` |
| I-STAMP-1DAY | [K] R-STAMP_ENTRY 候補キー `{カード,押印日}` |
| I-LOGIN-1DAY | [K] R-LOGIN_BONUS PK `{子供,ログイン日}` |
| I-BATTLE-1DAY | [K] R-DAILY_BATTLE PK `{子供,日付}` |
| I-MISSION | [K] R-DAILY_MISSION 唯一候補キー `{対象日,活動}`（Round 2 で子供削除・BCNF）＋ [D] D-MISSION-DONE（子供も活動経由導出） |
| I-CHECKLIST | [K] R-CHECKLIST_LOG UNIQUE `{子供,テンプレ,対象日}`＋ **[R] 配信済前提を複合 FK `{子供,テンプレ}→R-CHECKLIST_ASSIGNMENT` に格上げ**（[should]、[C] 述語から昇格） |
| I-REDEEM（申請の歴史的捕捉） | [C] R-REDEMPTION_REQUEST の申請時捕捉値は追記後不変＋任意参加 FK |
| I-CONSUME / I-REDEEM-CONSUME / I-CONVERT-CONSUME | [M3] 裁量消費 2 経路が PointLedger 消費オペを呼び負エントリ 1 件＋残高十分時のみ成立（トランザクション） |
| I-CERT-IMMUT | [C] R-CERTIFICATE 授与後不変（更新禁止述語） |
| I-CHEER | 役割/別子供部分 [C]／**家族一致部分は [C](family 非正規化前提=U-6 で複合 FK 化可) / でなければ [M3]**（送り手・受け手が同一家族） |
| I-MSG-SENDER | 送信者 role∈{parent,owner} は [C]／**送信者家族＝受信子供家族は [C](U-6 前提) / でなければ [M3]** |
| I-MEDIA-EXT | [C] R-CHARACTER_IMAGE/CUSTOM_VOICE は参照とメタのみ（実体ドメイン外）／家族境界内参照は [C](U-6 前提)/[M3] |
| I-PUSH-ROLE | [C]/[R] R-PUSH_SUBSCRIPTION.購読元所属 が role∈{parent,owner}（役割は所属参照で担保） |
| I-LIFECYCLE | [C]/[M3] R-ACCOUNT_LIFECYCLE.状態機械（active→soft-deleted→{restored/purged}）＝遷移制約 |
| I-PURGE | [M3] 家族 purge が全子孫（FK 連鎖到達）＋ドメイン外メディア実体を消去し他家族非到達＝カスケード機構 |
| I-DOWNGRADE | [M3] 下位プラン変更時の保護者選択アーカイブ（上限内充足）＝トランザクション/UX |

> **[M3] が多い理由（正直な明示）**: 静的リレーション制約（キー/FK/CHECK）で表現できるのはキー一意性・参照存在・単一タプル述語まで。**トランザクション atomic 境界（I-REC）・結果整合の配送保証（I-ADD/I-SATELLITE-RECON）・状態遷移系列（I-SUB/I-LIFECYCLE）・同期消費の非負（I-BAL-NONNEG）・カスケード purge（I-PURGE）は「不変条件の realization（実現方法）」であり、M1 §10 が明示的に M3 へ委譲した領域**。M2 は「どの不変条件がどの論理制約種別に落ちるか／落ちないか」を分類し、[M3] 項目を realization 待ちとして正確に引き渡す（決裁条件 c「参照整合ルールを app/CHECK でどう担保するか」への入力）。

---

## §6 未決論点（M2 board が評価。候補＋根拠付き）

| # | 論点 | 候補 | 根拠 / 影響 |
|---|---|---|---|
| **U-1（決裁済 2026-07-05）** | R-AGE_BENCHMARK の候補キーにカテゴリを含めるか | (a) `{年齢}` / (b) `{年齢,カテゴリ}` | **✅ 決裁 = (b) `{年齢, カテゴリ}`**（実データ調査で確定、board 承認）。`AGE_BENCHMARK ‖–o{ STATUS`（ステータスはカテゴリ別）との整合でカテゴリ別基準値が正。M1 §3.3 mermaid に category 弁別子を追記済 + R-AGE_BENCHMARK CK/PK を `{年齢, カテゴリ}` に確定 + 物理 `market_benchmarks(age, category_id)` 凍結（GLOBAL_MASTER_PK_MANIFEST）。「勝手に足さない」既定は実データ根拠で解消 |
| **U-2（派生整合ギャップに格上げ）** | R-LOYALTY_STATE.記念チケット数（第 2 通貨）に台帳がなく **I-DERIVED 普遍則の唯一の穴** | (a) 単純カウンタ（本書既定＝M1 定義）/ (b) 記念チケット台帳（増減監査可能・I-DERIVED 整合回復）| **[should] で「未決」から「派生整合ギャップ」に格上げ**: 経済点数は台帳総和の導出（I-DERIVED/D-BALANCE）で監査可能だが、記念チケットは M1 でカウンタ定義ゆえ**増減履歴を持たず I-DERIVED のフォールド等価則が適用できない唯一の量**。カウンタ update anomaly（付与/消費で直接加減算）を負う。M1 を覆さず (a) を既定写像とするが、**board へ (b)（第 2 通貨台帳で普遍則の穴を塞ぐ）の判断を促す**。(b) は M1 拡張を要する |
| **U-3** | R-NOTIFICATION_SETTINGS.静音時間帯 を 2 属性展開 vs 値オブジェクト保持 | (a) 静音開始/終了 展開（本書既定）/ (b) 値オブジェクト | Q-04 基準（範囲述語に使うなら展開）。実 read パターンで範囲比較しないなら (b)。M3 read パターン確認事項 |
| **U-4** | 1:1 家族方針リレーション（DecayPolicy 等）の縦分解 vs Family への吸収 | (a) 別リレーション（本書既定）/ (b) Family 属性群に吸収 | 論理的にはどちらも BCNF。別リレーションは疎な広幅回避＋概念独立（L-14）。物理 clustering は M3。論理層は独立概念を尊重し (a) |
| **U-5** | L-14(a) の軽微概念（ごほうびテンプレ選択・オンボーディング設問・ライフサイクルメール/PMF 送達状態）のリレーション構造 | (a) M1 で ER 未構造化のため M2 board で最小構造を確定 / (b) M3 まで属性群/追記カウンタとして保留 | M1 §3 mermaid に ER entity として現れず（L-14 テキストのみ）。**勝手に構造を作らず**、M1 を覆さない範囲で「Family 属性 or 追記カウンタ相当」と暫定し、正式リレーション化の要否を board 判断（no-silent-gap: 存在は明示・構造は保留） |
| **U-6** | 集約横断の家族境界一致述語（§3.2）を論理層でどこまで宣言するか | (a) FK 存在のみ論理宣言＋家族一致は §5 述語（本書既定）/ (b) family 識別子を各リレーションに冗長配置し複合 FK で宣言 | (b) は M3 の非正規化（テナント隔離）と結びつく物理判断に踏み込む。M2 は (a) で FK 連鎖＋述語に留め、冗長配置は M3 へ委譲 |
| **U-7** | R-POINT_LEDGER_ENTRY.由来参照 の論理型（多態参照） | (a) 弱い任意単一参照 / (b) 由来種別＋由来識別子の 2 属性で多態明示 | 由来は複数の衛星リレーションを指しうる（多態）。**(a) の `参照<弱・任意>` は §0 の `参照<R>`（単一 R を名指す）に非適合で well-formed でない**（多態を単一 FK で表せない）。→ **(b)（由来種別＋由来識別子）が §0 上 sound**。M1 は「弱い業務参照」と緩く定義するため最終形は board 判断だが、論理型の健全性では (b) を推す（Round 2 [should]） |
| **U-8** | FixedIntervalReward（固定間隔特別報酬）の最小構造 | **解決済（#4172）— 構造化しない** | 機構そのものを撤去したため、発行間隔 N・last-issued・冪等キーのいずれも持つ必要がない。ごほうびショップの棚（R-SPECIAL_REWARD）に行を作る主体は親のみで、棚への陳列は PointLedger へ何も要請しない（M1 §3.4 / 26-ゲーミフィケーション設計書 §12.2）。`special_reward` 付与種別は過去履歴行のためだけに残る |

---

## §7 DBMS 非依存の遵守確認（物理語ゼロ）

本書が **意図的に書かなかった物理語**（すべて M3 の責務、確認済）:
- 物理データ型（int/bigint/varchar/text/jsonb/uuid/timestamp 等）── 使用ゼロ。論理型（識別子/文字列/整数/日時/列挙 等, §0）のみ。
- PK 物理形式・凍結・生成方式（連番/uuid/合成 id/採番）── §3 は「候補キー/主キーの論理選択」と根拠のみ。物理形式は §3.1/§3.3 で明示的に M3 へ委譲。
- 索引（index/covering/ASYNC index）── 使用ゼロ。
- JSON 格納方針・埋め込み vs 展開の物理形式 ── 論理レベルの「値オブジェクト保持 or 属性展開」（Q-04 基準）のみ。物理格納は M3。
- CHECK 制約の SQL 構文 ── §5 は「CHECK 相当の論理述語 [C]」と分類のみ、構文なし。
- 派生量の materialize（実体化列/集計表）── §4 で全導出を「意味論的定義」に留め、materialize は明示的に M3 へ委譲。
- トランザクション/楽観制御/分散配置/方言差（DSQL/sqlite）── §5 の [M3] 分類で realization を M3 へ引き渡し、機構を書かない。
- FK 物理実装（DSQL FK 非対応の app/CHECK 担保方式）── §3.2 で「論理宣言のみ、実装は M3」と明示。
- 認証ベンダ名・署名セッション機構・メディアストレージ具体 ── 認証プロバイダは値集合の抽象語、セッションは無状態でリレーション化せず、メディアは参照とメタのみ（I-MEDIA-EXT）。

→ **論理層に閉じた記述**（relation / 属性の論理型 / 関数従属 / 正規形 / 候補キー・主キー・外部キー / 参照整合の論理宣言 / 導出関係）のみで構成されていることを確認した。

---

## 関連
- `docs/design/dsql/m1-conceptual-model.md` — M1 概念モデル（本書の入力・SSOT）
- `docs/design/dsql/m1-review-round{1..6}-ledger.md` — M1 決定の背景台帳
- `docs/design/dsql/detailed-design-process.md` — 詳細設計プロセス（M2 の INPUT/OUTPUT/決裁条件）
- `docs/design/dsql-data-model.md` — M3 物理設計草稿（本書 §4/§5 の [M3] 項目・materialize 判断の引き渡し先）
- `docs/decisions/0055-per-child-primary-data-model-pattern.md` / `0050-parent-gate-session-cookie-signature.md`
