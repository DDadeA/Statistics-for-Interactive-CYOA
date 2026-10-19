import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { countData } from '$lib/types';

const CACHE_SECONDS = 12 * 60 * 60;

export const GET: RequestHandler = async ({ request, platform }) => {
	if (!platform) {
		return json({ error: 'This message should not be shown. code: CT01' }, { status: 500 });
	}

	// These totals scan the whole logs table, so serve them from the edge cache when possible
	const cache =
		typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
	const cacheKey = new Request(new URL(request.url).origin + '/api/count', { method: 'GET' });
	const cached = await cache?.match(cacheKey);
	if (cached) return cached;

	const result = await platform.env.DB.prepare(
		`SELECT 
    (SELECT SUM(time_on_page) FROM logs) AS total_time_ms,
    (SELECT COUNT(DISTINCT uid) FROM logs) AS uid_count,
    (SELECT COUNT(*) FROM projects) AS project_count,
	(SELECT COUNT(distinct data_hash) FROM logs) AS build_count;`
	).all();

	const data: countData = {
		total_time_ms: result.results[0]?.total_time_ms as number,
		uid_count: result.results[0]?.uid_count as number,
		project_count: result.results[0]?.project_count as number,
		build_count: result.results[0]?.build_count as number
	};

	const response = json(data, {
		status: 200,
		headers: {
			'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
			'Content-Type': 'application/json'
		}
	});

	if (cache) {
		const store = cache
			.put(cacheKey, response.clone())
			.catch((error) => console.error('Cache put failed', error));
		platform.context?.waitUntil?.(store);
	}

	return response;
};
