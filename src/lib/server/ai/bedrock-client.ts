// src/lib/server/ai/bedrock-client.ts
// AWS Bedrock Claude Haiku クライアント共通モジュール (#721)

import {
	BedrockRuntimeClient,
	type ContentBlock,
	type ConversationRole,
	ConverseCommand,
	type Message,
	type SystemContentBlock,
	type Tool,
} from '@aws-sdk/client-bedrock-runtime';

/** Bedrock で使用する Claude モデル ID */
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
	if (!_client) {
		const region = process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
		_client = new BedrockRuntimeClient({ region });
	}
	return _client;
}

/** Bedrock が利用可能かを判定（Lambda 上なら IAM 認証で自動利用可能） */
export function isBedrockAvailable(): boolean {
	// Lambda 上では IAM ロールで認証されるため、API キー不要
	// ローカル開発では AWS credentials が設定されている場合のみ利用可能
	// BEDROCK_DISABLED=true で明示的に無効化可能
	if (process.env.BEDROCK_DISABLED === 'true') return false;
	return true;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface BedrockToolUseResult {
	toolName: string;
	input: Record<string, unknown>;
}

/**
 * Bedrock Converse API でテキスト推定を実行（tool_use で構造化出力を取得）
 */
export async function converseWithTool(opts: {
	system: string;
	userMessage: string;
	tool: ToolDefinition;
	maxTokens?: number;
}): Promise<BedrockToolUseResult> {
	const client = getClient();

	const systemContent: SystemContentBlock[] = [{ text: opts.system }];

	const messages: Message[] = [
		{
			role: 'user' as ConversationRole,
			content: [{ text: opts.userMessage }] as ContentBlock[],
		},
	];

	const tools: Tool[] = [
		{
			toolSpec: {
				name: opts.tool.name,
				description: opts.tool.description,
				// biome-ignore lint/suspicious/noExplicitAny: Bedrock SDK の DocumentType は再帰型で Record<string,unknown> と非互換
				inputSchema: { json: opts.tool.inputSchema } as any,
			},
		},
	];

	const command = new ConverseCommand({
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
	});

	const response = await client.send(command);

	// tool_use レスポンスを抽出
	const output = response.output;
	if (output?.message?.content) {
		for (const block of output.message.content) {
			if (block.toolUse) {
				return {
					toolName: block.toolUse.name ?? opts.tool.name,
					input: (block.toolUse.input as Record<string, unknown>) ?? {},
				};
			}
		}
	}

	throw new Error('No tool_use block in Bedrock response');
}

/**
 * Bedrock Converse API で画像入力付きテキスト推定を実行（tool_use で構造化出力）
 */
export async function converseWithImageAndTool(opts: {
	system: string;
	userText: string;
	imageBase64: string;
	imageMimeType: string;
	tool: ToolDefinition;
	maxTokens?: number;
}): Promise<BedrockToolUseResult> {
	const client = getClient();

	const systemContent: SystemContentBlock[] = [{ text: opts.system }];

	// Bedrock の image format は "png" | "jpeg" | "gif" | "webp"
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

	const tools: Tool[] = [
		{
			toolSpec: {
				name: opts.tool.name,
				description: opts.tool.description,
				// biome-ignore lint/suspicious/noExplicitAny: Bedrock SDK の DocumentType は再帰型で Record<string,unknown> と非互換
				inputSchema: { json: opts.tool.inputSchema } as any,
			},
		},
	];

	const command = new ConverseCommand({
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
	});

	const response = await client.send(command);

	const output = response.output;
	if (output?.message?.content) {
		for (const block of output.message.content) {
			if (block.toolUse) {
				return {
					toolName: block.toolUse.name ?? opts.tool.name,
					input: (block.toolUse.input as Record<string, unknown>) ?? {},
				};
			}
		}
	}

	throw new Error('No tool_use block in Bedrock image response');
}
