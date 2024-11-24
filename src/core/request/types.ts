export interface ErrorHandler {
  showError: (message: string) => void;
  showWarning?: (message: string) => void;
  showInfo?: (message: string) => void;
}

export interface TokenManager {
  getToken: () => string | null;
  setToken: (token: string) => void;
  removeToken: () => void;
  getRefreshToken: () => string | null;
  setRefreshToken: (token: string) => void;
  removeRefreshToken: () => void;
}

export interface RequestOptions {
  errorHandler: ErrorHandler;
  tokenManager: TokenManager;
  baseURL: string;
  timeout?: number;
}
