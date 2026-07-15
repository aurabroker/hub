export const EMPLOYMENT_LABELS: Record<string, string> = {
	b2b: 'B2B / JDG',
	uop: 'Umowa o pracę',
	uz: 'Umowa zlecenie',
	ud: 'Umowa o dzieło'
};

export function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

export function dayKey(iso: string | Date): string {
	const d = typeof iso === 'string' ? new Date(iso) : iso;
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey(): string {
	return dayKey(new Date());
}

export function isSameDay(iso: string, other: string): boolean {
	return dayKey(iso) === other;
}

export function fmtDateTime(iso: string): string {
	return new Date(iso).toLocaleString('pl-PL', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

export function fmtDate(iso: string): string {
	return new Date(iso).toLocaleDateString('pl-PL', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
}

export function dayLabel(key: string): string {
	const nice = new Date(key + 'T00:00:00').toLocaleDateString('pl-PL', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
	const today = todayKey();
	if (key === today) return 'Dziś — ' + nice;
	const yKey = dayKey(new Date(Date.now() - 864e5));
	if (key === yKey) return 'Wczoraj — ' + nice;
	return nice;
}
