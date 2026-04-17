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
import type { AiProvider, ToolDefinition, ToolUseResult } from './provider';

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

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

	isAvailable(): boolean {
		if (process.env.BEDROCK_DISABLED === 'true') return false;
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

		const response = await client.send(
			new ConverseCommand({
				modelId: MODEL_ID,
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

		const response = await client.send(
			new ConverseCommand({
				modelId: MODEL_ID,
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
		);

		return extractToolUse(response.output as ConverseOutput | undefined, opts.tool.name);
	}
}
