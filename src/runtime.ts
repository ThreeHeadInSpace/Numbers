import { createNavigation } from "./navigation";

export const isStaticDemo = import.meta.env.MODE === "pages-demo";
export const navigation = createNavigation(
  isStaticDemo,
  import.meta.env.BASE_URL,
);
export const appHref = navigation.href;
export const currentPath = () => navigation.path(location);
export const currentSearch = () => navigation.search(location);
