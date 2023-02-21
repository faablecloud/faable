export type AuthStrategyResponse = {
  headers: () => Promise<Record<string, string>>;
};
export type AuthStrategy<T> = (...params: T[]) => AuthStrategyResponse;
