"use client";
import { useLayoutEffect, useRef, type ComponentProps } from "react";
/** Keeps long page titles and descriptions readable without a nested scrollbar. */
export function AutosizeTextarea(props: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(field);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} />;
}
