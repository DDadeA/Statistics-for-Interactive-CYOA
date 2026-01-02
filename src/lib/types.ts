interface LogEntry {
	project_id: string;
	uid: string;
	event_type: string;
	current_url: string;
	referrer: string;
	time_on_page: number;
	event_timestamp: string;
	data: any | null;
	data_hash: string;
	created_at: string;

	parsedData?: any; // processed version of data
	timestamp?: number; // Optional field for numeric timestamp
}

interface correlationObject {
	idA: string;
	idB: string;
	count: number;
	percent: number;
	probA: number;
	probB: number;
	lift: number;
}

interface Word {
	id: string;
	replaceText: string;
}

export type { LogEntry, correlationObject, Word };
