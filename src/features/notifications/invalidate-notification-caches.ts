import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";

export async function invalidateNotificationCaches(
  queryClient: QueryClient,
  input: { campaignId?: string; automationId?: string; templateId?: string } = {},
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all() });
  if (input.campaignId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.detail(input.campaignId),
    });
    await queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.dispatchItems(input.campaignId),
    });
  }
  if (input.automationId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.automationDetail(input.automationId),
    });
  }
  if (input.templateId) {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.templateDetail(input.templateId),
    });
  }
}
