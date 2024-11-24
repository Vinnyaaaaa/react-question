import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from "axios";
import { ErrorHandler, RequestOptions, TokenManager } from "./types";
import { LocalStorageTokenManager } from "./token";
import { refreshToken } from "@/api/interface/auth";

export type Response<T> =
  | {
      data: T;
      success: true;
      errorCode?: string;
      errorMessage?: string;
    }
  | {
      data?: T;
      success: false;
      errorCode: number;
      errorMessage: string;
    };

type ExtractKeys<T extends string> =
  T extends `${string}{${infer Key}}${infer Rest}`
    ? Key | ExtractKeys<Rest>
    : never;

type PathVariables<T extends string> = ExtractKeys<T> extends never
  ? Record<string, string | number>
  : Record<ExtractKeys<T>, string | number>;

type RequestConfig<
  D extends object,
  Q extends object,
  U extends string,
  P = PathVariables<U>
> = Omit<AxiosRequestConfig<D>, "url" | "params"> & {
  /**
   * @example '/api/:id' => pathVariables: { id: "1" }
   * @example '/api/:id/:name' => pathVariables: { id: "1", name: "2" }
   */
  url: U;
  ignoreAuth?: boolean; //不為true時 header需附帶Authentication value為token
  silentError?: boolean;
  throwError?: boolean;
  params?: Q;
  /**
   * @example '/api/:id' => { id: "1" }
   * @example '/api/:id/:name' => { id: "1", name: "2" }
   */
  pathVariables?: P;
};

export interface Request {
  <
    T,
    D extends object = any,
    Q extends object = any,
    U extends string = string,
    P = PathVariables<U>
  >(
    args: RequestConfig<D, Q, U, P>
  ): Promise<Response<T>>;
}

interface ApiError extends Error {
  name: 'ApiError';
  response?: {
    status: number;
    data?: {
      errorMessage?: string;
    };
  };
}

let requestInstance: AxiosInstance;
let tokenManager: TokenManager;
let errorHandler: ErrorHandler;

export function createRequest(options: RequestOptions) {
  tokenManager = options.tokenManager || new LocalStorageTokenManager();
  errorHandler = options.errorHandler;

  requestInstance = axios.create({
    baseURL: options.baseURL,
    timeout: options.timeout || 10000,
  });

  // 请求拦截器
  requestInstance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const requestConfig = config as unknown as RequestConfig<any, any, any>;
      if (!requestConfig.ignoreAuth) {
        const token = tokenManager.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }

      // 处理参数
      if (requestConfig.pathVariables) {
        let url = requestConfig.url || '';
        Object.entries(requestConfig.pathVariables).forEach(([key, value]) => {
          url = url.replace(`{${key}}`, String(value));
        });
        config.url = url;
      }

      return config;
    },
    (error: AxiosError) => Promise.reject(error)
  );

  // 响应拦截器
  requestInstance.interceptors.response.use(
    (response: AxiosResponse<Response<any>>) => {
      const { data } = response;
      if (!data.success) {
        const error = new Error(data.errorMessage) as ApiError;
        error.name = 'ApiError';
        error.response = {
          status: 400,
          data: {
            errorMessage: data.errorMessage
          }
        };
        throw error;
      }
      return data;
    },
    async (error: AxiosError) => {
      const originalRequest = error.config as RequestConfig<any, any, any> & { _retry?: boolean };
      
      // Token expired
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        try {
          const refreshTokenValue = tokenManager.getRefreshToken();
          if (!refreshTokenValue) {
            throw new Error('No refresh token available');
          }
          
          const response = await refreshToken({ refreshToken: refreshTokenValue });
          if (response.success) {
            tokenManager.setToken(response.data.access);
            tokenManager.setRefreshToken(response.data.refresh);
            return requestInstance(originalRequest);
          }
        } catch (refreshError) {
          tokenManager.removeToken();
          tokenManager.removeRefreshToken();
          throw refreshError;
        }
      }

      // Handle errors based on configuration
      if (!originalRequest.silentError) {
        errorHandler.showError(error.response?.data?.errorMessage || error.message);
      }

      if (originalRequest.throwError) {
        throw error;
      }

      return {
        success: false,
        errorCode: error.response?.status || 500,
        errorMessage: error.response?.data?.errorMessage || error.message,
      } as Response<any>;
    }
  );
}

const request: Request = async <
  T = any,
  D extends object = any,
  Q extends object = any,
  U extends string = string,
  P = PathVariables<U>
>(
  args: RequestConfig<D, Q, U, P>
): Promise<Response<T>> => {
  if (!requestInstance) {
    throw new Error('Request instance not initialized. Call createRequest first.');
  }
  return requestInstance(args) as Promise<Response<T>>;
};

export default request;
