import { query } from '$lib/utils';

export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Return COUNT(*) from all logs
	const result = await query(platform, 'SELECT COUNT(*) FROM logs');

	const count = result.results[0]?.['COUNT(*)'] || 0;
	return new Response(JSON.stringify({ count }), {
		status: 200,
		headers: {
			'Cache-Control': 'public, max-age=600',
			'Content-Type': 'application/json'
		}
	});
}
