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

function handleError(message?: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const method = descriptor.value;
    descriptor.value = async function (...args: any) {
      try {
        return await method.bind(this).apply(target, args);
      } catch (error) {
        const e: AxiosError<{ message: string }> = error;
        if (e.isAxiosError) {
          const res = e.response;
          if (res) {
            throw new Error(
              `FaableApi ${e.config.url} ${res.status}: ${res?.data.message}`
            );
          } else {
            throw new Error(`FaableApi ${e.message}`);
          }
        }
        throw error;
      }
    };
  };
}

type Page<Q> = { results: Q[] };

const paginate = async <T, Q extends Promise<Page<T>>>(
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

type FaableApiConfig<T> = {} & FaableClientConfig<T>;

export class FaableApi<T = any> {
  client: AxiosInstance;

  constructor(config: FaableApiConfig<T>) {
    this.client = prepare_client(config);
  }

  static create<T>(config: FaableApiConfig<T> = {}) {
    return new FaableApi(config);
  }

  @handleError()
  async list() {
    return paginate(data(this.client.get<Page<FaableApp>>(`/app`)));
  }

  @handleError()
  async getBySlug(slug: string) {
    return data(this.client.get<FaableApp>(`/app/slug/${slug}`));
  }

  @handleError()
  async getRegistry(app_id: string) {
    return data(this.client.get<FaableAppRegistry>(`/app/${app_id}/registry`));
  }
}
