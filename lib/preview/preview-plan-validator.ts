import { z } from "zod";

import type { PreviewPlan } from "@/lib/types";

const previewPlanSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  variantLabel: z.string().min(1),
  chapterCount: z.number().min(1),
  chapterTitles: z.array(z.string()),
  representativeAssetIds: z.array(z.string()),
  openingAssetIds: z.array(z.string()),
  endingAssetIds: z.array(z.string()),
  masterTimeline: z.object({
    id: z.string().min(1),
    clips: z.array(z.object({ assetId: z.string().min(1) })).min(1)
  }),
  chapterTimelines: z.array(
    z.object({
      id: z.string().min(1),
      chapterOrder: z.array(z.string()).min(1)
    })
  )
});

export function validatePreviewPlans(previewPlans: PreviewPlan[]) {
  return previewPlans.filter((plan) => previewPlanSchema.safeParse(plan).success);
}
