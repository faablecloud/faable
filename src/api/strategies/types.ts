export type AuthStrategy = {
  headers: () => Promise<Record<string, string>>;
};
export type AuthStrategyBuilder<T> = (...params: T[]) => AuthStrategy;
