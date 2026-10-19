import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { countData } from '$lib/types';

const CACHE_SECONDS = 12 * 60 * 60;

export const GET: RequestHandler = async ({ request, platform }) => {
	if (!platform) {
		return json({ error: 'This message should not be shown. code: CT01' }, { status: 500 });
	}

	// Totals come from the stats counters maintained by insertLog, so this stays cheap on a cache miss
	const cache =
		typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;
	const cacheKey = new Request(new URL(request.url).origin + '/api/count', { method: 'GET' });
	const cached = await cache?.match(cacheKey);
	if (cached) return cached;

	const [counters, projects] = await platform.env.DB.batch<Record<string, unknown>>([
		platform.env.DB.prepare('SELECT key, value FROM stats'),
		platform.env.DB.prepare('SELECT COUNT(*) AS project_count FROM projects')
	]);
	const stats = Object.fromEntries(counters.results.map((row) => [row.key, row.value]));

	const data: countData = {
		total_time_ms: stats.total_time_ms as number,
		uid_count: stats.uid_count as number,
		project_count: projects.results[0]?.project_count as number,
		build_count: stats.build_count as number
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
