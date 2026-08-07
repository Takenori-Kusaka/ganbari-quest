#!/usr/bin/env node
/**
 * scripts/check-local-tz-date-getters.mjs (#4015 → #4127 / ADR-0061 same-class-N → guard)
 *
 * 「日付をプロセス TZ 任せに導出する」欠陥クラスを止める CI ガード。
 *
 * ## なぜ必要か
 *
 * 本番 runtime は 2 種類あり、プロセス TZ が一致しない。
 *
 *   - AWS Lambda / CI runner : UTC → JST 00:00〜09:00 の 9 時間、暦日が 1 日前になる
 *   - NUC セルフホスト        : JST → JST と一致する
 *
 * #4003 ではこれで子供ホームの週次チャレンジが毎週 9 時間まるごと消えた。
 *
 * ## #4015 版がなぜ 7 箇所を素通ししたか (本 script の設計が変わった理由)
 *
 * 初版は検出対象を `getFullYear` / `getMonth` / `getDate` / `getDay` の **4 語の列挙**で
 * 定義していた。列挙は「今知っている書き方」しか塞げないため、同じ欠陥クラスに属する
 * 別の書き方がそのまま残った (#4127 の実測):
 *
 *   - `recordedAt.getHours()`        → 列挙に無い getter。はやおきボーナスが UTC で 9h ずれる
 *   - `new Date().toISOString().slice(0,10)` → getter を 1 つも使わずに **UTC の暦日**を作る。
 *                                     TZ 不変だが JST ではない (`date-utils.ts` が明文で禁じている形)
 *   - `toLocaleDateString('ja-JP')`  → 表示側の暦日をプロセス TZ (SSR 時は Lambda=UTC) で決める
 *
 * そこで本 script は列挙をやめ、**クラスの側から定義**する。
 *
 *   1. `Date.prototype` の全メンバーを走査し、TZ 非依存と言い切れるもの (`getUTC*` / `setUTC*` /
 *      `getTime` / `toISOString` / `toUTCString` / `getTimezoneOffset` 等) を SAFE として列挙し、
 *      **それ以外を全部 TZ 依存として扱う** (deny by default)。`Date.prototype` は言語仕様で
 *      閉じた有限集合なので、これは「記法の列挙」ではなくクラスの表明になる。分類の網羅は
 *      `findUnclassifiedDateMembers()` が自己検査する (将来メンバーが増えたら fail)。
 *   2. 実時刻から **UTC の暦要素**を切り出す形 (`toISOString()` / `toJSON()` の直後に
 *      `slice` / `substring` / `substr` / `split`) を検出する。TZ 不変でも JST ではないため、
 *      `date-utils.ts` の JST SSOT を経由していない時点で同じクラスの欠陥。
 *   3. `toLocale*` / `Intl.DateTimeFormat` は `timeZone` オプションがあれば SAFE (構造判定)。
 *
 * ## 検査ルール
 *
 * 1. `SEARCH_ROOTS` (src / infra/lambda / scripts) 配下を走査し、コメント行以外の違反を数える
 * 2. **no-silent-gap**: 検出のあった file が `ALLOWLIST` に無ければ fail
 * 3. **ratchet**: allowlist entry の `max` を超えた occurrence 数は fail
 * 4. **除外理由の機械検証**: allowlist entry は `kind` を持ち、kind ごとに機械検査される。
 *    自由文の `reason` だけで通ることはない (#4127 残存 3 = 理由が実測と食い違ったまま緑だった)。
 *
 *    | kind | 意味 | 機械検査 |
 *    |---|---|---|
 *    | `ssot` | JST SSOT の実装本体 | path が `date-utils.ts` であること |
 *    | `tz-proof` | 2 TZ 実測で不変と確認済 | `proof` が `tz-invariance-cases.mjs` に登録され、fitness test が実測すること |
 *    | `instant-offset` | 「N 日後の絶対時刻」生成のみ (暦要素を外に出さない) | 全違反行が `setX(getX() ± n)` 構造であること |
 *    | `non-runtime` | 顧客に見える値を作らない (ビルド道具 / Storybook / demo fixture) | path が `NON_RUNTIME_PATTERNS` に一致すること |
 *
 * 使用法: node scripts/check-local-tz-date-getters.mjs
 * CI: 検出時は exit 1。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasTzInvarianceCase } from './lib/ci/tz-invariance-cases.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * 走査ルート (REPO_ROOT 相対)。
 *
 * `infra/lambda` (cron 起動側) と `scripts` は #4015 版では未走査だった。cron の起動時刻と
 * 「その日」の定義が乖離する変更が silent に入るため #4127 で追加 (AC6)。
 * `tests/` は意図的な時刻固定が多いため対象外 (#4015 No-gos)。
 */
export const SEARCH_ROOTS = ['src', 'infra/lambda', 'scripts'];

/**
 * **走査しないと決めた** コード保有ディレクトリと、その理由 (#4120)。
 *
 * `SEARCH_ROOTS` 配下では「検出があったのに allowlist に無い file」を no-silent-gap で落とすが、
 * **走査範囲そのものの網羅は誰も見ていなかった**。`infra/lib` に日付から schedule / 期限を
 * 組み立てるコードが後から入っても、この guard は黙って素通りさせる。EPIC #4120 の目的は
 * 「TZ 依存の日付導出を根絶する」ことなので、**新しいコード置き場が増えたときに気付けること**まで
 * が guard の責務に含まれる。
 *
 * 除外は「今は違反が無いから」ではなく「**顧客に見える日付をここでは作らない**」を理由にする。
 * 網羅は `tests/unit/scripts/check-local-tz-date-getters.test.ts` が実 repo と突き合わせる。
 *
 * @type {ReadonlyArray<{ root: string; reason: string }>}
 */
