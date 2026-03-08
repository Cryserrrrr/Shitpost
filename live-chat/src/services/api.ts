import axios from "axios";

export function getServerUrl(): string {
  return localStorage.getItem("serverUrl") || "http://127.0.0.1:3000";
}

export function getApiUrl(): string {
  return getServerUrl() + "/api";
}

export function setServerUrl(url: string) {
  // Normalize: remove trailing slash
  const clean = url.replace(/\/+$/, "");
  localStorage.setItem("serverUrl", clean);
  // Update axios baseURL immediately
  api.defaults.baseURL = clean + "/api";
}

const api = axios.create({
  baseURL: getApiUrl(),
});

// Add interceptor to add auth token
api.interceptors.request.use((config) => {
  // Always use latest baseURL from localStorage
  config.baseURL = getApiUrl();
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
let isRefreshing = false;
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  refreshQueue.forEach((p) => {
    if (error) p.reject(error);
    else p.resolve(token!);
  });
  refreshQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes("/auth/")) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          refreshQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject,
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem("refreshToken");
      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        window.dispatchEvent(new Event("auth:logout"));
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${getApiUrl()}/auth/refresh`, { refreshToken });
        localStorage.setItem("token", data.token);
        localStorage.setItem("refreshToken", data.refreshToken);
        originalRequest.headers.Authorization = `Bearer ${data.token}`;
        processQueue(null, data.token);
        return api(originalRequest);
      } catch (refreshError: any) {
        processQueue(refreshError, null);
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        window.dispatchEvent(new Event("auth:logout"));
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Shared token refresh — reuses the interceptor's isRefreshing/queue
 * so only one refresh happens at a time across the entire app.
 */
export async function refreshAuthToken(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise<string | null>((resolve) => {
      refreshQueue.push({
        resolve: (token: string) => resolve(token),
        reject: () => resolve(null),
      });
    });
  }

  isRefreshing = true;
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) {
    isRefreshing = false;
    return null;
  }

  try {
    const { data } = await axios.post(`${getApiUrl()}/auth/refresh`, { refreshToken });
    localStorage.setItem("token", data.token);
    localStorage.setItem("refreshToken", data.refreshToken);
    processQueue(null, data.token);
    return data.token;
  } catch (err: any) {
    processQueue(err, null);
    return null;
  } finally {
    isRefreshing = false;
  }
}

export default api;
