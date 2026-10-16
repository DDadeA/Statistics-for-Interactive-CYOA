import { logPageResponse, parseLogPageParams } from '$lib/server/logs';

// Access is restricted by Cloudflare Access on /admin/*, so no secret key is needed here.
export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	const searchParams = new URL(request.url).searchParams;
	const project_id = searchParams.get('project_id');

	if (!project_id) {
		return new Response('Bad Request: project_id is required', { status: 400 });
	}

	const pageParams = parseLogPageParams(searchParams);
	if (!pageParams) {
		return new Response('Bad Request: Invalid cursor', { status: 400 });
	}

	return logPageResponse(platform, project_id, pageParams);
}