export const EXCLUDED_ROOTS = [
	{
		root: 'infra/lib',
		reason:
			'CDK stack 定義。deploy 時に 1 度評価されるだけで、顧客に見える日付を導出しない (実測 0 件)',
	},
	{
		root: 'infra/bin',
		reason: 'CDK app entry point。stack の組み立てのみで日付を扱わない (実測 0 件)',
	},
	{
		root: 'tests',
		reason: '意図的な時刻固定が多く、TZ 依存の検出が偽陽性になる (#4015 No-gos で除外を決定)',
	},
	{
		root: 'site',
		reason: 'LP の静的 HTML / CSS。日付を描画しない (実測 0 件)',
	},
	{
		root: 'infra/gcp',
		reason: 'Discord 連携の設定・シェル資材。走査対象拡張子の file を持たない (実測 0 件)',
	},
	{
		root: 'infra/error-pages',
		reason: 'CloudFront カスタムエラーページ (静的 HTML)。走査対象拡張子を持たない (実測 0 件)',
	},
	{
		root: 'eslint-plugin-local',
		reason: 'ESLint ルール実装。lint 時に評価されるだけで顧客に見える日付を作らない (実測 0 件)',
	},
	{ root: 'docs', reason: '設計文書。実行されるコードを含まない' },
	{ root: 'actions', reason: 'GitHub Actions composite action 定義 (YAML)' },
	{ root: 'data', reason: '静的データ資材。実行されるコードを含まない' },
	{ root: 'drizzle', reason: 'DB migration SQL。実行されるコードを含まない' },
	{ root: 'static', reason: '静的アセット (画像 / manifest 等)' },
	{
		root: 'graphify-out',
		reason:
			'Graphify が生成するナレッジグラフ成果物 (graph.json / graph.html / manifest.json)。' +
			'AST 解析結果のデータであり、実行されるコードを含まない (#4291)',
	},
];

/** 走査対象拡張子 */
export const EXTENSIONS = ['.ts', '.svelte', '.mjs', '.js'];

/**
 * `Date.prototype` のうち **TZ 非依存**と言い切れるメンバー。
 * ここに無いメンバーは自動的に TZ 依存として扱われる (deny by default)。
 */
export const TZ_SAFE_DATE_MEMBERS = new Set([
	'constructor',
	'valueOf',
	'toJSON',
	'getTime',
	'setTime',
	'getTimezoneOffset', // オフセットそのものを問う API。暦要素を導出しない
	'toISOString',
	'toUTCString',
	'toGMTString',
	// getUTC* / setUTC* は下の classifyDateMembers() が prefix で自動分類する
]);

/**
 * `Date.prototype` の全メンバーを TZ 安全 / TZ 依存に 2 分する。
 * 分類は「列挙」ではなく `Date.prototype` の実体から導出するため、
 * 未知のアクセサが増えても勝手に安全側に落ちない。
 *
 * @returns {{ safe: string[], dependent: string[] }}
 */
export function classifyDateMembers() {
	/** @type {string[]} */
	const safe = [];
	/** @type {string[]} */
	const dependent = [];
	for (const name of Object.getOwnPropertyNames(Date.prototype)) {
		if (TZ_SAFE_DATE_MEMBERS.has(name) || /^(get|set)UTC/.test(name)) {
			safe.push(name);
			continue;
		}
		dependent.push(name);
	}
	return { safe, dependent };
}

/**
 * 分類が `Date.prototype` を網羅していることの自己検査。
 * 将来 `Date.prototype` にメンバーが増えたときに「分類漏れ = 黙って安全側」を作らない。
 *
 * @returns {string[]} 未分類メンバー (空なら健全)
 */
export function findUnclassifiedDateMembers() {
	const { safe, dependent } = classifyDateMembers();
	const classified = new Set([...safe, ...dependent]);
	return Object.getOwnPropertyNames(Date.prototype).filter((n) => !classified.has(n));
}

/**
 * TZ 依存だが **他 prototype と名前を共有していて行単位では受け手を判別できない**メンバー。
 *
 * この宣言は検出を **弱める** ものなので、宣言しただけで通ることがあってはならない
 * (allowlist の reason を自由文で通していた #4127 残存 3 と同じ失敗形になる)。
 * そのため `findAmbiguousDeclarationProblems()` が以下を機械検査し、main() で必ず実行する:
 *
 *   1. 理由 (`reason`) が非空であること
 *   2. **補償検出が実在すること** — 宣言したメンバー名が `DATE_RECEIVER_AMBIGUOUS_CALL` の
 *      source に現れていること (= 受け手が Date と分かる形は必ず拾われる)
 *   3. 宣言されたメンバーが実際に `Date.prototype` の TZ 依存側にあること (綴り間違いで
 *      「何も外していないのに外したつもり」になるのを防ぐ)
 *
 * @type {Record<string, string>}
 */
