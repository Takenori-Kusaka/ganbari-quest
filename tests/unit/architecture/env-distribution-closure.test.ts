// #4191 — **読む口があるのに誰も配っていない env / context** を、経路を問わず 1 つの仕組みで検出する。
//
// ## 塞ぐ穴
//
// 配布側は **人が手で維持するリスト**だった。NUC は `deploy-nuc.yml` の `$envLines` 配列、AWS は
// `deploy.yml` の `-c <key>=` 列。読む側は増え続け、配る側は手で追随する。追随漏れは
// **deploy が成功したまま silent に落ちる**ので、CI も deploy も緑のまま気づかれない。
//
// 実害は 4 例:
//
// | # | 配られていなかったもの | 結果 |
// |---|---|---|
// | #4119 | `CRON_SECRET` / `DISCORD_ALERT_WEBHOOK_URL` (NUC) | 18 晩バックアップ失敗 + alert 0 通 |
// | #4167 | 同上 (再発経路が未閉鎖) | 手で直しても次の deploy で消える構造 |
// | #4174 | `discordWebhookIncident` (AWS) | 本番 incident 通知が一度も飛んでいない |
// | #4189 | `opsEmail` (AWS) | 本番 CloudWatch アラーム全系統が宛先ゼロ |
//
// 4 例とも同じ形で、4 例とも**実害が出るまで誰も気づかなかった**。
//
// ## なぜ既存 2 test では足りなかったか (AC5 の判断)
//
// #4167 / #4174 は経路ごとに closure test を建てた。方向は正しいが **SSOT が経路ごとにバラバラ**で、
// 新しい読み手 (別 script / 別 stack / 別 workflow) が増えるたびに対象外の穴ができる。実際:
//
//   - `nuc-deploy-env-closure.test.ts` は `backup-nuc.cjs` **1 file だけ**を読み手として見ていた
//     (`verify-backup-restore.cjs` / `backup-db.cjs` は対象外)。しかも「compose が配る」と
//     宣言していた 5 key のうち `OPS_SECRET_KEY` / `DISCORD_WEBHOOK_INCIDENT` は
//     **compose にも `.env` にも無かった** — 免除の理由が事実と違っても誰も検査していなかった
//   - `aws-deploy-context-closure.test.ts` は AWS の context だけで、アプリが読む env は対象外
//
// そこで **closure は本 file に統合**し、旧 2 file は削除した。経路固有の挙動検査
// (fail-closed / warning / deploy 後の実 env 検証 / diff↔deploy の context 一致) は closure とは
// 別の関心なので、本 file 後半の「経路固有の契約」節に役割を分けて残してある。
// 装置の本数は 3 → 1 に減っている (#4121 の方向と整合、ADR-0061 2026-07-30 amendment)。
//
// ## 仕組み (AC1 / AC2)
//
// 「読む側 (reader)」と「配る側 (channel)」をそれぞれ**機械抽出**し、突き合わせる。
//
//   reader  = 4 系統 (app env schema / `$env/dynamic/private` / CDK context / NUC 上で動く script)
//   channel = 5 経路 (NUC `.env` / docker-compose / Lambda env 注入 / AWS deploy context / staging context)
//
// reader は「どの channel で配られていれば良いか」を宣言し、**どれでも配られていなければ fail**。
// 配らないことが正しい key は `NOT_DISTRIBUTED` に**理由付きで宣言**する (AC3) —
// 「リストに無い」と「配らないと決めた」を区別できるようにするのが本 file の要点。
//
// ## 既知の残課題 (accepted residual、ADR-0061 §5)
//
// reader → channel は **host 単位ではなく channel 集合の OR** で判定する。つまり
// 「AWS には配っているが NUC には配っていない」app env は本 gate を通る。host 単位に割ると
// app env schema (65 key) × host 数の宣言が要り、Pre-PMF では割に合わない (ADR-0010)。
// **実害 4 例が起きた NUC script 経路は host 限定 (`nuc-*` channel のみ) で判定している**ので、
// #4119 型 (NUC に配り忘れ) は OR でも検出できる。

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo ツリー (src / scripts / infra) を走査するため scope='repo'。明示 timeout を置く
// (tests/CLAUDE.md §repo 走査 test)。
vi.setConfig({ testTimeout: 60_000 });

