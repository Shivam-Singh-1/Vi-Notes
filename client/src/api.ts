import axios from "axios";
import type { AccessTokenResponse } from "@shared/auth";
import { AxiosHeaders } from "axios";
import type { InternalAxiosRequestConfig } from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3001";
const AUTH_SESSION_STORAGE_KEY = "vi-notes.auth";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

type StoredAuthSession = {
  accessToken: string;
};

const loadAccessTokenFromSession = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuthSession>;
    return typeof parsed.accessToken === "string" ? parsed.accessToken : null;
  } catch {
    window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    return null;
  }
};

const persistAccessTokenToSession = (token: string | null) => {
  if (typeof window === "undefined") {
    return;
  }

  if (!token) {
    window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    return;
  }

  const payload: StoredAuthSession = { accessToken: token };
  window.sessionStorage.setItem(
    AUTH_SESSION_STORAGE_KEY,
    JSON.stringify(payload),
  );
};

let accessToken: string | null = loadAccessTokenFromSession();

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _skipAuthRefresh?: boolean;
}

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  persistAccessTokenToSession(token);
};

export const getAccessToken = () => accessToken;

export const clearAuthSession = () => {
  setAccessToken(null);
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
  }
};

api.interceptors.request.use((config) => {
  if (accessToken) {
    const nextHeaders = AxiosHeaders.from(config.headers);
    nextHeaders.set("Authorization", `Bearer ${accessToken}`);
    config.headers = nextHeaders;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error);
    }

    const originalRequest = error.config as RetriableRequestConfig | undefined;
    const status = error.response?.status;
    const requestUrl = originalRequest?.url ?? "";

    if (
      !originalRequest ||
      originalRequest._skipAuthRefresh ||
      originalRequest._retry ||
      status !== 401 ||
      requestUrl.includes("/api/auth/refresh") ||
      requestUrl.includes("/api/auth/login") ||
      requestUrl.includes("/api/auth/register")
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const refreshed = await api.post<AccessTokenResponse>(
        "/api/auth/refresh",
        undefined,
        { _skipAuthRefresh: true } as RetriableRequestConfig,
      );
      setAccessToken(refreshed.data.accessToken);

      const nextHeaders = AxiosHeaders.from(originalRequest.headers);
      nextHeaders.set("Authorization", `Bearer ${refreshed.data.accessToken}`);
      originalRequest.headers = nextHeaders;

      return api(originalRequest);
    } catch (refreshError) {
      setAccessToken(null);

      if (typeof window !== "undefined" && !requestUrl.includes("/api/auth/")) {
        window.dispatchEvent(new Event("auto-save-session"));
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
      }

      return Promise.reject(refreshError);
    }
  },
);
