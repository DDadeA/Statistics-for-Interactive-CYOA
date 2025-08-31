import type { RequestHandler } from '@sveltejs/kit';

export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	let result = await query(platform, 'SELECT * FROM users LIMIT 5');

	return new Response(JSON.stringify(result));
}

const query = async (platform: App.Platform, query: string, params?: any[]) => {
	// @ts-ignore
	const DB = platform.env.DB;
	const statement = DB.prepare(query).bind(...(params || []));
	const result = await statement.all();

	return result;
};
