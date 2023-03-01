import axios from "axios";
import { AuthStrategy, AuthStrategyBuilder } from "./types";

export type FaableClientConfig<T = any> = {
  authStrategy?: AuthStrategyBuilder<T>;
  auth?: T;
};

export function prepare_client<T>({
  authStrategy,
  auth,
}: FaableClientConfig<T> = {}) {
  const strategy: AuthStrategy | undefined = authStrategy && authStrategy(auth);
  const client = axios.create({
    baseURL: "https://api.faable.com",
    timeout: 5000,
  });

  client.interceptors.request.use(
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
  return client;
}
