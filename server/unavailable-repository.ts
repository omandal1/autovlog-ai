import { ConfigurationError } from "./errors";
import type { AutoVlogRepository } from "./repository";

export function createUnavailableRepository(message: string): AutoVlogRepository {
  const fail = () => {
    throw new ConfigurationError("DATABASE_UNAVAILABLE", message);
  };
  const target = {
    close: async () => undefined,
    ping: async () => fail(),
    failInterruptedRenderJobs: async () => 0
  };

  return new Proxy(target as unknown as AutoVlogRepository, {
    get(object, property, receiver) {
      // Promise resolution checks arbitrary returned objects for a `then`
      // property. Returning the generic failing method here would make this
      // repository look like a rejected thenable and crash degraded startup.
      if (property === "then") {
        return undefined;
      }
      if (
        property === "close" ||
        property === "ping" ||
        property === "failInterruptedRenderJobs"
      ) {
        return Reflect.get(object, property, receiver);
      }
      return async () => fail();
    }
  });
}
