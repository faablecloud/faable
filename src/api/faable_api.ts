import axios, { AxiosError, AxiosResponse } from "axios";
import { Arguments } from "yargs";

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
export type FaableApi = ReturnType<typeof faable_api>;

const e =
  <T extends (...args: any) => Promise<Q>, Q extends AxiosResponse>(fn: T) =>
  async (
    ...args: Parameters<typeof fn>
  ): Promise<Awaited<ReturnType<typeof fn>>["data"]> => {
    try {
      const res = await fn(...(args as any));
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

export const faable_api = () => {
  const api = axios.create({
    baseURL: "https://api.faable.com",
    params: {
      api_key: "1234",
    },
  });

  const getBySlug = async (slug: string) => {
    return await api.get<FaableApp>(`/app/slug/${slug}`);
  };

  const getRegistry = async (app_id: string) => {
    return api.get<FaableAppRegistry>(`/app/${app_id}/registry`);
  };

  const w = e(getBySlug);
  return {
    getBySlug: w,
    getRegistry: e(getRegistry),
  };
};
