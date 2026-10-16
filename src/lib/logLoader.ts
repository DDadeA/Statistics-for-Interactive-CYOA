import type { LogEntry } from '$lib/types';

export const LOG_PAGE_SIZE = 500;

export interface LogPageResponse {
	results: LogEntry[];
	hasMore: boolean;
	nextCursor: string | null;
}

export interface LoadLogsOptions {
	endpoint: string;
	headers?: HeadersInit;
	params?: Record<string, string>;
	pageSize?: number;
	/** Called with each raw page; the returned entries are collected. */
	onPage?: (entries: LogEntry[]) => Promise<LogEntry[]> | LogEntry[];
	onProgress?: (loaded: number, pageNumber: number) => void;
	/** Maps HTTP failures to user-facing messages. */
	errorMessages: {
		unauthorized: string;
		failed: string;
		invalidResponse: string;
		missingCursor: string;
	};
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 4) {
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await fetch(url, init);
			const retryable = response.status >= 500 || response.status === 429;
			if (!retryable || attempt >= attempts) return response;
		} catch (error) {
			if (attempt >= attempts) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
	}
}

/** Walks the cursor-paginated log API and returns every entry (newest first). */
export async function loadAllLogs(options: LoadLogsOptions): Promise<LogEntry[]> {
	const { endpoint, headers, params, onPage, onProgress, errorMessages } = options;
	const pageSize = options.pageSize ?? LOG_PAGE_SIZE;
	const entries: LogEntry[] = [];
	let cursor: string | null = null;
	let pageNumber = 0;

	while (true) {
		const query = new URLSearchParams({ ...params, limit: String(pageSize) });
		if (cursor) query.set('cursor', cursor);

		const response = await fetchWithRetry(`${endpoint}?${query}`, { headers });
		if (!response.ok) {
			throw new Error(
				response.status === 401
					? errorMessages.unauthorized
					: `${errorMessages.failed} (HTTP ${response.status}).`
			);
		}

		const page = (await response.json()) as LogPageResponse;
		if (!Array.isArray(page.results) || typeof page.hasMore !== 'boolean') {
			throw new Error(errorMessages.invalidResponse);
		}
		if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) {
			throw new Error(errorMessages.missingCursor);
		}

		entries.push(...(onPage ? await onPage(page.results) : page.results));
		cursor = page.nextCursor;
		pageNumber++;
		onProgress?.(entries.length, pageNumber);

		if (!page.hasMore) return entries;
	}
}
