import type { ForecastContent } from "../server/forecast.js";
export type PublicConfig = {
  price: number;
  paymentMode: string;
  aiMode: string;
  livePayments: boolean;
  demoAuth: boolean;
  providers: Record<string, boolean>;
  legalReady: boolean;
};
export type Order = {
  id: string;
  amount: number;
  status: "pending" | "paid" | "canceled";
  paymentUrl: string | null;
  mode: string;
  start: string;
  end: string;
  createdAt: string;
  paymentError: string | null;
  forecast: {
    id: string;
    status: string;
    mode: string | null;
    error: string | null;
    content: ForecastContent | null;
  } | null;
};
export type Me = {
  user: { name: string; image?: string | null };
  birthDate: string | null;
  orders: Order[];
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      data.error?.message ||
        (typeof data.error === "string" ? data.error : data.message) ||
        (res.status === 429
          ? "Слишком много запросов. Попробуйте через минуту."
          : "Не удалось выполнить запрос. Попробуйте ещё раз."),
      res.status,
    );
  return data;
}
export const money = (kopecks: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(
    new Date(`${date.slice(0, 10)}T12:00:00Z`),
  );
export function telemetry(name: "landing_view" | "purchase_click") {
  const utm = Object.fromEntries(
    [...new URLSearchParams(location.search)].filter(([key]) =>
      key.startsWith("utm_"),
    ),
  );
  void api("/api/events", "POST", { name, utm }).catch(() => {});
}
