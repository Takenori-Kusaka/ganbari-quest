// src/lib/server/ai/gemini-provider.ts
// Gemini 実装 (#987)
//
// NUC 環境では Gemini API を使用する。
// `GEMINI_API_KEY` 環境変数が設定されている場合に利用可能。

import { GoogleGenerativeAI } from '@google/generative-ai';
import { isProviderLatchedUnavailable, withAvailabilityTracking } from './availability';
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

	/**
	 * Gemini を呼んでよいかを申告する。
	 *
	 * ## この戻り値が保証すること / しないこと (#4366)
	 *
	 * - **`false` は確定**: API キーが配られていない (またはプレースホルダのまま) か、直前の
	 *   呼び出しがキー不正・権限拒否で落ちている。
	 * - **`true` は「キーが配られている」までしか保証しない**。そのキーが有効か・課金が有効かは
	 *   呼ぶまで確定しないため、ここでは判定できない。
	 *
	 * キーの実在を見る判定 (#987 以来の挙動) はそのまま維持し、latch 参照だけを足している。
	 */
	isAvailable(): boolean {
		if (getClient() === null) return false;
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
		if (!client) {
			throw new Error('Gemini API key is not configured');
		}

		const model = client.getGenerativeModel({ model: MODEL_ID });
		const jsonInstruction = buildJsonInstruction(opts.tool);
		const prompt = `${opts.system}\n\n${jsonInstruction}\n\n${opts.userMessage}`;

		// 包む範囲は「使える結果を得るまで」(#4726)。JSON パース失敗もサービス層は fallback に
		// 落ちるため、外に出すと fallback 率が実態より小さく出る。
		return await withAvailabilityTracking(this.name, async () => {
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
		});
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

		// 包む範囲は「使える結果を得るまで」(#4726)。JSON パース失敗もサービス層は fallback に
		// 落ちるため、外に出すと fallback 率が実態より小さく出る。
		return await withAvailabilityTracking(this.name, async () => {
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
		});
	}
}
