import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/lib/orpc/client";

export function ExploreSection() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const options = orpc.account.explorePreferences.queryOptions();
  const { data, isPending } = useQuery(options);
  const mutation = useMutation(
    orpc.account.updateExplorePreferences.mutationOptions({
      onSuccess: (preferences) => queryClient.setQueryData(options.queryKey, preferences),
      onError: () => toast.error(t`Failed to save Explore preferences`),
    }),
  );
  const sections = [
    { key: "trending" as const, label: t`Trending Today` },
    { key: "popularMovies" as const, label: t`Popular Movies` },
    { key: "popularTv" as const, label: t`Popular TV Shows` },
  ];
  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <CardTitle>
            <Trans>Explore sections</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Choose which sections appear on Explore. Discover is always shown.</Trans>
          </CardDescription>
        </div>
        {sections.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <span className="text-sm">{label}</span>
            <Switch
              aria-label={label}
              checked={data?.[key] ?? true}
              disabled={isPending || mutation.isPending}
              onCheckedChange={(checked) => {
                if (data) mutation.mutate({ ...data, [key]: checked });
              }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
