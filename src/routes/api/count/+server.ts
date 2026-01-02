import { query } from '$lib/utils';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { countData } from '$lib/types';

export const GET: RequestHandler = async ({ request, platform }) => {
	if (!platform) {
		return json({ error: 'This message should not be shown. code: CT01' }, { status: 500 });
	}

	const result = await query(
		platform,
		`SELECT 
    (SELECT SUM(time_on_page) FROM logs) AS total_time_ms,
    (SELECT COUNT(DISTINCT uid) FROM logs) AS uid_count,
    (SELECT COUNT(*) FROM projects) AS project_count,
	(SELECT COUNT(distinct data_hash) FROM logs) AS build_count;`
	);

	const data: countData = {
		total_time_ms: result.results[0]?.total_time_ms as number,
		uid_count: result.results[0]?.uid_count as number,
		project_count: result.results[0]?.project_count as number,
		build_count: result.results[0]?.build_count as number
	};

	return json(data, {
		status: 200,
		headers: {
			'Cache-Control': 'public, max-age=600',
			'Content-Type': 'application/json'
		}
	});
};
