export function parseFirestoreTimestamp(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'object') {
    const record = value as {
      toDate?: () => Date;
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
    };

    if (typeof record.toDate === 'function') {
      const d = record.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }

    const secs =
      typeof record.seconds === 'number'
        ? record.seconds
        : typeof record._seconds === 'number'
        ? record._seconds
        : null;

    if (secs !== null) {
      const nanos =
        typeof record.nanoseconds === 'number'
          ? record.nanoseconds
          : typeof record._nanoseconds === 'number'
          ? record._nanoseconds
          : 0;
      const d = new Date(secs * 1000 + Math.floor(nanos / 1_000_000));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }

  return null;
}

export function getTimestampMillis(value: unknown): number {
  const d = parseFirestoreTimestamp(value);
  return d ? d.getTime() : 0;
}

export function formatDateTimeCompact(value: unknown): string {
  const d = parseFirestoreTimestamp(value);
  if (!d) return 'Pending timestamp';

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function formatTimestampHuman(value: unknown): string {
  const d = parseFirestoreTimestamp(value);
  if (!d) return 'Awaiting server sync';

  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
