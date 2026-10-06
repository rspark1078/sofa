import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { DiscoveryPreset, SaveDiscoveryPresetInput } from "@sofa/api/schemas";

import { getSetting, setSetting } from "./settings";

const Presets = z.array(DiscoveryPreset).max(50);

export function getDiscoveryPresets(userId: string): z.infer<typeof Presets> {
  const saved = getSetting("user:" + userId + ":discovery-presets");
  if (!saved) return [];
  try {
    const parsed = Presets.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
export function saveDiscoveryPreset(
  userId: string,
  input: z.infer<typeof SaveDiscoveryPresetInput>,
) {
  const validated = SaveDiscoveryPresetInput.parse(input);
  const presets = getDiscoveryPresets(userId);
  if (validated.id && !presets.some((preset) => preset.id === validated.id)) {
    throw new ORPCError("NOT_FOUND");
  }
  if (!validated.id && presets.length >= 50) throw new ORPCError("BAD_REQUEST");
  const preset = { ...validated, id: validated.id ?? Bun.randomUUIDv7() };
  const index = presets.findIndex((existing) => existing.id === preset.id);
  if (index === -1) presets.push(preset);
  else presets[index] = preset;
  setSetting("user:" + userId + ":discovery-presets", JSON.stringify(presets));
  return presets;
}
export function deleteDiscoveryPreset(userId: string, id: string) {
  const presets = getDiscoveryPresets(userId).filter((preset) => preset.id !== id);
  setSetting("user:" + userId + ":discovery-presets", JSON.stringify(presets));
  return presets;
}