export const AMBIGUOUS_MEMBERS = {
	toString:
		'Object / Number / Buffer 等の toString と同名で、行単位では受け手が Date か判別できない (randomBytes(32).toString("base64url") 等)。受け手が Date と分かる形は DATE_RECEIVER_AMBIGUOUS_CALL で拾う',
	toLocaleString:
		'Number / Array の toLocaleString と同名で、金額 / ポイントの桁区切り (points.toLocaleString("ja-JP")) が大多数を占める。受け手が Date と分かる形は DATE_RECEIVER_AMBIGUOUS_CALL で拾う',
};

/**
 * 受け手が Date だと判断できる曖昧メンバー呼び出し (曖昧回避の補償検出)。
 *
 * 次のいずれかで拾う:
 *   - `new Date(...)` リテラルを受け手にする形
 *   - 日時を示す命名の変数 (`〜At` / `〜Date` / `〜Time` / `〜On` / `〜Since` / `〜Until` /
 *     `〜Expires` / `〜Timestamp`、`Iso` / `Utc` / `Jst` / `Str` / `Ms` の末尾修飾も許す)
 *   - 引数に **日時整形オプション** (`dateStyle` / `timeStyle` / `weekday` / `year` / `month` /
 *     `day` / `hour` / `minute`) を渡している形 — 受け手の命名に頼らず用途で判定する
 *
 * **限界の明示**: 命名にも整形オプションにも現れない Date 変数
 * (`const x = new Date(); x.toLocaleString()`) は行単位では判別できない。これは受け手の型を
 * 追わない静的検査の構造的限界であり、「取りこぼさない」とは主張しない。振る舞い側は
 * `tests/unit/architecture/tz-invariance.test.ts` の 2 TZ 実測が担う。
 */
export const DATE_RECEIVER_AMBIGUOUS_CALL =
	/(?:(?:new Date\s*\([^)]*\)|\b[A-Za-z_$][\w$]*(?:At|Date|Time|On|Since|Until|Expires|Timestamp)(?:Iso|Utc|Jst|Str|String|Ms)?|\b(?:date|time|now|deadline|timestamp)\b)\s*\.\s*(?:toString|toLocaleString)\s*\(|\.\s*toLocaleString\s*\([^)]*\b(?:dateStyle|timeStyle|weekday|year|month|day|hour|minute)\s*:)/;

/**
 * `AMBIGUOUS_MEMBERS` 宣言自体の健全性検査 (空なら健全)。
 *
 * 「宣言を足せば検出から外せる」抜け道を作らないための自己検査。
 * @returns {Array<{member: string, problem: string}>}
 */
export function findAmbiguousDeclarationProblems() {
	const { dependent } = classifyDateMembers();
	/** @type {Array<{member: string, problem: string}>} */
	const problems = [];
	const compensationSource = DATE_RECEIVER_AMBIGUOUS_CALL.source;
	for (const [member, reason] of Object.entries(AMBIGUOUS_MEMBERS)) {
		if (typeof reason !== 'string' || reason.trim() === '') {
			problems.push({ member, problem: '理由 (reason) が空です' });
		}
		if (!dependent.includes(member)) {
			problems.push({
				member,
				problem: 'Date.prototype の TZ 依存メンバーではありません (綴り間違い / 既に SAFE 分類)',
			});
		}
		if (!compensationSource.includes(member)) {
			problems.push({
				member,
				problem:
					'補償検出がありません。DATE_RECEIVER_AMBIGUOUS_CALL に本メンバー名を含めてください (宣言だけで検出を消さない)',
			});
		}
	}
	return problems;
}

/** TZ 依存メンバー呼び出しの検出正規表現 (`Date.prototype` から導出) */
export function buildTzDependentMemberRegex() {
	const { dependent } = classifyDateMembers();
	// 長い名前から並べて部分一致 (getUTCDate が getDate に食われる等) を避ける
	const alternation = dependent
		.filter((n) => !Object.hasOwn(AMBIGUOUS_MEMBERS, n))
		.sort((a, b) => b.length - a.length)
		.join('|');
	return new RegExp(`\\.(${alternation})\\s*\\(`);
}

/** TZ 依存メンバー呼び出し */
export const TZ_DEPENDENT_MEMBER_CALL = buildTzDependentMemberRegex();

/**
 * 実時刻から **UTC の暦要素**を切り出す形。
 * `new Date().toISOString().slice(0, 10)` / `.split('T')[0]` / `.substring(0, 7)` など。
 * TZ 不変だが JST ではないため、JST SSOT を経由していない時点で同じ欠陥クラス。
 */
