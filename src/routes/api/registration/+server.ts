import type { RequestHandler } from '@sveltejs/kit';

export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	let result = await platform.env.DB.prepare('SELECT * FROM users LIMIT 5').run();
	return new Response(JSON.stringify(result));
}