const ROOT = process.cwd();

function read(...segments: string[]): string {
	return readFileSync(join(ROOT, ...segments), 'utf-8');
}

/** dir 配下を再帰的に歩き、`match` を満たす file の絶対パスを返す。 */
function walk(dir: string, match: (name: string) => boolean, acc: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === '.svelte-kit') continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, match, acc);
		else if (match(name)) acc.push(path);
	}
	return acc;
}

/**
 * コメントを落とす。env 名は解説コメントの中にも頻出するため、**コメントを配線と数えない**。
 * (旧 test が `suppliedByCompose` の宣言を実配線と照合できなかったのと同じ穴を作らない)
 *
 * ブロックコメントを正規表現で「開始と終了の対」として消す実装は使わない。CDK には S3 ARN
 * (`bucketArn` + スラッシュ + アスタリスク) のようにコメントでない開始記号があり、それが後続
 * コメントの終端と対になって**間のコード全部を消す** (実測: compute-stack.ts が 32KB → 6KB になり
 * `tryGetContext` が 18 → 8 件に減った)。行単位に落として対応付け自体を起こさない。
 */
function stripComments(source: string): string {
	return source
		.split('\n')
		.map((line) => {
			const trimmed = line.trimStart();
			if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'))
				return '';
			// 行末コメント。URL の `://` を誤って切らない。
			return line.replace(/(^|[^:])\/\/.*$/, '$1');
		})
		.join('\n');
}

function matchAll(source: string, pattern: RegExp): string[] {
	return [...source.matchAll(pattern)]
		.map((m) => m[1])
		.filter((v): v is string => typeof v === 'string');
}

// ---------------------------------------------------------------------------
// 配る側 (channel)
// ---------------------------------------------------------------------------

type ChannelId =
	| 'nuc-dotenv'
	| 'nuc-compose'
	| 'aws-lambda-env'
	| 'aws-deploy-context'
	| 'aws-staging-context';

type Channel = {
	/** 何を配る経路か (fail message に出す) */
	label: string;
	/** 抽出元 */
	where: string;
	/** 配っている名前 */
	keys: () => Set<string>;
	/**
	 * 抽出が壊れて空集合になると「全部未配布」ではなく「全部素通り」に倒れる箇所があるため、
	 * **最低件数を置いて gate 自身の故障を検出する** (#4084「検査できなかった」を skip で通した教訓)。
	 */
	minKeys: number;
};

const NUC_WORKFLOW = '.github/workflows/deploy-nuc.yml';
const AWS_WORKFLOW = '.github/workflows/deploy.yml';
const AWS_STAGING_WORKFLOW = '.github/workflows/deploy-aws-staging.yml';
const COMPOSE = 'docker-compose.yml';

/** `.env` を生成する step の本文 (`Set-Content -Path .env` までが「実際に書かれる」範囲)。 */
function nucDotenvBlock(): string {
	const workflow = read(NUC_WORKFLOW);
	const start = workflow.indexOf('Generate .env from GitHub Secrets');
	const end = workflow.indexOf('Set-Content -Path .env', start);
	if (start < 0 || end < 0) {
		throw new Error(
			`${NUC_WORKFLOW} の .env 生成 step が見つかりません (step 名か Set-Content が変わった?)`,
		);
	}
	return workflow.slice(start, end);
}

