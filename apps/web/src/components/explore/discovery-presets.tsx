import { useLingui } from "@lingui/react/macro";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { discoverSearchSchema, type DiscoverSearch } from "@/components/explore/discover-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { orpc } from "@/lib/orpc/client";

export function DiscoveryPresets({
  filters,
  onLoad,
}: {
  filters: DiscoverSearch;
  onLoad: (filters: DiscoverSearch) => void;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const options = orpc.account.discoveryPresets.queryOptions();
  const { data: presets = [], isPending, isError, refetch } = useQuery(options);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [open, setOpen] = useState(false);
  const save = useMutation(
    orpc.account.saveDiscoveryPreset.mutationOptions({
      onSuccess: (saved, input) => {
        queryClient.setQueryData(options.queryKey, saved);
        setSelectedId(input.id ?? saved.at(-1)?.id);
        toast.success(t`Filters saved`);
      },
      onError: () => toast.error(t`Unable to save filters. You can save up to 50 presets.`),
    }),
  );
  const remove = useMutation(
    orpc.account.deleteDiscoveryPreset.mutationOptions({
      onSuccess: (saved, input) => {
        queryClient.setQueryData(options.queryKey, saved);
        if (selectedId === input.id) {
          setSelectedId(undefined);
          setName("");
        }
        toast.success(t`Saved filters deleted`);
      },
      onError: () => toast.error(t`Unable to delete saved filters`),
    }),
  );
  const busy = save.isPending || remove.isPending;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm">{t`Saved filters`}</Button>} />
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3">
        <p className="text-sm font-medium">{t`Saved Discover filters`}</p>
        {isError ? (
          <Button
            variant="ghost"
            onClick={() => void refetch()}
          >{t`Retry loading saved filters`}</Button>
        ) : (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {presets.map((preset) => {
              const presetName = preset.name;
              return (
                <div key={preset.id} className="flex items-center gap-1">
                  <Button
                    className="min-w-0 flex-1 justify-start truncate"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      onLoad(discoverSearchSchema.parse(preset.filters));
                      setName(preset.name);
                      setSelectedId(preset.id);
                      setOpen(false);
                    }}
                  >
                    {preset.name}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={t`Delete ${presetName}`}
                    onClick={() => remove.mutate({ id: preset.id })}
                  >
                    <IconTrash aria-hidden={true} />
                  </Button>
                </div>
              );
            })}
            {!isPending && presets.length === 0 && (
              <p className="text-muted-foreground">{t`Save your current filters to use them again later.`}</p>
            )}
          </div>
        )}
        <label className="space-y-1">
          <span>{t`Preset name`}</span>
          <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || isPending || !name.trim() || presets.length >= 50}
            onClick={() => save.mutate({ name, filters })}
          >{t`Save new preset`}</Button>
          {selectedId && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !name.trim()}
              onClick={() => save.mutate({ id: selectedId, name, filters })}
            >{t`Update preset`}</Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
