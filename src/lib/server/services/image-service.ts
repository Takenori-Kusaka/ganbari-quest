// src/lib/server/services/image-service.ts
// Gemini API を使ったキャラクター画像生成サービス

import { createHash } from 'node:crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
	findCachedImage,
	findChildForImage,
	insertCharacterImage,
	updateChildAvatarUrl,
} from '$lib/server/db/image-repo';
import { logger } from '$lib/server/logger';
import { fileExists, saveFile } from '$lib/server/storage';
import { generatedImageKey, storageKeyToPublicUrl } from '$lib/server/storage-keys';
import { buildAvatarPrompt, buildFaviconPrompt } from './image-prompt';

function getGeminiClient(): GoogleGenerativeAI | null {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey || apiKey === 'your_gemini_api_key_here') {
		return null;
	}
	return new GoogleGenerativeAI(apiKey);
}

function hashPrompt(prompt: string): string {
	return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/** Gemini API で画像を生成し、バイナリデータを返す */
async function generateImageWithGemini(prompt: string): Promise<Buffer | null> {
	const client = getGeminiClient();
	if (!client) return null;

	try {
		const model = client.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
		const response = await model.generateContent({
			contents: [{ role: 'user', parts: [{ text: prompt }] }],
			generationConfig: {
				responseModalities: ['TEXT', 'IMAGE'] as unknown as undefined,
			} as Record<string, unknown>,
		});

		const candidate = response.response.candidates?.[0];
		if (!candidate?.content?.parts) return null;

		for (const part of candidate.content.parts) {
			const inlineData = (part as { inlineData?: { mimeType: string; data: string } }).inlineData;
			if (inlineData?.data) {
				return Buffer.from(inlineData.data, 'base64');
			}
		}
		return null;
	} catch (err) {
		logger.error('[image-service] Gemini API error', {
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		});
		return null;
	}
}

/** フォールバック SVG アバターを生成 */
function generateFallbackAvatar(nickname: string, theme: string): Buffer {
	const colors: Record<string, { bg: string; fg: string }> = {
		pink: { bg: '#fce4ec', fg: '#e91e63' },
		blue: { bg: '#e3f2fd', fg: '#1976d2' },
		green: { bg: '#e8f5e9', fg: '#388e3c' },
		purple: { bg: '#f3e5f5', fg: '#7b1fa2' },
		orange: { bg: '#fff3e0', fg: '#f57c00' },
	};
	const { bg, fg } = colors[theme] ?? (colors.pink as { bg: string; fg: string });
	const initial = nickname.charAt(0);

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <circle cx="128" cy="128" r="128" fill="${bg}"/>
  <circle cx="128" cy="100" r="50" fill="${fg}" opacity="0.2"/>
  <text x="128" y="140" font-size="80" font-family="sans-serif" font-weight="bold" fill="${fg}" text-anchor="middle" dominant-baseline="central">${initial}</text>
  <circle cx="128" cy="128" r="124" fill="none" stroke="${fg}" stroke-width="4" opacity="0.3"/>
</svg>`;

	return Buffer.from(svg, 'utf-8');
}

export interface GenerateAvatarResult {
	filePath: string;
	isGenerated: boolean;
}

/** 子供のアバター画像を生成（またはキャッシュから取得） */
export async function generateAvatar(
	childId: number,
	statusInfo: {
		characterType: string;
		level: number;
	},
	tenantId: string,
): Promise<GenerateAvatarResult | { error: string }> {
	const child = await findChildForImage(childId, tenantId);
	if (!child) return { error: 'NOT_FOUND' };

	const prompt = buildAvatarPrompt({
		nickname: child.nickname,
		age: child.age,
		theme: child.theme,
		characterType: statusInfo.characterType,
		level: statusInfo.level,
	});
	const promptHash = hashPrompt(prompt);

	// Check cache
	const cached = await findCachedImage(childId, 'avatar', promptHash, tenantId);

	if (cached && (await fileExists(cached.filePath))) {
		return { filePath: storageKeyToPublicUrl(cached.filePath), isGenerated: true };
	}

	// Generate image
	const imageData = await generateImageWithGemini(prompt);
	let filePath: string;
	let isGenerated: boolean;

	if (imageData) {
		filePath = generatedImageKey(tenantId, childId, promptHash, 'png');
		await saveFile(filePath, imageData, 'image/png');
		isGenerated = true;
	} else {
		// Fallback SVG
		filePath = generatedImageKey(tenantId, childId, promptHash, 'svg');
		const fallback = generateFallbackAvatar(child.nickname, child.theme);
		await saveFile(filePath, fallback, 'image/svg+xml');
		isGenerated = false;
	}

	// Save to DB
	await insertCharacterImage({ childId, type: 'avatar', filePath, promptHash }, tenantId);

	// Update child avatarUrl
	const publicUrl = storageKeyToPublicUrl(filePath);
	await updateChildAvatarUrl(childId, publicUrl, tenantId);

	return { filePath: publicUrl, isGenerated };
}

/** 子供の現在のアバターURLを取得（未生成ならnull） */
export async function getAvatarUrl(childId: number, tenantId: string): Promise<string | null> {
	const child = await findChildForImage(childId, tenantId);
	return child?.avatarUrl ?? null;
}

/** favicon を生成（またはキャッシュから取得） */
export async function generateFavicon(_tenantId: string): Promise<{
	filePath: string;
	isGenerated: boolean;
}> {
	// Check if already generated
	if (await fileExists('generated/favicon.png')) {
		return { filePath: '/generated/favicon.png', isGenerated: true };
	}
	if (await fileExists('icon-character.png')) {
		return { filePath: '/icon-character.png', isGenerated: false };
	}

	const prompt = buildFaviconPrompt();
	const imageData = await generateImageWithGemini(prompt);

	if (imageData) {
		await saveFile('generated/favicon.png', imageData, 'image/png');
		return { filePath: '/generated/favicon.png', isGenerated: true };
	}

	// Fallback: use static icon-character.png
	return { filePath: '/icon-character.png', isGenerated: false };
}

/** favicon の現在パスを取得 */
export async function getFaviconPath(_tenantId: string): Promise<string> {
	if (await fileExists('generated/favicon.png')) return '/generated/favicon.png';
	if (await fileExists('icon-character.png')) return '/icon-character.png';
	return '';
}
