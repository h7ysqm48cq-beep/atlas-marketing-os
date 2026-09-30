"use client";

import Image from "next/image";
import { forwardRef, type ComponentProps } from "react";

type RuntimeImageProps = Omit<
  ComponentProps<typeof Image>,
  "height" | "width"
> & {
  height?: number;
  width?: number;
};

export const RuntimeImage = forwardRef<HTMLImageElement, RuntimeImageProps>(
  function RuntimeImage(
    { alt, height = 1200, unoptimized = true, width = 1200, ...props },
    ref,
  ) {
    return (
      <Image
        {...props}
        ref={ref}
        alt={alt}
        height={height}
        width={width}
        unoptimized={unoptimized}
      />
    );
  },
);
