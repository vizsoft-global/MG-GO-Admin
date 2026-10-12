import {
  LANE_CLIENT_TIMEOUT_MS,
  LANE_FUNCTION_NAME,
  laneOf,
  type LaneId,
} from "../../../functions/src/router/lanes";

const DEFAULT_TIMEOUT_MS = 60_000;

/** `admin_list_requests` → `adminListRequests`, the export name in `functions/src`. */
export function functionName(rpcName: string): string {
  if (!rpcName.includes("_")) return rpcName;
  return rpcName.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase());
}

export type CallableRoute = {
  functionName: string;
  lane: LaneId | null;
  url: string;
  body: { data: unknown };
  timeoutMs: number;
};

/**
 * Picks the Cloud Functions URL. `ADMIN_API_ROUTER=off` keeps the legacy
 * function name. Any other value, including unset, uses the lane. Names that
 * are not on a lane (rider callables, worker HTTP) stay on the legacy URL.
 */
export function resolveAdminCallableRequest(input: {
  routerMode: string | undefined;
  projectId: string;
  region: string;
  rpcName: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
}): CallableRoute {
  const name = functionName(input.rpcName);
  const lane = input.routerMode === "off" ? null : laneOf(name);
  const requested = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const base = `https://${input.region}-${input.projectId}.cloudfunctions.net`;
  if (!lane) {
    return {
      functionName: name,
      lane: null,
      url: `${base}/${name}`,
      body: { data: input.args },
      timeoutMs: requested,
    };
  }
  const laneName = LANE_FUNCTION_NAME[lane];
  return {
    functionName: name,
    lane,
    url: `${base}/${laneName}`,
    body: { data: { fn: name, data: input.args } },
    timeoutMs: Math.max(requested, LANE_CLIENT_TIMEOUT_MS[lane]),
  };
}
