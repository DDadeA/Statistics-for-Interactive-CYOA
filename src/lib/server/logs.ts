import { query } from '$lib/utils';

export const MAX_PAGE_SIZE = 1000;

export interface LogPageParams {
	limit: number;
	cursor: number | null;
}

export interface LogPage {
	results: Record<string, unknown>[];
	hasMore: boolean;
	nextCursor: string | null;
}

/** Returns parsed pagination params, or null when the cursor is invalid. */
export function parseLogPageParams(searchParams: URLSearchParams): LogPageParams | null {
	const requestedLimit = Number(searchParams.get('limit') ?? MAX_PAGE_SIZE);
	const limit = Number.isInteger(requestedLimit)
		? Math.min(Math.max(requestedLimit, 1), MAX_PAGE_SIZE)
		: MAX_PAGE_SIZE;

	const rawCursor = searchParams.get('cursor');
	if (rawCursor === null) return { limit, cursor: null };
	if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(Number(rawCursor))) return null;
	return { limit, cursor: Number(rawCursor) };
}

/** Reads one page of a project's logs, newest first, paginated by primary key. */
export async function fetchLogPage(
	platform: App.Platform,
	projectId: string,
	{ limit, cursor }: LogPageParams
): Promise<LogPage> {
	const result =
		cursor === null
			? await query(platform, 'SELECT * FROM logs WHERE project_id = ? ORDER BY id DESC LIMIT ?', [
					projectId,
					limit + 1
				])
			: await query(
					platform,
					'SELECT * FROM logs WHERE project_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
					[projectId, cursor, limit + 1]
				);

	const hasMore = result.results.length > limit;
	const results = result.results.slice(0, limit);
	const lastEntry = results[results.length - 1];

	return {
		results,
		hasMore,
		nextCursor: hasMore && lastEntry ? String(lastEntry.id) : null
	};
}

/** Runs fetchLogPage and converts D1 failures into a readable 503 JSON response. */
export async function logPageResponse(
	platform: App.Platform,
	projectId: string,
	params: LogPageParams
): Promise<Response> {
	try {
		return Response.json(await fetchLogPage(platform, projectId, params));
	} catch (error) {
		console.error('Failed to read logs page:', error);
		return Response.json(
			{ error: error instanceof Error ? error.message : 'Failed to read logs' },
			{ status: 503 }
		);
	}
}
