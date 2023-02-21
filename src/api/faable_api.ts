import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { AuthStrategy } from "./types";
export interface FaableApp {
  id: string;
  name: string;
}

export interface FaableAppRegistry {
  hostname: string;
  image: string;
  user: string;
  password: string;
}

const wrap_error = async <T>(prom: Promise<AxiosResponse<T>>): Promise<T> => {
  try {
    const res = await prom;
    return res.data as any;
  } catch (error) {
    const e: AxiosError<{ message: string }> = error;
    if (e.isAxiosError) {
      const res = e.response;
      throw new Error(`API Error: ${res.data.message}`);
    }
    throw error;
  }
};

type Page<Q> = { results: Q[] };

const paginate = async <Q extends Promise<Page<T>>, T>(
  data: Q
): Promise<Awaited<Q>["results"]> => {
  const items = (await data).results;
  return items;
};

type FaableApiConfig<T = any> = {
  authStrategy?: AuthStrategy<T>;
  auth?: T;
};
export class FaableAppsApi {
  client: AxiosInstance;

  constructor(config: FaableApiConfig) {
    const { authStrategy, auth } = config;
    const strategy = authStrategy && authStrategy(auth);
    this.client = axios.create({
      baseURL: "https://api.faable.com",
    });
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
  }

  static create(config: FaableApiConfig = {}) {
    return new FaableAppsApi(config);
  }

  async list() {
    return paginate(wrap_error(this.client.get<Page<FaableApp>>(`/app`)));
  }

  async getBySlug(slug: string) {
    return wrap_error(this.client.get<FaableApp>(`/app/slug/${slug}`));
  }

  async getRegistry(app_id: string) {
    return wrap_error(
      this.client.get<FaableAppRegistry>(`/app/${app_id}/registry`)
    );
  }
}