export const UTC_CALENDAR_SLICE =
	/\.(toISOString|toJSON)\s*\(\s*\)\s*\.\s*(slice|substring|substr|split)\s*\(/;

/**
 * **暦の再実装** — `date-utils.ts` の外で暦要素を取り出す / 組み立てる形 (#4120)。
 *
 * ## なぜ TZ 依存でないものまで落とすのか
 *
 * EPIC #4120 の完了の定義は「**暦日・週頭・月境界を返す関数が 1 本だけ存在**し、それ以外の
 * 経路が fitness function で検出される」。#4015 / #4127 の検出は「プロセス TZ で結果が変わるか」
 * だけを見ていたため、**UTC 算術で書けば何本でも第 2 実装を作れた**。実測 (#4120):
 *
 *   - `stamp-card-service.getWeekRange()` — `weekStartJST` と同一ロジック (`-6` / `1-dow` 分岐まで一致)
 *   - `child-challenge-service.getLastWeekStart()` / `weekEndOf()` — `addDaysJST` の再実装
 *   - `checklist-service` / `notification-service` — `(getUTCHours() + 9) % 24` = `jstHour` の再実装
 *   - `cohort-analysis` / `ops-analytics` — 同一の月キー実装が 2 本 (どちらも「月境界 SSOT」を自称)
 *
 * いずれも値は正しい。正しいまま **SSOT が複数ある**ことが欠陥であり、次に暦の規則を変える人が
 * 全部を直せない。そこで「`Date` から暦要素 (年 / 月 / 日 / 曜日 / 時) を取り出す・組み立てる計算は
 * `date-utils.ts` の中だけ」を不変条件とし、外に出た時点で落とす。
 *
 * 瞬間そのものを扱う API (`getTime` / `setTime` / `toISOString` / `valueOf` / `toJSON` /
 * `getTimezoneOffset`) は暦要素を導出しないため対象外 = 呼び出し側で自由に使える。
 *
 * ## 意図的に検出しないもの (no-silent-gap)
 *
 *   - `` `${dateStr}T00:00:00+09:00` `` 等の **JST 境界 instant の文字列組み立て**、および SQL 側の
 *     `AT TIME ZONE 'Asia/Tokyo'`。これらは暦要素の導出ではなく「JST 境界を SQL / Date に渡す」形で、
 *     置換先 (`jstDayStartUtcIso`) はあるが SQL 層には適用できない。検出対象に含めると
 *     「SQL だから」という自由文の除外を量産することになるため、本 gate の対象外と明示する
 *   - `` `${year}-${String(month).padStart(2, '0')}` `` のように **数値の年 / 月から**キーを組む形。
 *     実時刻からの導出ではない (入力が既に暦要素) ため本クラスに属さない
 */
export const CALENDAR_REIMPL =
	/\.(get|set)UTC(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\s*\(|\bDate\s*\.\s*UTC\s*\(/;

/**
 * JST オフセットの再定義 (#4120)。
 * `new Date(now.getTime() + 9 * 60 * 60 * 1000)` は `toJSTDateString()` の手動再実装であり、
 * JST の定義が `date-utils.ts` の 1 箇所に無い状態を作る。
 */
export const JST_OFFSET_REIMPL =
	/\b9\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b|\b9\s*\*\s*3600\s*\*\s*1000\b|\b540\s*\*\s*60\s*\*\s*1000\b|\b32400000\b/;

/**
 * **ISO timestamp を切って暦日にする形** (#4120)。
 *
 * `UTC_CALENDAR_SLICE` は `.toISOString().slice(0, 10)` の **直結**しか見ないため、
 * 一度変数に入った ISO 文字列 (DB の `createdAt` / `recordedAt` / `paidAt` 等) を切る形は
 * 素通りしていた。値は `.toISOString().slice()` と同じ **UTC の暦日**で、JST 00:00〜09:00 に
 * 記録された行を前日に落とす。実測 (#4120) で顧客に見える経路に残っていた:
 *
 *   - `export-service` — バックアップに書き出す `recordedDate` が UTC 暦日
 *   - `sibling-ranking-service` — 週バケット判定が UTC 暦日で、JST 週境界と 9 時間ずれる
 *   - 子供の履歴ページ — 日付見出しのグルーピング鍵が UTC 暦日
 *
 * 受け手は **ISO timestamp を示す命名** (`〜At` / `〜Iso` / `〜Timestamp` / `iso`) に限定する。
 * `dateStr.slice(0, 7)` のように受け手が既に暦日 (YYYY-MM-DD) の場合は UTC/JST の別が無く
 * 欠陥ではないため対象にしない (置換先として `monthKeyOfDate()` はあるが強制はしない)。
 */
export const ISO_STRING_CALENDAR_SLICE =
	/\b(?:[A-Za-z_$][\w$]*\.)*(?:[A-Za-z_$][\w$]*(?:At|Iso|Timestamp)|iso)\s*\.\s*(?:(?:slice|substring)\s*\(\s*0\s*,\s*(?:10|7)\s*\)|split\s*\(\s*['"]T['"]\s*\))/;

/** `Intl.DateTimeFormat` の生成 (timeZone 指定が無ければプロセス TZ 依存) */
export const INTL_DATE_TIME_FORMAT = /\bIntl\s*\.\s*DateTimeFormat\s*\(/;

/** 同一行に `timeZone` オプションがあるか (構造判定による免除) */
export const HAS_EXPLICIT_TIME_ZONE = /\btimeZone\s*:/;

/**
 * 「N 日後の絶対時刻」生成 (`d.setDate(d.getDate() + 7)` / `d.setUTCDate(d.getUTCDate() + 7)` 形)
 * — kind: instant-offset の機械検査に使う。
 */
export const INSTANT_OFFSET_PATTERN =
	/\.set(UTC)?(FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)\s*\(\s*[\w.[\]]+\.get\1\2\s*\(\s*\)\s*[+-]/;

/** `kind: 'non-runtime'` を名乗れる path (顧客に見える値を作らない場所) */
export const NON_RUNTIME_PATTERNS = [
	/^scripts\//,
	/\.stories\.svelte$/,
	/^src\/lib\/server\/demo\//,
	/^src\/lib\/server\/debug-plan\.ts$/,
];

/**
 * `kind: 'utc-anchor'` を名乗れる path (#4120)。
 *
 * 「顧客の暦 (JST) ではなく **UTC の暦を意図的にアンカーにしている**」場所。現状は ops の
 * 週次ヘルスチェック集計のみ (`$lib` を import できない Lambda 単体 bundle であり、SSOT に
 * 寄せられない)。顧客に見える日付をここで作らないことが前提。
 */
export const UTC_ANCHOR_PATTERNS = [/^infra\/lambda\//];

/** allowlist entry が取りうる kind */
export const ALLOWLIST_KINDS = ['ssot', 'tz-proof', 'instant-offset', 'non-runtime', 'utc-anchor'];

/**
 * allowlist。
 *
 * `file`: REPO_ROOT 相対 path (`/` 区切り) / `max`: 許容 occurrence 数 (ratchet 上限)
 * `kind`: 上表の 4 種 / `proof`: kind='tz-proof' のとき必須 / `reason`: 必須 (人間向けの説明)
 *
 * @type {Array<{file: string, max: number, kind: string, proof?: string, reason: string}>}
 */
export const ALLOWLIST = [
	{
		file: 'src/lib/domain/date-utils.ts',
		max: 16,
		kind: 'ssot',
		reason:
			'JST SSOT の実装本体。JST オフセット定義 + UTC 算術 + toISOString で暦日を組み立てる唯一の場所であり、ここが違反を持つのは定義上正しい',
	},
	{
		file: 'src/lib/server/services/grace-period-service.ts',
		max: 1,
		kind: 'instant-offset',
		reason: '物理削除猶予期限 = N 日後の絶対時刻を作り ISO で保存するのみ',
	},
	{
		file: 'src/lib/server/services/cloud-export-service.ts',
		max: 1,
		kind: 'instant-offset',
		reason: 'エクスポート PIN の有効期限 = N 日後の絶対時刻を作り ISO で保存するのみ',
	},
	{
		file: 'src/lib/server/services/viewer-token-service.ts',
		max: 1,
		kind: 'instant-offset',
		reason: '閲覧トークン失効時刻 = N 日後の絶対時刻を作り ISO で保存するのみ',
	},
	{
		file: 'src/routes/(child)/[uiMode=uiMode]/(character)/history/+page.server.ts',
		max: 2,
		kind: 'instant-offset',
		reason: '履歴取得範囲の「N 日前の絶対時刻」生成のみ。暦日化は toJSTDateString() に委譲済',
	},
	{
		file: 'src/lib/features/child-home/BabyHomePage.stories.svelte',
		max: 7,
		kind: 'non-runtime',
		reason: 'Storybook の fixture 生成 (「N ヶ月前生まれ」等の相対誕生日)。本番ビルドに含まれない',
	},
	{
		file: 'infra/lambda/health-check/index.ts',
		max: 6,
		kind: 'utc-anchor',
		reason:
			'ops 週次ヘルスチェック集計。週の起点を **UTC 日曜 00:00** (= JST 月曜 09:00) と定義し、SSM に UTC 暦日で記録する。顧客に見える日付を作らず、$lib を import できない Lambda 単体 bundle のため SSOT に寄せられない',
	},
	{
		file: 'src/lib/server/demo/synthetic-staging-dataset.ts',
		max: 1,
		kind: 'non-runtime',
		reason: 'staging 合成 seed の相対日付生成 (#3412)。顧客テナントのデータを作らない',
	},
	{
		file: 'src/lib/server/debug-plan.ts',
		max: 1,
		kind: 'non-runtime',
		reason: 'DEBUG_TRIAL の擬似終了日 (dev 専用、本番ビルド無効)',
	},
	// --- scripts/ (ビルド / CI 道具。顧客に見える日付を作らない) ---
	{
		file: 'scripts/ai-evaluation/lib/multi-agent-evaluator.mjs',
		max: 1,
		kind: 'non-runtime',
		reason: '評価レポートの日付メタ (CI 道具の出力メタデータ)',
	},
	{
		file: 'scripts/ai-evaluation/run-poc.mjs',
		max: 2,
		kind: 'non-runtime',
		reason: 'PoC 出力ファイル名の日付 (CI 道具)',
	},
	{
		file: 'scripts/audit/run-pipeline.mjs',
		max: 1,
		kind: 'non-runtime',
		reason: '監査 run id の日付部 (CI 道具)',
	},
	{
		file: 'scripts/capture-specs/flows/trial-start-error-2941.mjs',
		max: 4,
		kind: 'non-runtime',
		reason: 'SS 撮影用の相対日付 fixture (撮影道具)',
	},
	{
		file: 'scripts/collect-integration-prs.mjs',
		max: 2,
		kind: 'non-runtime',
		reason: '統合 PR 収集の git log 検索範囲 (CI 道具)',
	},
	{
		file: 'scripts/capture.mjs',
		max: 1,
		kind: 'non-runtime',
		reason: 'SS 出力ディレクトリ名の日付 (撮影道具)',
	},
	{
		file: 'scripts/generate-sitemap.mjs',
		max: 1,
		kind: 'non-runtime',
		reason: 'sitemap の lastmod (W3C 日付、UTC で妥当)',
	},
	{
		file: 'scripts/security-findings-to-issues.mjs',
		max: 1,
		kind: 'non-runtime',
		reason: 'Issue 本文に載せる検出日 (CI 道具)',
	},
	{
		file: 'scripts/security-scan.mjs',
		max: 1,
		kind: 'non-runtime',
		reason: 'スキャン結果ファイル名の日付 (CI 道具)',
	},
	{
		file: 'scripts/seed-staging.ts',
		max: 1,
		kind: 'non-runtime',
		reason: 'staging seed の anchor 日付 (dev / staging 道具、顧客テナントを作らない)',
	},
];

/**
 * relPath (`/` 区切り) の allowlist entry を返す
 * @param {string} relPath
 * @returns {{file: string, max: number, kind: string, proof?: string, reason: string} | undefined}
 */
export function findAllowlistEntry(relPath) {
	const normalized = relPath.replace(/\\/g, '/');
	return ALLOWLIST.find((e) => e.file === normalized);
}

/**
 * allowlist 自体の健全性検査 (kind ごとの機械検証)。
 *
 * 「理由が書いてあるだけ」で通る除外を作らないための中核。`occurrencesByFile` を渡すと
 * `instant-offset` の構造検査 (全違反行が `setX(getX() ± n)` か) まで行う。
 *
 * @param {Map<string, Array<{file: string, line: number, snippet: string, kind?: string}>>} [occurrencesByFile]
 * @returns {Array<{file: string, problem: string}>} 問題のある entry (空なら健全)
 */
export function findAllowlistIntegrityProblems(occurrencesByFile = new Map()) {
	/** @type {Array<{file: string, problem: string}>} */
	const problems = [];
	for (const e of ALLOWLIST) {
		if (typeof e.reason !== 'string' || e.reason.trim() === '') {
			problems.push({ file: e.file, problem: 'reason が空です' });
		}
		if (!ALLOWLIST_KINDS.includes(e.kind)) {
			problems.push({
				file: e.file,
				problem: `kind が不正です (${String(e.kind)})。許可: ${ALLOWLIST_KINDS.join(' / ')}`,
			});
			continue;
		}
		if (e.kind === 'ssot' && e.file !== 'src/lib/domain/date-utils.ts') {
			problems.push({
				file: e.file,
				problem: "kind='ssot' は JST SSOT 実装本体 (src/lib/domain/date-utils.ts) 以外に使えません",
			});
		}
		if (e.kind === 'tz-proof') {
			if (!e.proof) {
				problems.push({
					file: e.file,
					problem: "kind='tz-proof' には proof (実測 case id) が必要です",
				});
			} else if (!hasTzInvarianceCase(e.proof)) {
				problems.push({
					file: e.file,
					problem: `proof '${e.proof}' が scripts/lib/ci/tz-invariance-cases.mjs に未登録です`,
				});
			}
		}
		if (e.kind === 'non-runtime' && !NON_RUNTIME_PATTERNS.some((p) => p.test(e.file))) {
			problems.push({
				file: e.file,
				problem: "kind='non-runtime' を名乗れる path ではありません (NON_RUNTIME_PATTERNS 参照)",
			});
		}
		// stale 検出: 実際には違反の無くなった entry を残さない (allowlist の腐敗防止)。
		// `max: 0` は「0 で pin する」意思表示なので対象外。
		if (
			e.max > 0 &&
			(occurrencesByFile.get(e.file) ?? []).length === 0 &&
			occurrencesByFile.size > 0
		) {
			problems.push({
				file: e.file,
				problem:
					'違反が 0 件になっています。修正済なら本 entry を削除してください (stale allowlist)',
			});
		}
		if (e.kind === 'utc-anchor') {
			if (!UTC_ANCHOR_PATTERNS.some((p) => p.test(e.file))) {
				problems.push({
					file: e.file,
					problem: "kind='utc-anchor' を名乗れる path ではありません (UTC_ANCHOR_PATTERNS 参照)",
				});
			}
			// 「UTC を意図的に選んでいる」以上、プロセス TZ 依存が混じっていてはならない。
			// 自由文の宣言ではなく occurrence の kind で構造的に検査する。
			const tzDependent = (occurrencesByFile.get(e.file) ?? []).filter(
				(o) => o.kind !== 'calendar-reimpl',
			);
			for (const o of tzDependent) {
				problems.push({
					file: e.file,
					problem: `kind='utc-anchor' だが L${o.line} が UTC 由来ではありません [${o.kind}]: ${o.snippet}`,
				});
			}
		}
		if (e.kind === 'instant-offset') {
			const occurrences = occurrencesByFile.get(e.file) ?? [];
			const offenders = occurrences.filter((o) => !INSTANT_OFFSET_PATTERN.test(o.snippet));
			for (const o of offenders) {
				problems.push({
					file: e.file,
					problem: `kind='instant-offset' だが L${o.line} が setX(getX() ± n) 構造ではありません: ${o.snippet}`,
				});
			}
		}
	}
	return problems;
}

/**
 * line がコメント行なら true (経緯記述・SSOT 説明は許容する)
 * @param {string} line
 * @returns {boolean}
 */
export function isCommentLine(line) {
	const trimmed = line.trimStart();
	return (
		trimmed.startsWith('//') ||
		trimmed.startsWith('*') ||
		trimmed.startsWith('/*') ||
		trimmed.startsWith('<!--')
	);
}

/**
 * 1 行が違反かを判定する (純関数)。
 *
 * `toLocale*` の option object は複数行に分かれることがあるため、`timeZone` の有無は
 * 続く数行まで見る (`lookahead`)。行単位で切ると整形の差だけで判定が変わってしまう。
 *
 * @param {string} line
 * @param {string} [lookahead] 続く数行を連結したもの (option object の続き)
 * @returns {{kind: 'tz-dependent-member'|'utc-calendar-slice'|'implicit-locale-tz'|'calendar-reimpl'|'jst-offset-reimpl'} | null}
 */
export function classifyLine(line, lookahead = '') {
	if (isCommentLine(line)) return null;
	if (JST_OFFSET_REIMPL.test(line)) return { kind: 'jst-offset-reimpl' };
	if (UTC_CALENDAR_SLICE.test(line)) return { kind: 'utc-calendar-slice' };
	if (ISO_STRING_CALENDAR_SLICE.test(line)) return { kind: 'utc-calendar-slice' };
	if (CALENDAR_REIMPL.test(line)) return { kind: 'calendar-reimpl' };
	const hasTimeZone = HAS_EXPLICIT_TIME_ZONE.test(line) || HAS_EXPLICIT_TIME_ZONE.test(lookahead);
	if (INTL_DATE_TIME_FORMAT.test(line) && !hasTimeZone) return { kind: 'implicit-locale-tz' };
	if (DATE_RECEIVER_AMBIGUOUS_CALL.test(line) && !hasTimeZone)
		return { kind: 'implicit-locale-tz' };
	if (TZ_DEPENDENT_MEMBER_CALL.test(line)) {
		// toLocale* は timeZone を明示していれば TZ 非依存 (構造判定)
		if (/\.toLocale(String|DateString|TimeString)\s*\(/.test(line)) {
			return hasTimeZone ? null : { kind: 'implicit-locale-tz' };
		}
		return { kind: 'tz-dependent-member' };
	}
	return null;
}

/**
 * 1 ファイル分の content から違反行を抽出する (純関数)。
 * @param {string} relPath REPO_ROOT 相対 path
 * @param {string} content ファイル内容
 * @returns {Array<{file: string, line: number, snippet: string, kind: string}>}
 */
export function findOccurrencesInContent(relPath, content) {
	/** @type {Array<{file: string, line: number, snippet: string, kind: string}>} */
	const out = [];
	const lines = content.split(/\r?\n/);
	lines.forEach((line, idx) => {
		// option object が複数行に割れる整形に備え、続く 3 行を lookahead として渡す
		const hit = classifyLine(line, lines.slice(idx + 1, idx + 4).join('\n'));
		if (!hit) return;
		out.push({
			file: relPath.replace(/\\/g, '/'),
			line: idx + 1,
			snippet: line.trim().slice(0, 140),
			kind: hit.kind,
		});
	});
	return out;
}

/**
 * occurrence を file 別にまとめる
 * @param {Array<{file: string, line: number, snippet: string, kind: string}>} occurrences
 * @returns {Map<string, Array<{file: string, line: number, snippet: string, kind: string}>>}
 */
export function groupByFile(occurrences) {
	/** @type {Map<string, Array<{file: string, line: number, snippet: string, kind: string}>>} */
	const byFile = new Map();
	for (const o of occurrences) {
		const list = byFile.get(o.file) ?? [];
		list.push(o);
		byFile.set(o.file, list);
	}
	return byFile;
}

/**
 * occurrence 群を allowlist と突き合わせ、違反 (no-silent-gap / ratchet 超過) を返す。
 * @param {Array<{file: string, line: number, snippet: string, kind: string}>} occurrences
 * @returns {Array<{kind: 'not-allowlisted'|'over-max'|'slack', file: string, count: number, max: number, samples: Array<{file: string, line: number, snippet: string, kind: string}>}>}
 */
export function evaluateOccurrences(occurrences) {
	const byFile = groupByFile(occurrences);
	/** @type {Array<{kind: 'not-allowlisted'|'over-max'|'slack', file: string, count: number, max: number, samples: Array<{file: string, line: number, snippet: string, kind: string}>}>} */
	const violations = [];
	for (const [file, list] of byFile) {
		const entry = findAllowlistEntry(file);
		if (!entry) {
			violations.push({
				kind: 'not-allowlisted',
				file,
				count: list.length,
				max: 0,
				samples: list.slice(0, 5),
			});
			continue;
		}
		if (list.length > entry.max) {
			violations.push({
				kind: 'over-max',
				file,
				count: list.length,
				max: entry.max,
				samples: list.slice(0, 5),
			});
		} else if (list.length < entry.max) {
			// #4120: ratchet は「減ったら下げる」まで含めて初めて締まる。
			// max を実数より高いまま放置すると、**その差分だけ新規違反を黙って受け入れる**
			// 予算になる (実測: date-utils.ts は max=20 / actual=5 で 15 件分の余白があった)。
			violations.push({
				kind: 'slack',
				file,
				count: list.length,
				max: entry.max,
				samples: [],
			});
		}
	}
	return violations;
}

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function walk(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules') continue;
			walk(full, out);
		} else if (entry.isFile() && EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			out.push(full);
		}
	}
	return out;
}

/**
 * REPO_ROOT 配下の SEARCH_ROOTS を走査し全 occurrence を返す
 * @param {string} [repoRoot]
 * @returns {Array<{file: string, line: number, snippet: string, kind: string}>}
 */
export function findAllOccurrences(repoRoot = REPO_ROOT) {
	/** @type {Array<{file: string, line: number, snippet: string, kind: string}>} */
	const occurrences = [];
	for (const root of SEARCH_ROOTS) {
		for (const file of walk(path.join(repoRoot, root))) {
			const rel = path.relative(repoRoot, file);
			occurrences.push(...findOccurrencesInContent(rel, fs.readFileSync(file, 'utf8')));
		}
	}
	return occurrences;
}

function main() {
	const unclassified = findUnclassifiedDateMembers();
	if (unclassified.length > 0) {
		console.error(
			`[check-local-tz-date-getters] ✗ Date.prototype に未分類のメンバーがあります: ${unclassified.join(', ')}`,
		);
		process.exit(1);
	}

	const ambiguousProblems = findAmbiguousDeclarationProblems();
	if (ambiguousProblems.length > 0) {
		console.error(
			`[check-local-tz-date-getters] \u2717 AMBIGUOUS_MEMBERS \u5ba3\u8a00\u304c\u691c\u67fb\u3092\u901a\u308a\u307e\u305b\u3093\u3067\u3057\u305f (${ambiguousProblems.length} \u4ef6):`,
		);
		for (const p of ambiguousProblems) console.error(`  ${p.member}: ${p.problem}`);
		console.error(
			'\n  \u66d6\u6627\u30e1\u30f3\u30d0\u30fc\u306e\u5ba3\u8a00\u306f\u691c\u51fa\u3092\u5f31\u3081\u307e\u3059\u3002\u7406\u7531 + \u88dc\u511f\u691c\u51fa (DATE_RECEIVER_AMBIGUOUS_CALL) \u306e\u4e21\u65b9\u304c\u5fc5\u8981\u3067\u3059\u3002',
		);
		process.exit(1);
	}

	const occurrences = findAllOccurrences();
	const problems = findAllowlistIntegrityProblems(groupByFile(occurrences));
	if (problems.length > 0) {
		console.error(
			`[check-local-tz-date-getters] ✗ allowlist の除外理由が機械検証を通りませんでした (${problems.length} 件):\n`,
		);
		for (const p of problems) console.error(`  ${p.file}: ${p.problem}`);
		console.error(
			'\n  除外は kind ごとに検査されます (ssot / tz-proof / instant-offset / non-runtime)。',
		);
		console.error('  自由文の reason だけでは通りません (#4127)。');
		process.exit(1);
	}

	const violations = evaluateOccurrences(occurrences);
	if (violations.length === 0) {
		console.log(
			`[check-local-tz-date-getters] OK — allowlist (${ALLOWLIST.length} file、全件 kind 検証済) 外の TZ 依存日付導出なし`,
		);
		process.exit(0);
	}

	console.error(
		`[check-local-tz-date-getters] ✗ allowlist と実数が食い違う file が ${violations.length} 件あります (#4015 / #4127 / #4120):\n`,
	);
	for (const v of violations) {
		const head =
			v.kind === 'not-allowlisted'
				? `${v.file}: ${v.count} 件 (allowlist 未登録)`
				: v.kind === 'slack'
					? `${v.file}: ${v.count} 件 (allowlist 上限 ${v.max} 件を下回っています — max を ${v.count} に下げてください)`
					: `${v.file}: ${v.count} 件 (allowlist 上限 ${v.max} 件を超過)`;
		console.error(`  ${head}`);
		for (const s of v.samples) console.error(`    L${s.line} [${s.kind}]: ${s.snippet}`);
	}
	console.error('\n修正方針:');
	console.error(
		'  - [slack] 違反が減ったのに max が下がっていません。ratchet は「減ったら下げる」まで含めて初めて\n' +
			'    締まります (差分だけ新規違反を黙って受け入れる予算になる)。ALLOWLIST の max を実数に下げてください。',
	);
	console.error(
		'  - [tz-dependent-member] 実時刻から暦要素をローカル TZ で取り出しています。$lib/domain/date-utils.ts の',
	);
	console.error(
		'    JST SSOT (todayDateJST / toJSTDateString / jstHour / weekStartJST / weekEndJST / addDaysJST /',
	);
	console.error(
		'    prevDateJST / jstDayOfWeek / jstYearMonth / monthKeyJST / shiftMonthKey / monthStartJST /',
	);
	console.error('    monthEndJST / isInJstMonth) に置換してください。');
	console.error(
		'  - [utc-calendar-slice] `toISOString().slice(0, 10)` は **UTC の暦日**です。JST 00:00〜09:00 の',
	);
	console.error(
		'    9 時間だけ前日になります。todayDateJST() / toJSTDateString() / monthKeyJST() に置換。',
	);
	console.error(
		"  - [implicit-locale-tz] toLocale* / Intl.DateTimeFormat に `timeZone: 'Asia/Tokyo'` を明示するか、",
	);
	console.error(
		'    date-utils.ts の formatJST* を使ってください (SSR は Lambda=UTC で描画されます)。',
	);
	console.error(
		'  - TZ 非依存と言い切れる場合のみ ALLOWLIST に file / max / kind / reason を追加します。kind は',
	);
	console.error('    機械検証されます (tz-proof は 2 TZ 実測 case の登録が必要)。');
	process.exit(1);
}

if (isMainModule(import.meta.url)) {
	main();
}
