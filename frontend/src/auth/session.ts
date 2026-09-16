const TOKEN_KEY = "e-inter.session";
const USER_KEY = "e-inter.username";

export function getSessionToken(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getSessionUsername(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(USER_KEY);
}

export function persistSession(token: string, username: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, username);
}

export function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}
