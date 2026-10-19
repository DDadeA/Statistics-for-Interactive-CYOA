import { getHash } from '$lib/utils';
import { insertLog } from '$lib/server/logs';
import type { RequestHandler } from '@sveltejs/kit';

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('Origin');

	return new Response(null, {
		headers: {
			'Access-Control-Allow-Origin': origin || '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS', // GET 허용 확인
			'Access-Control-Allow-Headers': 'Content-Type',
			'Access-Control-Allow-Credentials': 'true',
			Vary: 'Origin'
		}
	});
};

export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	const origin = request.headers.get('Origin');
	const corsHeaders = {
		'Access-Control-Allow-Origin': origin || '*',
		'Access-Control-Allow-Credentials': 'true',
		Vary: 'Origin',
		'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
		Pragma: 'no-cache',
		Expires: '0'
	};

	try {
		const userIP = request.headers.get('cf-connecting-ip');
		if (!userIP) {
			return new Response('Unable to determine user IP', { status: 400, headers: corsHeaders });
		}
		const userIPHash = await getHash(String(userIP), platform.env.pepper);

		const url = new URL(request.url);
		const projectId = url.searchParams.get('projectId');
		const rawDataString = url.searchParams.get('data');

		// [Validation 1]
		if (!projectId || !rawDataString) {
			return new Response('Bad Request: Missing projectId or data', {
				status: 400,
				headers: corsHeaders
			});
		}

		// [Validation 2] 용량 체크
		const MAX_SIZE_BYTES = 200 * 1024;
		if (rawDataString.length > MAX_SIZE_BYTES) {
			return new Response('Payload too large', { status: 413, headers: corsHeaders });
		}
		let payload;
		try {
			payload = JSON.parse(rawDataString);
		} catch (e) {
			return new Response('Invalid JSON format', { status: 400, headers: corsHeaders });
		}

		const requiredFields = ['eventType', 'timestamp', 'currentURL'];
		const missingFields = requiredFields.filter((field) => !payload[field]);

		if (missingFields.length > 0) {
			return new Response(`Missing required fields: ${missingFields.join(', ')}`, {
				status: 400,
				headers: corsHeaders
			});
		}

		await insertLog(platform.env.DB, {
			projectId,
			uid: userIPHash,
			eventType: payload.eventType,
			currentUrl: payload.currentURL,
			referrer: payload.referrer || null,
			timeOnPage: Number(payload.timeOnPage) || 0,
			eventTimestamp: payload.timestamp,
			data: rawDataString,
			dataHash: await getHash(rawDataString, platform.env.pepper)
		});

		return new Response('Log entry created', { status: 201, headers: corsHeaders });
	} catch (error) {
		return new Response(String(error), { status: 500, headers: corsHeaders });
	}
}
