"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { AppPage } from "@/components/app/app-page";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query/query-keys";
import { isRestaurantErrorKey } from "./restaurant-errors";
import { RestaurantFormBody } from "./restaurant-form-body";
import { deleteRestaurant } from "./restaurants-actions";
import { useRestaurantDetail } from "./use-restaurants";

const RESTAURANT_FORM_HEIGHT = "h-[calc(100dvh-1.5rem)] min-h-[640px]";

function RestaurantFormSkeleton() {
  return (
    <div
      className={cn(
        "flex animate-pulse flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900",
        RESTAURANT_FORM_HEIGHT,
      )}
    >
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="h-4 w-72 rounded-md bg-muted" />
      <div className="min-h-0 flex-1 rounded-lg bg-muted/60" />
    </div>
  );
}

export function RestaurantFormPage({ restaurantId }: { restaurantId?: string }) {
  const t = useTranslations("pages.restaurants");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const detailQuery = useRestaurantDetail(restaurantId ?? "");
  const restaurant = restaurantId ? (detailQuery.data ?? null) : null;

  const invalidateRestaurants = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.restaurants.all() });
  };

  const handleDelete = async () => {
    if (!restaurant?.id) return;
    setIsPending(true);
    try {
      const result = await deleteRestaurant(restaurant.id);
      if (result.error) {
        toast.error(
          result.error && isRestaurantErrorKey(result.error)
            ? t(`errors.${result.error}`)
            : t("errors.delete_failed"),
        );
        throw new Error(result.error);
      }
      toast.success(t("restaurantDeleted"));
      invalidateRestaurants();
      router.push("/restaurants");
    } finally {
      setIsPending(false);
    }
  };

  if (restaurantId && detailQuery.isLoading) {
    return (
      <AppPage className="!space-y-0">
        <RestaurantFormSkeleton />
      </AppPage>
    );
  }

  if (restaurantId && !detailQuery.isLoading && !restaurant) {
    return (
      <AppPage className="!space-y-0">
        <div
          className={cn(
            "flex items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
            RESTAURANT_FORM_HEIGHT,
          )}
        >
          {t("emptyTitle")}
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage className="!space-y-0">
      <div className={cn("flex flex-col", RESTAURANT_FORM_HEIGHT)}>
        <RestaurantFormBody
          restaurant={restaurant}
          onClose={() => router.push("/restaurants")}
          onSaved={() => {
            invalidateRestaurants();
            router.push("/restaurants");
          }}
          onRequestDelete={() => setDeleteOpen(true)}
        />
      </div>
      {restaurant ? (
        <ConfirmDeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          itemTitle={t("deleteRestaurantTitle")}
          itemName={restaurant.name}
          confirmText={restaurant.name}
          warning={t("deleteRestaurantDescription", { name: restaurant.name })}
          onConfirm={handleDelete}
          isPending={isPending}
        />
      ) : null}
    </AppPage>
  );
}
