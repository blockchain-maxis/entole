/**
 * A token colour with an opacity, for the few native APIs (a gradient's stops)
 * that take a colour string and cannot take a class name. The token still
 * comes from the theme; only its alpha is chosen here.
 */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}
