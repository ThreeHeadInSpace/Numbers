export type RouteLocation = Pick<Location, "pathname" | "search" | "hash">;

// GitHub Pages serves only files: hash routes keep reloads and shared links on index.html.
export function createNavigation(demo: boolean, base = "/") {
  return {
    href(path: string) {
      if (!demo || !path.startsWith("/") || path.startsWith("//")) return path;
      if (path === "/") return base;
      if (path.startsWith("/#")) return `${base}${path.slice(1)}`;
      return `${base}#${path}`;
    },
    path(location: RouteLocation) {
      if (!demo) return location.pathname;
      return location.hash.startsWith("#/")
        ? new URL(location.hash.slice(1), "https://demo.invalid").pathname
        : "/";
    },
    search(location: RouteLocation) {
      if (!demo) return location.search;
      return location.hash.startsWith("#/")
        ? new URL(location.hash.slice(1), "https://demo.invalid").search
        : location.search;
    },
  };
}
