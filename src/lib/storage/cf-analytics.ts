export type R2DailySeriesPoint = {
  date: string;
  objects: number;
  bytes: number;
};

export type R2AnalyticsResult =
  | {
      available: true;
      classARequests: number;
      classBRequests: number;
      egressBytes: number;
      dailySeries: R2DailySeriesPoint[];
    }
  | {
      available: false;
      reason: string;
    };

const CLASS_A_ACTIONS = new Set([
  "PutObject",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "UploadPart",
  "ListBuckets",
  "ListObjects",
  "ListMultipartUploads",
]);

type GraphQlResponse = {
  data?: {
    viewer?: {
      accounts?: Array<{
        r2OperationsAdaptiveGroups?: Array<{
          sum?: { requests?: number; responseObjectSize?: number };
          dimensions?: { actionType?: string };
        }>;
        r2StorageAdaptiveGroups?: Array<{
          max?: { objectCount?: number; payloadSize?: number };
          dimensions?: { datetime?: string };
        }>;
      }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

export async function getR2Analytics(params: {
  accountId: string;
  days?: number;
}): Promise<R2AnalyticsResult> {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    return { available: false, reason: "missing_cloudflare_token" };
  }

  const days = params.days ?? 30;
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  const query = `
    query R2Analytics($accountTag: string!, $start: Time!, $end: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 10000
            filter: { datetime_geq: $start, datetime_leq: $end }
          ) {
            sum { requests responseObjectSize }
            dimensions { actionType }
          }
          r2StorageAdaptiveGroups(
            limit: 10000
            filter: { datetime_geq: $start, datetime_leq: $end }
            orderBy: [datetime_ASC]
          ) {
            max { objectCount payloadSize }
            dimensions { datetime }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: params.accountId,
          start: start.toISOString(),
          end: end.toISOString(),
        },
      }),
      cache: "no-store",
    });

    const json = (await res.json()) as GraphQlResponse;

    if (json.errors?.length) {
      return {
        available: false,
        reason: json.errors[0]?.message ?? "graphql_error",
      };
    }

    const account = json.data?.viewer?.accounts?.[0];
    if (!account) {
      return { available: false, reason: "no_account_data" };
    }

    let classARequests = 0;
    let classBRequests = 0;
    let egressBytes = 0;

    for (const group of account.r2OperationsAdaptiveGroups ?? []) {
      const action = group.dimensions?.actionType ?? "";
      const requests = group.sum?.requests ?? 0;
      const bytes = group.sum?.responseObjectSize ?? 0;
      egressBytes += bytes;
      if (CLASS_A_ACTIONS.has(action)) {
        classARequests += requests;
      } else {
        classBRequests += requests;
      }
    }

    const dailySeries: R2DailySeriesPoint[] = (
      account.r2StorageAdaptiveGroups ?? []
    )
      .map((g) => ({
        date: (g.dimensions?.datetime ?? "").slice(0, 10),
        objects: g.max?.objectCount ?? 0,
        bytes: g.max?.payloadSize ?? 0,
      }))
      .filter((p) => p.date);

    return {
      available: true,
      classARequests,
      classBRequests,
      egressBytes,
      dailySeries,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "analytics_failed";
    return { available: false, reason: message };
  }
}
