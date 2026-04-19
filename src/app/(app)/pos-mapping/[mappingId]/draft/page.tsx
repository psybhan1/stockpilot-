import { notFound } from "next/navigation";

import { RecipeDraftChat } from "@/components/app/recipe-draft-chat";
import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { db } from "@/lib/db";

/**
 * AI-drafted recipe page.
 *
 * The route is a shell that loads the mapping + the catalog server-side
 * and hands them to the client component. The actual drafting call
 * (Groq) and chat editing happen lazily via server actions triggered
 * from the client — we don't auto-draft on page load because a cold
 * LLM call takes 2-5s and the user might just want to read the empty
 * form first.
 */
export default async function PosMappingDraftPage({
  params,
}: {
  params: Promise<{ mappingId: string }>;
}) {
  const session = await requireSession(Role.MANAGER);
  const { mappingId } = await params;

  const mapping = await db.posVariationMapping.findFirst({
    where: { id: mappingId },
    select: {
      id: true,
      mappingStatus: true,
      menuItemVariant: {
        select: {
          name: true,
          menuItem: { select: { name: true, locationId: true } },
        },
      },
      posVariation: {
        select: {
          name: true,
          serviceMode: true,
          catalogItem: { select: { name: true } },
        },
      },
    },
  });

  if (!mapping || mapping.menuItemVariant.menuItem.locationId !== session.locationId) {
    notFound();
  }

  const menuItemName = mapping.menuItemVariant.menuItem.name;
  const variationName =
    mapping.posVariation.name || mapping.posVariation.catalogItem.name;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-500 dark:text-amber-400">
          AI recipe draft
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {variationName || menuItemName}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask StockBuddy to draft a recipe, then tweak it by chatting
          (&ldquo;use oat milk by default&rdquo; · &ldquo;bump coffee to
          20g&rdquo;). Approve when it&apos;s right — a READY recipe
          means the next POS sale auto-depletes inventory.
        </p>
      </header>

      <RecipeDraftChat
        mappingId={mapping.id}
        menuItemName={menuItemName}
        variationName={variationName || menuItemName}
      />
    </div>
  );
}
