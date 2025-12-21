import { query, getHash } from '$lib/utils';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

export const OPTIONS: RequestHandler = async ({ request }) => {
	const origin = request.headers.get('Origin');

	return new Response(null, {
		headers: {
			'Access-Control-Allow-Origin': origin || '*',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			'Access-Control-Allow-Credentials': 'true',
			Vary: 'Origin'
		}
	});
};

// Get
export async function GET({ request, platform }: { request: Request; platform: App.Platform }) {
	// Get logs from D1
	// Get project_id from secret hash

	const secret_key = request.headers.get('Authorization')?.replace('Bearer ', '');
	if (!secret_key) {
		return new Response('Unauthorized', { status: 401 });
	}

	const urlParams = new URL(request.url).searchParams;

	const secret_key_hash = await getHash(secret_key, platform.env.pepper);

	// Get project_id from projects table
	let project = await query(platform, 'SELECT project_id FROM projects WHERE secret_key_hash = ?', [
		secret_key_hash
	]);
	if (project.results.length === 0) {
		// Invalid secret key
		return new Response('Unauthorized', { status: 401 });
	}

	const project_id = project.results[0].project_id;

	let result = await query(platform, 'SELECT * FROM logs WHERE project_id = ?', [project_id]);

	return json(result);
}

// Post - no authentication
export async function POST({ request, platform }: { request: Request; platform: App.Platform }) {
	const origin = request.headers.get('Origin');
	const corsHeaders = {
		'Access-Control-Allow-Origin': origin || '*',
		'Access-Control-Allow-Credentials': 'true',
		Vary: 'Origin'
	};

	try {
		// Get user IP //
		const userIP = request.headers.get('cf-connecting-ip');
		if (!userIP) {
			return new Response('Unable to determine user IP', { status: 400, headers: corsHeaders });
		}
		const userIPHash = await getHash(String(userIP), platform.env.pepper);

		// Get Data //
		const body = await request.json();

		// -- // Validate body
		if (!body.projectId || !body.data) {
			return new Response('Bad Request', { status: 400, headers: corsHeaders });
		}

		// -- // Data validation
		// [Validation 1] 입력값 정규화 및 파싱 확인
		let payload;
		let rawDataString;

		if (typeof body.data === 'string') {
			rawDataString = body.data;
			try {
				payload = JSON.parse(rawDataString);
			} catch (e) {
				return new Response('Invalid JSON format', { status: 400, headers: corsHeaders });
			}
		} else if (typeof body.data === 'object' && body.data !== null) {
			payload = body.data;
			rawDataString = JSON.stringify(payload);
		} else {
			return new Response('Invalid data type', { status: 400, headers: corsHeaders });
		}

		// [Validation 2] 용량 체크
		const MAX_SIZE_BYTES = 200 * 1024;
		if (rawDataString.length > MAX_SIZE_BYTES) {
			return new Response('Payload too large (Limit: 200KB)', {
				status: 413,
				headers: corsHeaders
			});
		}

		// [Validation 3] 필수 필드 체크
		const requiredFields = ['eventType', 'timestamp', 'currentURL'];
		const missingFields = requiredFields.filter((field) => !payload[field]);

		if (missingFields.length > 0) {
			return new Response(`Missing required fields: ${missingFields.join(', ')}`, {
				status: 400,
				headers: corsHeaders
			});
		}

		// ---------------------------------------------------------
		// [DB Insert] 검증 통과 후 실행
		// ---------------------------------------------------------

		let result = await query(
			platform,
			`INSERT OR IGNORE INTO logs (
				project_id, 
				uid, 
				event_type, 
				current_url, 
				referrer, 
				time_on_page, 
				event_timestamp, 
				data, 
				data_hash, 
				created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				body.projectId,
				userIPHash,
				payload.eventType, // 위에서 검증된 payload 사용
				payload.currentURL,
				payload.referrer || null, // referrer는 없을 수도 있으니 null 처리
				payload.timeOnPage || 0, // 없으면 0 처리
				payload.timestamp,
				rawDataString, // 문자열로 변환된 원본 데이터
				await getHash(rawDataString, platform.env.pepper), // 해시 생성
				new Date().toISOString()
			]
		);

		return new Response('Log entry created', { status: 201, headers: corsHeaders });
	} catch (error) {
		return new Response(String(error), { status: 500, headers: corsHeaders });
	}
}
