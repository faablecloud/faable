export type AuthStrategy = {
  headers: () => Promise<Record<string, string>>;
  app_id?: () => Promise<string | undefined>;
};
export type AuthStrategyBuilder<T> = (...params: T[]) => AuthStrategy;
