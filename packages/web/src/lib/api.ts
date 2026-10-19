import type {
  PlayerDetail,
  PlayerSummary,
  TodayResponse,
} from '@sahlykanta/shared';

/**
 * The SPA and the API share one origin, so these are plain relative paths and
 * there is no CORS anywhere in this application.
 */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'Jotain meni vikaan. Yritä uudelleen.';
    throw new ApiError(response.status, message);
  }

  return body as T;
}

export const api = {
  today: () => request<TodayResponse>('/api/today'),

  players: () => request<{ players: PlayerSummary[] }>('/api/players'),

  player: (playerId: string) =>
    request<PlayerDetail>(`/api/players/${encodeURIComponent(playerId)}`),

  register: (name: string, gameDate: string) =>
    request<{ playerId: string; displayName: string }>('/api/registrations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, gameDate }),
    }),

  unregister: (playerId: string) =>
    request<void>(`/api/registrations/${encodeURIComponent(playerId)}`, { method: 'DELETE' }),
};

export type Api = typeof api;
