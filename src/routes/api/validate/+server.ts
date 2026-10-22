import { getHash } from '$lib/utils';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ request, platform }) => {
	const secretKey = request.headers.get('Authorization')?.replace(/^Bearer\s+/, '');
	if (!secretKey) {
		return new Response('Unauthorized', { status: 401 });
	}

	const secretKeyHash = await getHash(secretKey, platform.env.pepper);
	const project = await platform.env.DB.prepare(
		'SELECT project_id FROM projects WHERE secret_key_hash = ?'
	)
		.bind(secretKeyHash)
		.all<{ project_id: string }>();

	if (project.results.length === 0) {
		return new Response('Unauthorized', { status: 401 });
	}

	return Response.json({ project_id: project.results[0].project_id });
};
