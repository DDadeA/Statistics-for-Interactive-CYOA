export const MAX_PAGE_SIZE = 1000;

export interface LogRow {
	projectId: string;
	uid: string;
	eventType: string;
	currentUrl: string;
	referrer: string | null;
	timeOnPage: number;
	eventTimestamp: string;
	data: string;
	dataHash: string;
}

/**
 * Inserts a log and updates the /api/count counters in one atomic batch.
 * changes() reports whether the preceding INSERT OR IGNORE added a new uid / data_hash.
 */
export async function insertLog(DB: App.Platform['env']['DB'], row: LogRow) {
	return DB.batch([
		DB.prepare(
			`INSERT INTO logs (
				project_id, uid, event_type, current_url, referrer,
				time_on_page, event_timestamp, data, data_hash, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).bind(
			row.projectId,
			row.uid,
			row.eventType,
			row.currentUrl,
			row.referrer,
			row.timeOnPage,
			row.eventTimestamp,
			row.data,
			row.dataHash,
			new Date().toISOString()
		),
		DB.prepare(`UPDATE stats SET value = value + ? WHERE key = 'total_time_ms'`).bind(
			row.timeOnPage
		),
		DB.prepare(`INSERT OR IGNORE INTO seen_uids (uid) VALUES (?)`).bind(row.uid),
		DB.prepare(`UPDATE stats SET value = value + changes() WHERE key = 'uid_count'`),
		DB.prepare(`INSERT OR IGNORE INTO seen_hashes (data_hash) VALUES (?)`).bind(row.dataHash),
		DB.prepare(`UPDATE stats SET value = value + changes() WHERE key = 'build_count'`)
	]);
}

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
	const DB = platform.env.DB;
	const result =
		cursor === null
			? await DB.prepare('SELECT * FROM logs WHERE project_id = ? ORDER BY id DESC LIMIT ?')
					.bind(projectId, limit + 1)
					.all()
			: await DB.prepare(
					'SELECT * FROM logs WHERE project_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
				)
					.bind(projectId, cursor, limit + 1)
					.all();

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
