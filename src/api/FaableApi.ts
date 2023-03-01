import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { prepare_client, FaableClientConfig } from "./client";
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
      if (res) {
        throw new Error(`API Error ${res.status}: ${res?.data.message}`);
      } else {
        throw new Error(`API Error:${e.message}`);
      }
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

type FaableApiConfig<T> = {} & FaableClientConfig<T>;

export class FaableApi<T = any> {
  client: AxiosInstance;

  constructor(config: FaableApiConfig<T>) {
    this.client = prepare_client(config);
  }

  static create<T>(config: FaableApiConfig<T> = {}) {
    return new FaableApi(config);
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
