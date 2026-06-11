import { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { create_base_client } from "./base_client";
import { AuthStrategy, AuthStrategyBuilder } from "./strategies/types";
export interface FaableApp {
  id: string;
  name: string;
  url: string;
  team: string;
  repository:string
  status?: {
    phase: string;
    deployment: string | null;
  };
}

export interface GithubRepo {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  installation_id: number;
}

export interface GithubInstallation {
  installation_id: number;
  account_login: string;
  account_type: string;
  account_avatar_url?: string;
  app_slug: string;
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
        const e: AxiosError<{ message: string; code?: string; action?: string }> =
          error;
        if (e.isAxiosError) {
          const res = e.response;
          const url = e.config?.url || "";
          if (res) {
            // Uniform handling for an expired/invalid session across every
            // command, regardless of which endpoint returned the 401.
            if (res.status === 401) {
              const expired = new Error(
                "Your Faable session has expired or is invalid. Run `faable login` to sign in again.",
                { cause: error }
              );
              (expired as any).status = 401;
              throw expired;
            }
            const serverMessage =
              res.data?.message || res.statusText || "Unknown Error";
            const wrapped = new Error(
              `FaableApi ${url} ${res.status}: ${serverMessage}`,
              { cause: error }
            );
            // Surface the structured error contract (e.g. the repository-link
            // flow returns { code, action }) so callers can branch on it.
            (wrapped as any).status = res.status;
            if (res.data?.code) (wrapped as any).code = res.data.code;
            if (res.data?.action) (wrapped as any).action = res.data.action;
            throw wrapped;
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
    github_commit?: string;
    github_ref?: string;
    github_actor?: string;
    github_commit_message?: string;
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

  async linkRepository(
    app_id: string,
    params: { repository: string; github_branch?: string }
  ) {
    return data(
      this.client.post<FaableApp>(`/app/${app_id}/link-repository`, params)
    );
  }

  // Organizations/accounts where the Faable GitHub App is installed.
  async listGithubInstallations() {
    return data(
      this.client.get<{ installations: GithubInstallation[] }>(
        `/github/installations`
      )
    ).then((res) => res.installations);
  }

  // Top repositories for a single installation (org), optionally filtered.
  async listGithubRepos(
    installation_id: number,
    params: { q?: string; limit?: number } = {}
  ) {
    return data(
      this.client.get<{ repositories: GithubRepo[] }>(
        `/github/installations/${installation_id}/repositories`,
        { params }
      )
    ).then((res) => res.repositories);
  }

  async getMe() {
    return data(this.client.get<{ email: string; id: string }>(`/auth/me`));
  }
}
