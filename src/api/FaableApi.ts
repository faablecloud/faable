import { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { create_base_client } from "./base_client";
import { AuthStrategy, AuthStrategyBuilder } from "./strategies/types";
export interface FaableApp {
  id: string;
  name: string;
  url: string;
  repository:string
}

export interface FaableAppRegistry {
  hostname: string;
  image: string;
  user: string;
  password: string;
}

export interface Secret {
  id: string;
  related: string;
  name: string;
  value: string;
}


type Page<Q> = { results: Q[] };

const firstPage = async <T, Q extends Promise<Page<T>>>(
  res: Q
): Promise<Awaited<Q>["results"]> => {
  const items = (await res).results;
  return items;
};

const data = async <T, Q extends Promise<AxiosResponse<T>>>(
  res: Q
): Promise<Awaited<Q>["data"]> => {
  const items = (await res).data;
  return items;
};

export type FaableClientConfig<T = any> = {
  authStrategy?: AuthStrategyBuilder<T>;
  auth?: T;
};

type FaableApiConfig<T> = {} & FaableClientConfig<T>;

export class FaableApi<T = any> {
  client: AxiosInstance;
  strategy?: AuthStrategy;

  constructor(config: FaableApiConfig<T>) {
    const { authStrategy, auth } = config;
    this.client = create_base_client();
    this.strategy = authStrategy && authStrategy(auth);

    const strategy = this.strategy;
    this.client.interceptors.request.use(
      async function (config) {
        // Do something before request is sent
        const headers = strategy ? await strategy.headers() : {};
        config.headers.set(headers);
        // console.log("all headers");
        // console.log(headers);
        return config;
      },
      function (error) {
        // Do something with request error
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const e: AxiosError<{ message: string }> = error;
        if (e.isAxiosError) {
          const res = e.response;
          const url = e.config?.url || "";
          if (res) {
            const serverMessage =
              res.data?.message || res.statusText || "Unknown Error";
            throw new Error(`FaableApi ${url} ${res.status}: ${serverMessage}`, {
              cause: error,
            });
          } else {
            throw new Error(`FaableApi ${url} ${e.message}`, { cause: error });
          }
        }
        throw error;
      }
    );
  }

  static create<T>(config: FaableApiConfig<T> = {}) {
    return new FaableApi(config);
  }

  async list() {
    return firstPage(data(this.client.get<Page<FaableApp>>(`/app`)));
  }

  async getBySlug(slug: string) {
    return data(this.client.get<FaableApp>(`/app/slug/${slug}`));
  }

  async getApp(app_id: string) {
    return data(this.client.get<FaableApp>(`/app/${app_id}`));
  }

  async getRegistry(app_id: string) {
    return data(this.client.get<FaableAppRegistry>(`/app/${app_id}/registry`));
  }

  async createDeployment(params: {
    app_id: string;
    type: string;
    image: string;
  }) {
    return data(this.client.post<{ id: string }>(`/deployment`, params));
  }

  async getAppSecrets(app_id: string) {
    return firstPage(data(this.client.get<Page<Secret>>(`/secret/${app_id}`)));
  }

  async updateApp(
    app_id: string,
    params: Partial<FaableApp> & { github_repo?: string }
  ) {
    return data(this.client.post<FaableApp>(`/app/${app_id}`, params));
  }



  async getMe() {
    return data(this.client.get<{ email: string; id: string }>(`/auth/me`));
  }
}
