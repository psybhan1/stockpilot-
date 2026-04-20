import { Role } from "@/lib/domain-enums";
import { requireSession } from "@/modules/auth/session";
import { db } from "@/lib/db";
import { PhotoCountClient } from "@/components/app/photo-count-client";

export const dynamic = "force-dynamic";

export default async function PhotoCountPage() {
  const session = await requireSession(Role.STAFF);
  // Grab the 30 items most at risk (below or near par) so the user
  // gets the most-useful shortlist without having to scroll.
  const items = await db.inventoryItem.findMany({
    where: { locationId: session.locationId },
    select: {
      id: true,
      name: true,
      displayUnit: true,
      stockOnHandBase: true,
      parLevelBase: true,
      packSizeBase: true,
      baseUnit: true,
    },
    orderBy: { name: "asc" },
    take: 200,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Count · photo mode
        </p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Point, shoot, confirm.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Take a photo of a shelf or storage area, pick which items are in frame,
          and StockPilot counts them for you. Tap each result to confirm or edit,
          then apply to update stock.
        </p>
      </div>

      <PhotoCountClient items={items} />
    </div>
  );
}
