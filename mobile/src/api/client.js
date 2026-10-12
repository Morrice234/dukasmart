import * as SecureStore from 'expo-secure-store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

let token = null;

export async function loadToken() {
  token = await SecureStore.getItemAsync('token');
  return token;
}

export async function setToken(t) {
  token = t;
  if (t) await SecureStore.setItemAsync('token', t);
  else await SecureStore.deleteItemAsync('token');
}

export function hasToken() {
  return Boolean(token);
}

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || (status === 0 ? `Cannot reach the server at ${API_URL}. Check your internet, or that the server is running.` : `Request failed (${status})`));
    this.status = status;
    this.code = body && body.code;
  }
}

export async function api(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
