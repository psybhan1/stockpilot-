"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, RefreshCw, Search, Upload, X } from "lucide-react";

import {
  clearInventoryImageAction,
  findInventoryImageAction,
  uploadInventoryImageAction,
} from "@/app/actions/product-images";
import { Button } from "@/components/ui/button";

/**
 * Image manager for an inventory item.
 *
 * Cascade logic:
 *   - imageSource="upload" or "ai" → served from /api/inventory/[id]/image
 *   - otherwise prefer the POS catalog image URL
 *   - placeholder as last resort
 */
export function InventoryImageManager({
  itemId,
  itemName,
  imageSource,
  hasStoredBytes,
  posCatalogImageUrl,
}: {
  itemId: string;
  itemName: string;
  imageSource: string | null;
  hasStoredBytes: boolean;
  posCatalogImageUrl: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bust, setBust] = useState(0); // cache-bust after upload/generate
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentSrc = hasStoredBytes
    ? `/api/inventory/${itemId}/image?v=${bust}`
    : posCatalogImageUrl;
  const sourceLabel =
    imageSource === "upload"
      ? "uploaded"
      : imageSource === "web"
        ? "found on web"
        : imageSource === "ai"
          ? "AI generated (legacy)"
          : imageSource === "pos" || posCatalogImageUrl
            ? "from POS"
            : "no image yet";

  function triggerUpload() {
    fileInputRef.current?.click();
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("itemId", itemId);
    formData.set("file", file);
    setErrorMessage(null);
    startTransition(async () => {
      const result = await uploadInventoryImageAction(formData);
      if (!result.ok) {
        setErrorMessage(result.reason);
        return;
      }
      setBust((b) => b + 1);
      router.refresh();
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function findOnWeb() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await findInventoryImageAction(itemId);
      if (!result.ok) {
        setErrorMessage(result.reason);
        return;
      }
      setBust((b) => b + 1);
      router.refresh();
    });
  }

  function clearImage() {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await clearInventoryImageAction(itemId);
      if (!result.ok) {
        setErrorMessage(result.reason);
        return;
      }
      setBust((b) => b + 1);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-card/60 p-4">
      <div className="flex items-start gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-muted/40">
          {currentSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentSrc}
              alt={itemName}
              className="size-full object-cover"
              key={currentSrc}
            />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground/40" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Product image · {sourceLabel}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            StockBuddy finds the real product photo from the web so
            your barista can match the carton on the shelf. Cascade:
            uploaded → web-found → POS catalog → placeholder.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={triggerUpload}
              disabled={isPending}
              className="h-8 gap-1 text-[11px]"
            >
              <Upload className="size-3" />
              Upload
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={findOnWeb}
              disabled={isPending}
              className="h-8 gap-1 bg-violet-500 text-white hover:bg-violet-500/90 text-[11px]"
            >
              <Search className="size-3" />
              {hasStoredBytes ? "Find again" : "Find on web"}
            </Button>
            {hasStoredBytes ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={clearImage}
                disabled={isPending}
                className="h-8 gap-1 text-[11px] text-muted-foreground"
              >
                <X className="size-3" />
                Clear
              </Button>
            ) : null}
            {isPending ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <RefreshCw className="size-3 animate-spin" />
                working…
              </span>
            ) : null}
          </div>
          {errorMessage ? (
            <p className="mt-2 text-[11px] text-red-500">{errorMessage}</p>
          ) : null}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={onFileChosen}
      />
    </div>
  );
}
