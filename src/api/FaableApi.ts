import {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { create_base_client } from "./base_client";
import { AuthStrategy, AuthStrategyBuilder } from "./strategies/types";

// Socket-level failures where no response ever arrived: the connection died
// before the server produced anything, so a single retry is safe for any
// method (a reset mid-flight means the request was not processed).
const RESET_CODES = new Set(["ECONNRESET", "EPIPE"]);
const RETRY_DELAY_MS = 300;

const is_connection_reset = (e: AxiosError) =>
  e.isAxiosError &&
  !e.response &&
  (RESET_CODES.has(e.code ?? "") || e.message.includes("socket hang up"));
export interface FaableApp {
  id: string;
  name: string;
  url: string;
  team: string;
  repository:string
  // Remote-build rollout gate (server-decided; the CLI follows it).
  build_mode?: "local" | "remote";
  // Monorepo Root Directory (Vercel-style; server-decided source of truth).
  // The app lives in <repo>/<root_dir>; the CLI resolves the plan there.
  root_dir?: string | null;
  github_branch?: string;
  // Push-to-deploy trigger (deploy v4). 'webhook' = the platform deploys
  // every push server-side; null/absent = the repo's own GitHub Actions
  // workflow deploys (legacy or user-managed CI).
  deploy_trigger?: string | null;
  // What the platform build detected (buildpack/framework/runtime), reported
  // by the builder before building — present on failed builds too.
  detected?: DeploymentDetected | null;
  status?: {
    phase: string;
    deployment: string | null;
  };
}

export interface FaableDeployment {
  id: string;
  app_id?: string;
  team?: string;
  release?: string;
  image?: string;
  github_commit?: string;
  github_commit_message?: string;
  github_ref?: string;
  github_actor?: string;
  // Ref to the build payload row (source manifest + runnable descriptor).
  // Present on every remote build; absent on a legacy image deploy.
  artifact_id?: string;
  artifact_ready_at?: string;
  // Set when this deployment is a rebuild of a failed one.
  redeploy_of?: string;
  quota_released_at?: string;
  trigger?: string | null;
  detected?: DeploymentDetected;
  createdAt?: string;
  status?: {
    phase?: string;
    reason?: string;
    controlled_at?: string;
    controlled_by?: string;
    // Artifact deploys: the digest-pinned runtime image the controller
    // resolved at first materialization (write-once).
    runtime_image?: string;
  };
}

// Platform-detected stack, reported by the builder BEFORE building (so it
// survives a failed build). Same shape on the app and on the deployment.
export interface DeploymentDetected {
  buildpack: string;
  framework?: string;
  runtime: { name: string; version?: string };
}

// The deploy-v3 runnable descriptor, served by GET /artifact/:id. The source
// manifest is deliberately not part of this view.
export interface FaableArtifact {
  id: string;
  deployment_id: string;
  app_id: string;
  artifact?: {
    sha256: string;
    size: number;
    format: string;
    runtime: { name: string; version?: string | null };
    profile: string;
    start_command?: string | null;
  };
  purged_at?: string;
}

// Runtime log line as the API serves it (Loki-backed, newest first, last
// 24h, up to 200 lines): [ns_timestamp, text, deployment_id].
export type AppLogLine = [string | number, string, string?];

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

export interface FaableDomain {
  id: string;
  fqdn: string;
  tls: boolean;
  app_id?: string | null;
  verified: boolean;
  active: boolean;
  team: string;
  // Outcome of the DNS verification worker's latest check. `dns_expected`
  // carries the CNAME target(s) the user must configure — the same
  // `<domain.id>.faable.link` the dashboard instructions show.
  status?: {
    dns_state?: "pending" | "ok" | "misconfigured" | "error";
    dns_checked_at?: string | null;
    dns_expected?: string[];
    dns_observed?: string[];
    dns_message?: string | null;
  };
}

export interface Secret {
  id: string;
  related: string;
  // "app" for the app's own secrets, "profile" for secrets inherited from
  // the team profile (returned by GET /secret/:app_id but not editable
  // through the app context).
  related_model: "app" | "profile";
  name: string;
  value: string;
}


type Page<Q> = { results: Q[]; next?: string | null };

const firstPage = async <T, Q extends Promise<Page<T>>>(
  res: Q
): Promise<Awaited<Q>["results"]> => {
  const items = (await res).results;
  return items;
};

// Walk the cursor to exhaustion. `list()` needs this instead of `firstPage`:
// a user who sees many apps (admins see all of them) gets a multi-page
// listing, and matching by repository against a truncated first page made
// every repo-resolved command answer "No app linked to this repository".
const allPages = async <T>(
  fetch_page: (next?: string) => Promise<Page<T>>
): Promise<T[]> => {
  const items: T[] = [];
  let next: string | undefined;
  do {
    const page = await fetch_page(next);
    items.push(...page.results);
    next = page.next ?? undefined;
  } while (next);
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

    // Registered before the error-wrapping interceptor so it sees the raw
    // axios error. Retries once per request; the retried call re-enters the
    // full chain (auth headers included).
    const client = this.client;
    this.client.interceptors.response.use(undefined, async (error) => {
      const e: AxiosError = error;
      const config = e.config as
        | (InternalAxiosRequestConfig & { _retried?: boolean })
        | undefined;
      if (config && !config._retried && is_connection_reset(e)) {
        config._retried = true;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return client.request(config);
      }
      throw error;
    });

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
    return allPages<FaableApp>((next) =>
      data(
        this.client.get<Page<FaableApp>>(`/app`, {
          params: { pageSize: 200, ...(next ? { next } : {}) },
        })
      )
    );
  }

  async getBySlug(slug: string) {
    return data(this.client.get<FaableApp>(`/app/slug/${slug}`));
  }

  async getApp(app_id: string) {
    return data(this.client.get<FaableApp>(`/app/${app_id}`));
  }

  // `image`/`type` are optional to support the failure path: a failed build
  // is recorded as a deployment without an image (and without `type`, which
  // would otherwise rewrite the app's runtime_strategy server-side).
  // `source` is the remote-build path (v2): content-addressed manifest +
  // serialized BuildPlan; the platform builds and completes the image.
  async createDeployment(params: {
    app_id: string;
    type?: string;
    image?: string;
    source?: {
      manifest: { path: string; sha: string; size: number; mode?: number }[];
      plan?: unknown;
    };
    release?: string;
    github_commit?: string;
    github_ref?: string;
    github_actor?: string;
    github_commit_message?: string;
  }) {
    return data(this.client.post<{ id: string }>(`/deployment`, params));
  }

  // Remote builds: diff the source manifest against the CAS. Returns
  // presigned PUTs (sha-pinned by signature) for the missing blobs only.
  async uploadMissing(
    app_id: string,
    files: { path: string; sha: string; size: number }[]
  ) {
    return data(
      this.client.post<{
        uploads: { sha: string; url: string; headers: Record<string, string> }[];
      }>(
        `/upload/missing`,
        {
          app_id,
          files: files.map(({ path, sha, size }) => ({ path, sha, size })),
        },
        { timeout: 60_000 }
      )
    );
  }

  // Remote builds: read the build output the builder attaches to the
  // deployment (same endpoint the CLI writes to in local builds).
  async getDeploymentLogs(deployment_id: string) {
    return data(
      this.client.get<{ content: string; truncated: boolean; size: number }>(
        `/deployment/${deployment_id}/logs`
      )
    );
  }

  // Phase transitions the CLI owns (BUILDING when the build starts,
  // BUILD_ERROR on a failed build). Runtime phases stay controller-territory.
  async updateDeploymentStatus(deployment_id: string, status: { phase: string }) {
    return data(this.client.post(`/status/${deployment_id}`, status));
  }

  // Complete a create-first deployment with the built image (write-once
  // server-side). Setting the image is what makes the controller claim the
  // deployment and materialize it.
  async completeDeployment(deployment_id: string, image: string) {
    return data(
      this.client.post<{ id: string }>(`/deployment/${deployment_id}`, {
        image,
      })
    );
  }

  // Fetch a deployment with its runtime status, so the deploy command can
  // watch for a terminal failure (ERROR/BUILD_ERROR + reason) while polling
  // for promotion — and fail the run fast instead of timing out green.
  async getDeployment(deployment_id: string) {
    return data(
      this.client.get<FaableDeployment>(`/deployment/${deployment_id}`)
    );
  }

  // Build payload of a deployment (runnable descriptor: runtime, profile,
  // size, checksum). Authorized by the caller's access to the parent
  // deployment, so no team header is needed — same posture as getDeployment.
  async getArtifact(artifact_id: string) {
    return data(this.client.get<FaableArtifact>(`/artifact/${artifact_id}`));
  }

  // Attach the captured build/deploy output to a deployment. The base client
  // timeout (10s) is too short for a multi-MB body on a slow uplink.
  async uploadDeploymentLogs(
    deployment_id: string,
    body: { content: string; truncated?: boolean }
  ) {
    return data(
      this.client.post<{ id: string; truncated: boolean; size: number }>(
        `/deployment/${deployment_id}/logs`,
        body,
        { timeout: 60_000, maxBodyLength: Infinity, maxContentLength: Infinity }
      )
    );
  }

  async getAppSecrets(app_id: string) {
    return firstPage(data(this.client.get<Page<Secret>>(`/secret/${app_id}`)));
  }

  // Replace the app's whole secret set (the endpoint deletes and recreates).
  // This is the only mutation path that triggers an immediate restart of the
  // app; the per-secret upsert/delete endpoints are not used by the CLI.
  // The endpoint stamps the created secrets with the team from the request
  // context, which a CLI user token does not carry — pass the app's team
  // (from getApp) so it travels as the `x-faable-team` header.
  async createSecretsBatch(
    context_id: string,
    team: string,
    secrets: { name: string; value: string }[]
  ) {
    return data(
      this.client.post<Secret[]>(
        `/secret/createbatch`,
        { context_id, secrets },
        { headers: { "x-faable-team": team } }
      )
    );
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

  // Runtime logs of the app (Loki-backed; last 24h, up to 200 lines, newest
  // first). Optionally scoped to one deployment.
  async getAppLogs(app_id: string, params: { deployment_id?: string } = {}) {
    return data(
      this.client.get<AppLogLine[]>(`/app/${app_id}/logs`, { params })
    );
  }

  // Deployments of an app, newest first (the API's list index sorts
  // createdAt desc). Team pinned via header — same reason as domains.
  async listDeployments(app_id: string, team: string) {
    return firstPage(
      data(
        this.client.get<Page<FaableDeployment>>(`/deployment`, {
          params: { app_id },
          headers: { "x-faable-team": team },
        })
      )
    );
  }

  // Build and deploy the current head of the deploy branch server-side —
  // the same path a push webhook takes, same-commit dedupe included.
  async deployNow(app_id: string) {
    return data(
      this.client.post<{ status: "created"; commit: string; branch: string }>(
        `/app/${app_id}/deploy`
      )
    );
  }

  // Rebuild a failed deployment from its recorded source (CAS manifest or
  // git ref). The API enforces the guards: failed phase only, never older
  // than what production serves.
  async redeployDeployment(deployment_id: string, team: string) {
    return data(
      this.client.post<FaableDeployment>(
        `/deployment/${deployment_id}/redeploy`,
        undefined,
        { headers: { "x-faable-team": team } }
      )
    );
  }

  // Domains are team-scoped rows; a CLI user token carries no default team,
  // so every call pins the app's team via `x-faable-team` (same pattern as
  // createSecretsBatch).
  async listDomains(app_id: string, team: string) {
    return firstPage(
      data(
        this.client.get<Page<FaableDomain>>(`/domain`, {
          params: { app_id },
          headers: { "x-faable-team": team },
        })
      )
    );
  }

  async createDomain(
    team: string,
    params: { fqdn: string; app_id: string; tls?: boolean }
  ) {
    return data(
      this.client.post<FaableDomain>(`/domain`, params, {
        headers: { "x-faable-team": team },
      })
    );
  }

  async getDomain(domain_id: string, team: string) {
    return data(
      this.client.get<FaableDomain>(`/domain/${domain_id}`, {
        headers: { "x-faable-team": team },
      })
    );
  }

  async deleteDomain(domain_id: string, team: string) {
    return data(
      this.client.delete(`/domain/${domain_id}`, {
        headers: { "x-faable-team": team },
      })
    );
  }
}
