import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind classes with clsx, allowing for conditional classes
 * and overriding default component classes seamlessly.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