/** `-c key=` / `format('-c key=` の両形式で渡している context key。 */
function contextKeysPassedBy(workflow: string): Set<string> {
	return new Set([
		...matchAll(workflow, /-c\s+([A-Za-z0-9_]+)=/g),
		...matchAll(workflow, /format\(\s*'-c\s+([A-Za-z0-9_]+)=/g),
	]);
}

const CHANNELS: Record<ChannelId, Channel> = {
	'nuc-dotenv': {
		label: 'NUC の .env (deploy のたびに固定リストで全上書きされる)',
		where: `${NUC_WORKFLOW} の "Generate .env from GitHub Secrets" step`,
		// `$envLines` に積まれた `"NAME=..."` 行だけを拾う。step の `env:` への宣言は
		// **`.env` に書かれない限り配られていない**ので数えない。
		keys: () => new Set(matchAll(nucDotenvBlock(), /"([A-Z][A-Z0-9_]*)=/g)),
		minKeys: 6,
	},
	'nuc-compose': {
		label: 'docker-compose の environment: (NUC コンテナに直接与える構成値)',
		where: COMPOSE,
		keys: () => new Set(matchAll(read(COMPOSE), /^\s*-\s([A-Z][A-Z0-9_]*)=/gm)),
		minKeys: 8,
	},
	'aws-lambda-env': {
		label: 'CDK が Lambda に注入する環境変数',
		where: 'infra/lib/*.ts',
		keys: () => {
			const keys = new Set<string>();
			for (const path of walk(join(ROOT, 'infra', 'lib'), (n) => n.endsWith('.ts'))) {
				const source = stripComments(readFileSync(path, 'utf-8'));
				for (const key of matchAll(source, /\b([A-Z][A-Z0-9_]{2,})\s*:/g)) keys.add(key);
			}
			return keys;
		},
		minKeys: 20,
	},
	'aws-deploy-context': {
		label: '本番 AWS deploy が渡す CDK context',
		where: AWS_WORKFLOW,
		keys: () => contextKeysPassedBy(read(AWS_WORKFLOW)),
		minKeys: 20,
	},
	'aws-staging-context': {
		label: 'staging AWS deploy が渡す CDK context',
		where: AWS_STAGING_WORKFLOW,
		keys: () => contextKeysPassedBy(read(AWS_STAGING_WORKFLOW)),
		minKeys: 5,
	},
};

// ---------------------------------------------------------------------------
// 読む側 (reader)
// ---------------------------------------------------------------------------

type ReaderId = 'app-env-schema' | 'app-dynamic-env' | 'cdk-context' | 'nuc-script-env';

type Reader = {
	label: string;
	where: string;
	/** 読んでいる名前 (SSOT は常に**読む側のコード**であって、配布リストの写しではない) */
	keys: () => Set<string>;
	/** このどれかで配られていれば良い */
	channels: ChannelId[];
	/** 抽出故障の検出 (channel と同じ理由) */
	minKeys: number;
	/** 配られていなかったときに何が起きるか (fail message に出す) */
	consequence: string;
};

/** `src/lib/runtime/env.ts` の zod schema のキー (getEnv() が読む env の全集合)。 */
function appEnvSchemaKeys(): Set<string> {
	const source = read('src', 'lib', 'runtime', 'env.ts');
	const start = source.indexOf('const envSchema = z.object({');
	const end = source.indexOf('\n});', start);
	if (start < 0 || end < 0) throw new Error('src/lib/runtime/env.ts の envSchema が見つかりません');
	return new Set(matchAll(source.slice(start, end), /^\t([A-Z][A-Z0-9_]*):/gm));
}

/**
 * `$env/dynamic/private` 経由で読まれる env。
 *
 * env.ts の schema は「読む側の全集合」ではない — 実害 #4119 の `DISCORD_ALERT_WEBHOOK_URL` は
 * schema に無く、この経路と NUC script からしか読まれていない。3 系統では足りないので 4 系統目に置く。
 */
function appDynamicEnvKeys(): Set<string> {
	const keys = new Set<string>();
	for (const path of walk(join(ROOT, 'src'), (n) => n.endsWith('.ts') || n.endsWith('.svelte'))) {
		const source = readFileSync(path, 'utf-8');
		if (!source.includes('$env/dynamic/private')) continue;
		for (const key of matchAll(stripComments(source), /\benv\.([A-Z][A-Z0-9_]{2,})\b/g))
			keys.add(key);
	}
	return keys;
}

/** CDK が `tryGetContext` で読む context key。 */
function cdkContextKeys(): Set<string> {
	const keys = new Set<string>();
	const sources = [
		join(ROOT, 'infra', 'bin', 'app.ts'),
		...walk(join(ROOT, 'infra', 'lib'), (n) => n.endsWith('.ts')),
	];
	for (const path of sources) {
		const source = stripComments(readFileSync(path, 'utf-8'));
		for (const key of matchAll(source, /tryGetContext\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g))
			keys.add(key);
	}
	return keys;
}

/**
 * NUC 上で動く script が読む env。
 *
 * 対象は `scripts/**` の `.cjs` **全件**。`.cjs` は NUC コンテナ (docker-compose backup /
 * scheduler) から実行される script だけが使う拡張子で、CI 専用 gate はすべて `.mjs`。
 * file 名を手で列挙すると「新しい script を足したのに対象外」が起きるため、拡張子で機械列挙する。
 */
function nucScriptEnvKeys(): Set<string> {
	const keys = new Set<string>();
	for (const path of walk(join(ROOT, 'scripts'), (n) => n.endsWith('.cjs'))) {
		const source = stripComments(readFileSync(path, 'utf-8'));
		for (const key of matchAll(source, /process\.env\.([A-Z][A-Z0-9_]*)/g)) keys.add(key);
	}
	return keys;
}

const READERS: Record<ReaderId, Reader> = {
	'app-env-schema': {
		label: 'アプリ本体の env schema (getEnv())',
		where: 'src/lib/runtime/env.ts',
		keys: appEnvSchemaKeys,
		channels: ['nuc-dotenv', 'nuc-compose', 'aws-lambda-env'],
		minKeys: 40,
		consequence: 'その機能が無効のまま起動し、エラーも出さずに「動いているが何もしない」状態になる',
	},
	'app-dynamic-env': {
		label: 'アプリ本体の $env/dynamic/private 参照',
		where: 'src/**（$env/dynamic/private を import する file）',
		keys: appDynamicEnvKeys,
		channels: ['nuc-dotenv', 'nuc-compose', 'aws-lambda-env'],
		minKeys: 8,
		consequence: '宛先解決や外部連携が undefined のまま no-op になる (#4119 の通知 0 通がこれ)',
	},
	'cdk-context': {
		label: 'CDK が読む context',
		where: 'infra/bin/app.ts + infra/lib/*.ts',
		keys: cdkContextKeys,
		channels: ['aws-deploy-context', 'aws-staging-context'],
		minKeys: 25,
		consequence: 'synth も deploy も成功したまま、その env が Lambda から丸ごと落ちる (#4174)',
	},
	'nuc-script-env': {
		label: 'NUC 上で動く script が読む env',
		where: 'scripts/**/*.cjs',
		// NUC でしか動かないので **AWS 側の配布では満たされない**。#4119 型 (NUC 配り忘れ) の検出点。
		channels: ['nuc-dotenv', 'nuc-compose'],
		keys: nucScriptEnvKeys,
		minKeys: 8,
		consequence: '毎晩のバックアップが静かに失敗し続ける (#4119 は 18 晩気づかれなかった)',
	},
};

// ---------------------------------------------------------------------------
// 配らないと決めたもの (AC3)
// ---------------------------------------------------------------------------

/**
 * **配らないことが正しい** key と、その理由。
 *
 * ここに載せるのは「配らなくても壊れない」ものだけ。壊れるが今は塞げないものは `followUp` に
 * Issue 番号を書き、放置されないようにする (理由なき免除を作らない)。
 *
 * `why` は「まだ配っていない」ではなく「**配らないことを選んだ**」と読める文にすること。
 */
const NOT_DISTRIBUTED: Array<{
	/** どの reader に対する免除か (同じ名前を複数系統が読むことがあるため配列) */
	readers: ReaderId[];
	keys: string[];
	why: string;
	followUp?: string;
}> = [
	// ---- アプリ本体が読む env ----
	{
		readers: ['app-env-schema', 'app-dynamic-env'],
		keys: ['AWS_REGION', 'AWS_LAMBDA_FUNCTION_NAME', 'VITEST'],
		why: '実行基盤 (Lambda / vitest) が自動で与える。deploy が上書きすると基盤の値と食い違う',
	},
	{
		readers: ['app-env-schema'],
		keys: [
			'DEBUG_PLAN',
			'DEBUG_TRIAL',
			'DEBUG_TRIAL_TIER',
			'COGNITO_DEV_MODE',
			'STRIPE_MOCK',
			'PARENT_GATE_FORCE_ACTIVE',
		],
		why: '開発時にプラン / 認証 / 決済を偽装するための env。本番に配ると偽装が本番で効いてしまうので、配らないことが正しい',
	},
	{
		readers: ['app-env-schema'],
		keys: ['PARENT_PIN_RESET'],
		why: '運用者が PIN を初期化したいときだけ手で置く一回限りの token。常時配ると毎 deploy で PIN が消える',
	},
	{
		readers: ['app-env-schema', 'app-dynamic-env'],
		keys: [
			'APP_MODE',
			'IS_NUC_DEPLOY',
			'SCHEMA_VALIDATION_MODE',
			'LOG_LEVEL',
			'GEMINI_MODEL',
			'BEDROCK_MODEL_ID',
			'BEDROCK_REGION',
			'BEDROCK_DISABLED',
			'VAPID_SUBJECT',
			'OPS_DOMAIN_COST_JPY',
			'OPS_VIRTUAL_OFFICE_COST_JPY',
			'DSQL_DATABASE',
			'PGLITE_MIGRATIONS_DIR',
			'APP_BASE_URL',
		],
		why: '既定値のまま動く上書き用の env。未設定が正常系で、既定値を変えたいときだけ設定する',
	},
	{
		readers: ['app-dynamic-env'],
		keys: ['PRICING_TRIGGER_MIN_PAID_USERS', 'SKIP_LOCAL_EMAIL_PREVIEW'],
		why: '既定値のまま動く上書き用の env。未設定が正常系で、開発時にだけ設定する',
	},
	{
		readers: ['app-env-schema'],
		keys: ['GITHUB_TOKEN', 'GH_TOKEN'],
		why: '/ops の admin bypass 集計をローカルで実行するときだけ使う。本番 Lambda に GitHub の書込権を渡さない',
	},
	{
		readers: ['app-env-schema'],
		keys: ['COGNITO_CLIENT_SECRET'],
		why: 'Cognito app client を secret 無し (public client) で作っているため、渡す値自体が存在しない',
	},
	{
		readers: ['app-env-schema'],
		keys: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
		why: 'Web Push は未提供で鍵も発行していない。提供を決めた時点で配布経路ごと足す',
	},

	// ---- CDK context ----
	{
		readers: ['cdk-context'],
		keys: ['demoDomainName'],
		why: 'default が demo.<domainName> (infra/bin/app.ts)。上書きしたいときだけ渡す任意 override で、未指定が正常系',
	},
	{
		readers: ['cdk-context'],
		keys: ['demoCertificateArn'],
		why: 'default が本番 certificateArn (infra/bin/app.ts)。wildcard 証明書を共用するため未指定が正常系',
	},
	// ---- NUC 上で動く script ----
	{
		readers: ['nuc-script-env'],
		keys: ['OPS_SECRET_KEY', 'DISCORD_WEBHOOK_INCIDENT'],
		why: 'backup-nuc.cjs では CRON_SECRET / DISCORD_ALERT_WEBHOOK_URL の第 2 候補。第 1 候補を .env で配っているので、これ自体を配らなくても壊れない',
	},
	{
		readers: ['nuc-script-env'],
		keys: ['BACKUP_POST_HOOK'],
		why: 'バックアップ後に走らせる任意コマンド (GDrive 退避等)。運用者が .env に手で置く拡張点で、未設定が正常系',
	},
	{
		readers: ['nuc-script-env'],
		keys: ['VERIFY_BACKUP_FILE', 'ALLOW_EMPTY'],
		why: '手動実行時に検証対象や挙動を指定する引数相当の env。定常運用では設定しない',
	},
];

// ---------------------------------------------------------------------------

function distributedFor(reader: Reader): Set<string> {
	const keys = new Set<string>();
	for (const id of reader.channels) for (const key of CHANNELS[id].keys()) keys.add(key);
	return keys;
}

function exemptFor(readerId: ReaderId): Map<string, (typeof NOT_DISTRIBUTED)[number]> {
	const map = new Map<string, (typeof NOT_DISTRIBUTED)[number]>();
	for (const entry of NOT_DISTRIBUTED) {
		if (!entry.readers.includes(readerId)) continue;
		for (const key of entry.keys) map.set(key, entry);
	}
	return map;
}

const readerEntries = Object.entries(READERS) as Array<[ReaderId, Reader]>;

describe('#4191 env / context 配布の closure (経路横断)', () => {
	it.each(
		readerEntries,
	)('[EC1] %s が読む名前は、どれかの配布経路に載っている', (readerId, reader) => {
		const distributed = distributedFor(reader);
		const exempt = exemptFor(readerId);
		const unaccounted = [...reader.keys()]
			.filter((k) => !distributed.has(k) && !exempt.has(k))
			.sort();
		expect(
			unaccounted,
			`${reader.label} (${reader.where}) が読んでいるのに、どの配布経路 ` +
				`(${reader.channels.join(' / ')}) にも載っていない名前があります: ${unaccounted.join(', ')}\n` +
				`  配られないと: ${reader.consequence}\n` +
				'  配布経路に足すか、配らなくてよい理由を NOT_DISTRIBUTED に宣言してください。',
		).toEqual([]);
	});

	it('[EC2] 「配らない」宣言が stale でない (配り始めた / 読まなくなったのに残り続けない)', () => {
		// 1 宣言が複数 reader に効くので、**宣言が仕事をしているか**で判定する:
		//   - 対象 reader の**すべて**で既に配られている key → もう免除は要らない (stale)
		//   - 対象 reader の**どれも**読んでいない key → 読む側が消えた (stale)
		for (const entry of NOT_DISTRIBUTED) {
			const readers = entry.readers.map((id) => READERS[id]);
			const distributedPerReader = readers.map((r) => distributedFor(r));
			const readPerReader = readers.map((r) => r.keys());

			const nowDistributed = entry.keys.filter((k) => distributedPerReader.every((d) => d.has(k)));
			expect(
				nowDistributed,
				`${entry.readers.join('/')}: 配らないと宣言したのに実際は全経路で配られている名前があります: ${nowDistributed.join(', ')}。NOT_DISTRIBUTED から削除してください。`,
			).toEqual([]);

			const noLongerRead = entry.keys.filter((k) => !readPerReader.some((r) => r.has(k)));
			expect(
				noLongerRead,
				`${entry.readers.join('/')}: 宣言にあるのに、どの reader も読んでいない名前があります: ${noLongerRead.join(', ')}。読む側の撤去に合わせて削除してください。`,
			).toEqual([]);
		}
	});

	it('[EC3] 「配らない」宣言に理由がある (理由なき免除を作らない)', () => {
		for (const entry of NOT_DISTRIBUTED) {
			expect(entry.keys.length, `${entry.readers.join('/')} の宣言が空です`).toBeGreaterThan(0);
			expect(
				entry.why.length,
				`${entry.readers.join('/')} / ${entry.keys.join(',')} の理由が短すぎます: "${entry.why}"`,
			).toBeGreaterThan(20);
			if (entry.followUp !== undefined) {
				// 「壊れているが今は塞げない」ものは追跡先を必ず持つ。
				expect(
					entry.followUp,
					`${entry.keys.join(',')} の followUp は Issue 番号 (#NNNN) で書いてください`,
				).toMatch(/^#\d+$/);
			}
		}
	});

	it('[EC4] 抽出そのものが壊れていない (空集合で全部素通りしない)', () => {
		// 抽出が壊れると、reader 側は「読む口ゼロ」= 常に PASS に倒れる。**検査できなかったことを
		// 成功と数えない** (#4084 と同じ立場)。
		for (const [id, channel] of Object.entries(CHANNELS)) {
			const size = channel.keys().size;
			expect(
				size,
				`channel ${id} (${channel.where}) の抽出が ${size} 件しかありません。抽出パターンが実ファイルとずれていないか確認してください。`,
			).toBeGreaterThanOrEqual(channel.minKeys);
		}
		for (const [id, reader] of readerEntries) {
			const size = reader.keys().size;
			expect(
				size,
				`reader ${id} (${reader.where}) の抽出が ${size} 件しかありません。抽出パターンが実ファイルとずれていないか確認してください。`,
			).toBeGreaterThanOrEqual(reader.minKeys);
		}
	});

	it('[EC5] 実害 4 例の配布が現在も生きている', () => {
		// 一度塞いだものが黙って外れないよう、事故そのものを pin する。
		const nucEnv = CHANNELS['nuc-dotenv'].keys();
		expect(
			nucEnv,
			'CRON_SECRET が NUC の .env から消えると日次バックアップが毎晩失敗する (#4119)',
		).toContain('CRON_SECRET');
		expect(
			nucEnv,
			'DISCORD_ALERT_WEBHOOK_URL の配布経路が消えると、失敗しても alert が 0 通になる (#4119)',
		).toContain('DISCORD_ALERT_WEBHOOK_URL');

		expect(
			CHANNELS['aws-deploy-context'].keys(),
			'discordWebhookIncident が消えると本番 Lambda の incident 通知が 0 通になる (#4174)',
		).toContain('discordWebhookIncident');

		// #4189: opsEmail は配布済になったので、免除宣言ではなく**配布経路にあること**を pin する。
		// これが消えると OpsStack の SNS topic に subscription が 1 件も付かず、
		// 全 CloudWatch alarm が宛先ゼロに戻る。
		expect(
			CHANNELS['aws-deploy-context'].keys(),
			'opsEmail が消えると本番 CloudWatch アラームが全系統宛先ゼロになる (#4189)',
		).toContain('opsEmail');
		expect(
			NOT_DISTRIBUTED.find(
				(e) => e.readers.includes('cdk-context') && e.keys.includes('opsEmail'),
			),
			'opsEmail は配布済なので免除宣言に戻してはいけない (#4189)',
		).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 経路固有の契約 (closure とは別の関心。旧 2 test から役割を分けて引き継いだもの)
// ---------------------------------------------------------------------------

/** `- name: X` 単位で workflow を切り出す。 */
function splitWorkflowSteps(workflow: string): Array<{ name: string; body: string }> {
	const steps: Array<{ name: string; body: string }> = [];
	const starts = [...workflow.matchAll(/^ {6}- name: (.+)$/gm)];
	for (const [i, m] of starts.entries()) {
		const name = m[1];
		if (typeof name !== 'string' || m.index === undefined) continue;
		steps.push({
			name: name.trim(),
			body: workflow.slice(m.index, starts[i + 1]?.index ?? workflow.length),
		});
	}
	return steps;
}

function workflowStep(workflow: string, needle: string): string {
	const step = splitWorkflowSteps(workflow).find((s) => s.name.includes(needle));
	if (!step) throw new Error(`workflow に "${needle}" を含む step が見つかりません`);
	return step.body;
}

describe('#4167 NUC deploy は「配れなかった」ことを黙って進めない', () => {
	const block = nucDotenvBlock();

	it('[NR1] CRON_SECRET 欠落時は deploy を止める (fail-closed)', () => {
		// warning で流すと「deploy は緑、バックアップだけ静かに死ぬ」に戻る。18 晩それが続いた。
		expect(block).toMatch(/if \(-not \$env:CRON_SECRET\)/);
		expect(block.slice(block.indexOf('$env:CRON_SECRET'))).toContain('exit 1');
	});

	it('[NR2] 通知先が無いときは警告を出す (黙って進めない)', () => {
		// 通知先の欠落で deploy を止めるのは過剰 (取得自体は動く) だが、黙って進むと
		// 「失敗しても誰にも届かない」状態が可視化されない (ADR-0024)。
		expect(block).toMatch(/if \(-not \$env:DISCORD_ALERT_WEBHOOK_URL\)/);
		expect(block).toContain('::warning::');
	});
});

describe('#4174 AWS deploy は context を渡し忘れたまま緑にならない', () => {
	const deployWorkflow = read(AWS_WORKFLOW);

	/**
	 * 本番 compute stack を触る cdk 呼び出し (diff / deploy)。compute stack を含む呼び出しは
	 * DSQL endpoint を必ず渡す (未注入で synth error) ため `-c dsqlEndpoint=` で判別する。
	 */
	const computeSteps = splitWorkflowSteps(deployWorkflow).filter(
		(s) => s.body.includes('npx cdk') && s.body.includes('-c dsqlEndpoint='),
	);

	it('[AR1] 本番 compute を触る cdk diff / deploy の context 集合が一致している', () => {
		// diff にだけ渡して deploy に渡し忘れると、**diff には差分が出ないのに実 env が落ちる**。
		expect(
			computeSteps.length,
			'本番 compute を触る cdk 呼び出しが見つかりません',
		).toBeGreaterThanOrEqual(2);
		const [first, ...rest] = computeSteps;
		if (!first) throw new Error('unreachable');
		const baseline = [...contextKeysPassedBy(first.body)].sort();
		for (const step of rest) {
			expect(
				[...contextKeysPassedBy(step.body)].sort(),
				`cdk 呼び出し間で渡す context が食い違っています ("${first.name}" vs "${step.name}")`,
			).toEqual(baseline);
		}
	});

	it('[AR2] incident 通知先の secret が空なら警告を出す (黙って進めない)', () => {
		const step = workflowStep(deployWorkflow, 'Incident webhook secret presence');
		expect(step).toContain('secrets.DISCORD_WEBHOOK_INCIDENT');
		expect(step).toContain('::warning::');
		expect(step).toContain('INCIDENT_WEBHOOK_CONFIGURED');
	});

	it('[AR3] deploy 後に実 Lambda env を読んで検証し、配線不良なら fail する', () => {
		// synth の diff では「渡し忘れ」を検出できない (渡し忘れた状態が現状なので差分が出ない)。
		const step = workflowStep(deployWorkflow, 'Incident webhook env verification');
		expect(step).toContain('aws lambda get-function-configuration');
		expect(step).toContain('Environment.Variables');
		expect(step).toContain('DISCORD_WEBHOOK_INCIDENT');
		expect(step, '配線不良を検出しても exit しないなら gate にならない').toContain('exit 1');
		expect(step).toContain('::error::');
	});
});

// ---------------------------------------------------------------------------
// #4189: 「配っている」だけでは足りない — **宛先が実在すること**まで守る
//
// opsEmail を deploy.yml に足しても、secret が未登録なら `${{ secrets.X }}` は空文字に落ち、
// `if (opsEmail)` を通らず subscription 0 件のまま deploy が成功する。これは #4119 (18 晩
// バックアップ失敗で alert 0 通) と同じ「未設定なら通知しない」の形なので、
// warn ではなく **deploy を止める** 側に倒す (ADR-0006 / ADR-0024)。
// ---------------------------------------------------------------------------
describe('#4189 CloudWatch アラームの宛先', () => {
	const deployYml = readFileSync('.github/workflows/deploy.yml', 'utf8');

	it('OPS_ALERT_EMAIL 未登録なら deploy を止める (必須 secret 検証に載っている)', () => {
		const validateStep = deployYml.slice(
			deployYml.indexOf('name: Validate required secrets'),
			deployYml.indexOf('name: Configure AWS credentials'),
		);
		expect(validateStep).toContain('OPS_ALERT_EMAIL');
		// for ループの検査対象に入っていること (env に置いただけでは検査されない)
		expect(validateStep).toMatch(/for s in [^;]*OPS_ALERT_EMAIL/);
	});

	it('deploy 後に実 SNS topic の subscription を見る smoke がある', () => {
		expect(deployYml).toContain('list-subscriptions-by-topic');
		// 「1 件ある」だけで通すと PendingConfirmation (未承認 = 配信されない) を見逃す
		expect(deployYml).toContain('PendingConfirmation');
	});
});
