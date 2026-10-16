import { query } from '$lib/utils';
import { json } from '@sveltejs/kit';
import { logPageResponse, parseLogPageParams } from '$lib/server/logs';

// Access is restricted by Cloudflare Access on /admin/*, so no secret key is needed here.
export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	const searchParams = new URL(request.url).searchParams;
	const project_id = searchParams.get('project_id');

	if (!project_id) {
		// Recent activity across all projects (project_id, created_at only)
		const requestedLimit = Number(searchParams.get('limit') ?? 5000);
		const limit = Number.isInteger(requestedLimit)
			? Math.min(Math.max(requestedLimit, 1), 10000)
			: 5000;
		const result = await query(
			platform,
			'SELECT project_id, created_at FROM logs ORDER BY id DESC LIMIT ?',
			[limit]
		);
		return json(result);
	}

	const pageParams = parseLogPageParams(searchParams);
	if (!pageParams) {
		return new Response('Bad Request: Invalid cursor', { status: 400 });
	}

	return logPageResponse(platform, project_id, pageParams);
}
