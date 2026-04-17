// src/lib/server/ai/gemini-provider.ts
// Gemini 実装 (#987)
//
// NUC 環境では Gemini API を使用する。
// `GEMINI_API_KEY` 環境変数が設定されている場合に利用可能。

import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AiProvider, ToolDefinition, ToolUseResult } from './provider';

const MODEL_ID = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here') {
		return null;
	}
	if (!_client) {
		_client = new GoogleGenerativeAI(apiKey);
	}
	return _client;
}

/** JSON をレスポンステキストから安全に抽出する */
function extractJson(text: string): unknown {
	// ```json ... ``` ブロックを優先
	const codeBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
	if (codeBlock?.[1]) {
		return JSON.parse(codeBlock[1]);
	}

	// 生のJSONオブジェクトを探す
	const start = text.indexOf('{');
	if (start === -1) return null;
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		if (text[i] === '{') depth++;
		else if (text[i] === '}') {
			depth--;
			if (depth === 0) {
				return JSON.parse(text.slice(start, i + 1));
			}
		}
	}
	return null;
}

/**
 * tool の inputSchema から JSON 出力指示プロンプトを構築する。
 * Gemini は Bedrock の tool_use と異なり、JSON レスポンスをパースして擬似的に tool_use を再現する。
 */
function buildJsonInstruction(tool: ToolDefinition): string {
	const schema = tool.inputSchema;
	const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
	const required = (schema.required ?? []) as string[];

	const fields = Object.entries(props)
		.map(([key, def]) => {
			const desc = def.description ? ` — ${def.description}` : '';
			const req = required.includes(key) ? ' (必須)' : ' (任意)';
			return `  "${key}"${req}${desc}`;
		})
		.join('\n');

	return `以下のJSON形式のみで回答してください（説明不要）:\n{\n${fields}\n}`;
}

export class GeminiProvider implements AiProvider {
	readonly name = 'gemini';

	isAvailable(): boolean {
		return getClient() !== null;
	}

	async converseWithTool(opts: {
		system: string;
		userMessage: string;
		tool: ToolDefinition;
		maxTokens?: number;
	}): Promise<ToolUseResult> {
		const client = getClient();
		if (!client) {
			throw new Error('Gemini API key is not configured');
		}

		const model = client.getGenerativeModel({ model: MODEL_ID });
		const jsonInstruction = buildJsonInstruction(opts.tool);
		const prompt = `${opts.system}\n\n${jsonInstruction}\n\n${opts.userMessage}`;

		const result = await model.generateContent(prompt);
		const responseText = result.response.text();
		const parsed = extractJson(responseText);

		if (!parsed || typeof parsed !== 'object') {
			throw new Error('No valid JSON in Gemini response');
		}

		return {
			toolName: opts.tool.name,
			input: parsed as Record<string, unknown>,
		};
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
		if (!client) {
			throw new Error('Gemini API key is not configured');
		}

		const model = client.getGenerativeModel({ model: MODEL_ID });
		const jsonInstruction = buildJsonInstruction(opts.tool);
		const prompt = `${opts.system}\n\n${jsonInstruction}\n\n${opts.userText}`;

		const result = await model.generateContent([
			prompt,
			{
				inlineData: {
					mimeType: opts.imageMimeType,
					data: opts.imageBase64,
				},
			},
		]);
		const responseText = result.response.text();
		const parsed = extractJson(responseText);

		if (!parsed || typeof parsed !== 'object') {
			throw new Error('No valid JSON in Gemini image response');
		}

		return {
			toolName: opts.tool.name,
			input: parsed as Record<string, unknown>,
		};
	}
}
