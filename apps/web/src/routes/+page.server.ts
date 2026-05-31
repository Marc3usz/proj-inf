import { env } from '$env/dynamic/public';

export function load() {
  return {
    apiBase: env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000'
  };
}
