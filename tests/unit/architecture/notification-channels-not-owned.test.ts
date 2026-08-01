// #4192 (#4174 Q2 の PO 決裁) — **持たないと決めた通知チャネル**が、黙って復活しないようにする。
//
// ## なぜ test で持つのか
//
// 「配線を消す」だけだと、決定はコードから読めない。次に見た人は「まだ実装していないだけ」と読み、
// secret を登録して足す。実際 #4174 では逆向きに同じことが起きた —
// `tryGetContext('discordWebhookSignup') ?? ''` が残っていたために
// **「secret を登録すれば動く」= 持つつもりがある**、と読める状態になっていた。
//
// そこで **決定そのものを実行可能な形で置く**。下の `CHANNELS_NOT_OWNED` が
// 「持たない」「なぜ持たないか」「誰がいつ決めたか」を宣言し、test が実配線と照合する。
// 再配線すると CI が落ち、落ちた test が決定と理由を読み手に示す。
// (ADR-0061 fitness function / `aws-deploy-context-closure.test.ts` [AD1] の免除リストと同じ思想。
//  ただし免除リストは「CDK が読む口はあるが渡していない」を扱うもので、
//  **読む口ごと持たない**本件は表現できないため独立した gate にしてある。)
//
// ## 復活させたいときにやること
//
// この test を消して通すのではなく、**決裁をやり直す**。PO の判断が変わったら、その決定を
// 同じ表に反映する (行を消し、配線を戻す) — 順序はいつも「決裁 → 配線」。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 走査ではなく **固定 4 file の読み込み**なので入力は有界 (tests/CLAUDE.md §repo 走査 test の
// scope='bounded' 相当)。ディレクトリツリーを歩かないため明示 timeout は不要。

const ROOT = process.cwd();

/**
 * **持たないと決めた**運用通知チャネルと、その理由。
 *
 * `why` は「まだ作っていない」ではなく「送らないことを選んだ」と読める文にすること。
 */
const CHANNELS_NOT_OWNED: Array<{
	/** `discord-notify-service.ts` の DiscordChannel として持たない名前 */
	channel: string;
	/** Lambda に注入しない env */
	envKey: string;
	/** CDK が読まない context key */
	contextKey: string;
	/** 持たない理由 (決定の中身) */
	why: string;
	/** 決裁の出所 */
	decidedIn: string;
}> = [
	{
		channel: 'signup',
		envKey: 'DISCORD_WEBHOOK_SIGNUP',
		contextKey: 'discordWebhookSignup',
		why: 'サインアップは嬉しいが見ても何もしない。Pre-PMF の実数 (月数件) は GitHub / DB を見れば足りる。通知を増やすと incident が埋もれる',
		decidedIn: '#4174',
	},
	{
		channel: 'billing',
		envKey: 'DISCORD_WEBHOOK_BILLING',
		contextKey: 'discordWebhookBilling',
		why: '課金の成功は行動を変えない。失敗だけは行動を変えるので incident 側 (stripe-payment-failed) に残してある',
		decidedIn: '#4174',
	},
	{
		channel: 'churn',
		envKey: 'DISCORD_WEBHOOK_CHURN',
		contextKey: 'discordWebhookChurn',
		why: '解約理由は cancellation_reasons に残り ops dashboard で集計できる。通知で見ても何もできず、自由記述は顧客が書いた文章そのもので外部 SaaS に置くものでもない',
		decidedIn: '#4174',
	},
];

/** 実配線を探す対象 (「持っていたら必ずここに現れる」場所)。 */
const WIRING_FILES = [
	join(ROOT, 'src', 'lib', 'server', 'services', 'discord-notify-service.ts'),
	join(ROOT, 'infra', 'lib', 'compute-stack.ts'),
	join(ROOT, '.github', 'workflows', 'deploy.yml'),
	join(ROOT, '.github', 'workflows', 'deploy-aws-staging.yml'),
];

/**
 * 宣言の説明文中に現れる key 名は配線ではない (本 test 自身 / 決定を説明するコメント)。
 * 実配線だけを拾うため、**その key が「値として使われている」形**に限って検出する。
 */
function findWiring(source: string, entry: (typeof CHANNELS_NOT_OWNED)[number]): string[] {
	const hits: string[] = [];
	// CDK: tryGetContext('discordWebhookSignup')
	if (new RegExp(`tryGetContext\\(\\s*['"]${entry.contextKey}['"]`).test(source)) {
		hits.push(`tryGetContext('${entry.contextKey}')`);
	}
	// workflow: -c discordWebhookSignup=
	if (new RegExp(`-c\\s+${entry.contextKey}=`).test(source)) {
		hits.push(`-c ${entry.contextKey}=`);
	}
	// Lambda env 注入 / env 参照: DISCORD_WEBHOOK_SIGNUP: ... / env.DISCORD_WEBHOOK_SIGNUP
	if (new RegExp(`(^|[^A-Z_])${entry.envKey}\\s*:`, 'm').test(source)) {
		hits.push(`${entry.envKey}:`);
	}
	if (new RegExp(`env\\.${entry.envKey}\\b`).test(source)) {
		hits.push(`env.${entry.envKey}`);
	}
	// secrets.DISCORD_WEBHOOK_SIGNUP (workflow から渡す)
	if (new RegExp(`secrets\\.${entry.envKey}\\b`).test(source)) {
		hits.push(`secrets.${entry.envKey}`);
	}
	return hits;
}

describe('#4192 持たないと決めた通知チャネルが復活していない', () => {
	const sources = WIRING_FILES.map((path) => ({ path, source: readFileSync(path, 'utf-8') }));

	it.each(CHANNELS_NOT_OWNED)('$channel チャネルは配線を持たない ($decidedIn)', ({
		channel,
		envKey,
		contextKey,
		why,
		decidedIn,
	}) => {
		const found = sources.flatMap(({ path, source }) =>
			findWiring(source, { channel, envKey, contextKey, why, decidedIn }).map(
				(hit) => `${path.replace(ROOT, '.')}: ${hit}`,
			),
		);
		expect(
			found,
			`${channel} チャネルの配線が復活しています。\n` +
				`  持たないと決めた理由 (${decidedIn}): ${why}\n` +
				`  検出: ${found.join(' / ')}\n` +
				'  必要になったなら PO の決裁をやり直し、決定を CHANNELS_NOT_OWNED に反映してから配線してください。',
		).toEqual([]);
	});

	it('DiscordChannel 型が持たないチャネル名を含まない', () => {
		const source = readFileSync(WIRING_FILES[0] as string, 'utf-8');
		const match = source.match(/type DiscordChannel = ([^;]+);/);
		expect(match, 'DiscordChannel 型が見つかりません (定義位置が変わった?)').not.toBeNull();
		const declared = (match?.[1] ?? '')
			.split('|')
			.map((s) => s.trim().replace(/^'|'$/g, ''))
			.filter(Boolean);
		const revived = CHANNELS_NOT_OWNED.filter((e) => declared.includes(e.channel)).map(
			(e) => e.channel,
		);
		expect(
			revived,
			`持たないと決めたチャネルが DiscordChannel に復活しています: ${revived.join(', ')}`,
		).toEqual([]);
	});

	it('宣言に理由が書かれている (理由なき「持たない」を作らない)', () => {
		for (const entry of CHANNELS_NOT_OWNED) {
			expect(entry.why.length, `${entry.channel} の理由が短すぎます`).toBeGreaterThan(20);
			expect(entry.decidedIn, `${entry.channel} の決裁出所は #NNNN で書いてください`).toMatch(
				/^#\d+$/,
			);
		}
	});
});
