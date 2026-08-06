// src/lib/server/ai/bedrock-claude-provider.ts
// Bedrock Claude 実装 (#987)
//
// 既存の bedrock-client.ts のロジックを AiProvider インターフェースに適合させる。
// Lambda (AWS) 環境で IAM ロール認証により自動的に利用可能。

import {
	BedrockRuntimeClient,
	type ContentBlock,
	type ConversationRole,
	ConverseCommand,
	type Message,
	type SystemContentBlock,
	type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { isProviderLatchedUnavailable, withAvailabilityTracking } from './availability';
import type { AiProvider, ToolDefinition, ToolUseResult } from './provider';

/**
 * `BEDROCK_MODEL_ID` 未配布時に呼び出しへ渡す既定モデル。
 *
 * **可用性判定には使わない** (#4366)。既定値があること自体は「設定が配られている」ことを意味せず、
 * 既定値を根拠に `isAvailable()` を true にしたのが本欠陥の原因だった。
 */
const DEFAULT_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * 呼び出しごとに env を読む。module 読込時に固定すると、テストからも運用からも
 * 「配られていない」状態を再現できなくなる (#4366 の検出が遅れた一因)。
 */
function resolveModelId(): string {
	return process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
}

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
	if (!_client) {
		const region = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
		_client = new BedrockRuntimeClient({ region });
	}
	return _client;
}

/** ToolDefinition → Bedrock Tool 配列 */
function buildTools(tool: ToolDefinition): Tool[] {
	return [
		{
			toolSpec: {
				name: tool.name,
				description: tool.description,
				// biome-ignore lint/suspicious/noExplicitAny: Bedrock SDK の DocumentType は再帰型で Record<string,unknown> と非互換
				inputSchema: { json: tool.inputSchema } as any,
			},
		},
	];
}

/** Bedrock Converse レスポンスの output 型 */
interface ConverseOutput {
	message?: {
		content?: Array<{
			toolUse?: {
				name?: string;
				input?: unknown;
			};
		}>;
	};
}

/** Bedrock レスポンスから tool_use ブロックを抽出 */
function extractToolUse(
	output: ConverseOutput | undefined,
	fallbackToolName: string,
): ToolUseResult {
	if (output?.message?.content) {
		for (const block of output.message.content) {
			if (block.toolUse) {
				return {
					toolName: block.toolUse.name ?? fallbackToolName,
					input: (block.toolUse.input as Record<string, unknown>) ?? {},
				};
			}
		}
	}
	throw new Error('No tool_use block in Bedrock response');
}

export class BedrockClaudeProvider implements AiProvider {
	readonly name = 'bedrock-claude';

	/**
	 * Bedrock を呼んでよいかを申告する。
	 *
	 * ## この戻り値が保証すること / しないこと (#4366)
	 *
	 * - **`false` は確定**: 「呼んでも無駄」を意味する。明示的に無効化されているか、`BEDROCK_MODEL_ID`
	 *   が配られていないか、直前の呼び出しが権限・資格情報の欠落で落ちている。
	 * - **`true` は「設定が揃っている」までしか保証しない**。IAM で `bedrock:InvokeModel` が
	 *   許可されているかは **呼ぶまで確定しない**ため、ここでは判定できない。実可用性は
	 *   ① サービス層のフォールバック (`try/catch`) と ② 可用性クラスのエラーを記録する
	 *   `availability.ts` の latch で担保する。
	 *
	 * `BEDROCK_MODEL_ID` の**明示配布**を要求するのが要点。既定値を持ったまま無条件 `true` を
	 * 返すと「AWS で Bedrock を使うと決めた」ことと「まだ何も配線していない」ことが区別できず、
	 * AI 提案が本番で無言の不作動になる (#4366)。判定粒度は Gemini 側 (API キーの実在を見る) と揃える。
	 */
	isAvailable(): boolean {
		if (process.env.BEDROCK_DISABLED === 'true') return false;
		// env の明示配布を要求する。未配布 = この環境では Bedrock を使わないと読む。
		if (!process.env.BEDROCK_MODEL_ID) return false;
		// 権限・資格情報の欠落で既に落ちている provider は、以降呼びに行かない。
		if (isProviderLatchedUnavailable(this.name)) return false;
		return true;
	}

	async converseWithTool(opts: {
		system: string;
		userMessage: string;
		tool: ToolDefinition;
		maxTokens?: number;
	}): Promise<ToolUseResult> {
		const client = getClient();
		const systemContent: SystemContentBlock[] = [{ text: opts.system }];
		const messages: Message[] = [
			{
				role: 'user' as ConversationRole,
				content: [{ text: opts.userMessage }] as ContentBlock[],
			},
		];
		const tools = buildTools(opts.tool);

		const response = await withAvailabilityTracking(this.name, () =>
			client.send(
				new ConverseCommand({
					modelId: resolveModelId(),
					system: systemContent,
					messages,
					toolConfig: {
						tools,
						toolChoice: { tool: { name: opts.tool.name } },
					},
					inferenceConfig: {
						maxTokens: opts.maxTokens ?? 1024,
						temperature: 0.3,
					},
				}),
			),
		);

		return extractToolUse(response.output as ConverseOutput | undefined, opts.tool.name);
	}

	async converseWithImageAndTool(opts: {
		system: string;
		userText: string;
		imageBase64: string;
		imageMimeType: string;
		tool: ToolDefinition;
		maxTokens?: number;
	}): Promise<ToolUseResult> {
		const client = getClient();
		const systemContent: SystemContentBlock[] = [{ text: opts.system }];

		const formatMap: Record<string, 'png' | 'jpeg' | 'gif' | 'webp'> = {
			'image/png': 'png',
			'image/jpeg': 'jpeg',
			'image/gif': 'gif',
			'image/webp': 'webp',
		};
		const format = formatMap[opts.imageMimeType] ?? 'jpeg';

		const messages: Message[] = [
			{
				role: 'user' as ConversationRole,
				content: [
					{
						image: {
							format,
							source: { bytes: Buffer.from(opts.imageBase64, 'base64') },
						},
					},
					{ text: opts.userText },
				] as ContentBlock[],
			},
		];
		const tools = buildTools(opts.tool);

		const response = await withAvailabilityTracking(this.name, () =>
			client.send(
				new ConverseCommand({
					modelId: resolveModelId(),
					system: systemContent,
					messages,
					toolConfig: {
						tools,
						toolChoice: { tool: { name: opts.tool.name } },
					},
					inferenceConfig: {
						maxTokens: opts.maxTokens ?? 1024,
						temperature: 0.2,
					},
				}),
			),
		);

		return extractToolUse(response.output as ConverseOutput | undefined, opts.tool.name);
	}
}
