import { useLingui } from "@lingui/react/macro";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export function HorizontalTitleScroller({
  heading,
  children,
  scrollRef,
  onScrollEnd,
}: {
  heading: string;
  children: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScrollEnd?: () => void;
}) {
  const { t } = useLingui();
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    function update() {
      if (!viewport) return;
      const isRtl = getComputedStyle(viewport).direction === "rtl";
      const position = Math.abs(viewport.scrollLeft);
      const atStart = position <= 1;
      const atEnd = position + viewport.clientWidth >= viewport.scrollWidth - 1;
      setCanScrollLeft(isRtl ? !atEnd : !atStart);
      setCanScrollRight(isRtl ? !atStart : !atEnd);
    }
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    const contentObserver = new MutationObserver(update);
    contentObserver.observe(viewport, { childList: true, subtree: true });
    return () => {
      viewport.removeEventListener("scroll", update);
      observer.disconnect();
      contentObserver.disconnect();
    };
  }, [scrollRef]);

  function scroll(direction: number) {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      left: direction * Math.max(160, viewport.clientWidth * 0.8),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex justify-end gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label={`${heading}: ${t`Scroll left`}`}
          disabled={!canScrollLeft}
          onClick={() => scroll(-1)}
        >
          <IconChevronLeft aria-hidden={true} />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label={`${heading}: ${t`Scroll right`}`}
          disabled={!canScrollRight}
          onClick={() => scroll(1)}
        >
          <IconChevronRight aria-hidden={true} />
        </Button>
      </div>
      <ScrollArea
        scrollFade={false}
        scrollbarGutter
        alwaysShowScrollbar
        scrollRef={scrollRef}
        onScrollEnd={onScrollEnd}
      >
        {children}
      </ScrollArea>
    </div>
  );
}
