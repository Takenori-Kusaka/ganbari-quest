import {
	deleteChild,
	findAllChildren,
	findChildById,
	insertChild,
	updateChild,
} from '$lib/server/db/child-repo';

export async function getAllChildren(tenantId: string) {
	return await findAllChildren(tenantId);
}

export async function getChildById(id: number, tenantId: string) {
	return await findChildById(id, tenantId);
}

export async function addChild(
	input: {
		nickname: string;
		age: number;
		theme?: string;
		uiMode?: string;
	},
	tenantId: string,
) {
	return await insertChild(input, tenantId);
}

export async function editChild(
	id: number,
	input: { nickname?: string; age?: number; theme?: string; uiMode?: string },
	tenantId: string,
) {
	return await updateChild(id, input, tenantId);
}

export async function removeChild(id: number, tenantId: string) {
	return await deleteChild(id, tenantId);
}
