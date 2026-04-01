import { apiFetch } from "@/lib/http";

export async function fetchCurrentUser(token) {
  return apiFetch("/auth/me", { token });
}
