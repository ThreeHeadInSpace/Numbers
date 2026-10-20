import {
  calculateLifePath,
  periodParameters,
  validateBirthDate,
  type Parameters,
} from "../../shared/numerology.js";
import { mockForecast } from "../../shared/mock-forecast.js";
import { ApiError } from "../api-error";
import type { Me, Order, PublicConfig } from "../api";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type DemoOrder = Order & { params: Parameters; requestKey: string };
type DemoState = {
  version: 1;
  signedIn: boolean;
  birthDate: string | null;
  orders: DemoOrder[];
};
const storageKey = "chisla.pages-demo.v1";
const demoConfig: PublicConfig = {
  price: 14900,
  paymentMode: "mock",
  aiMode: "mock",
  livePayments: false,
  demoAuth: true,
  legalReady: false,
  providers: { vk: false, yandex: false, google: false, apple: false },
};

// Pure browser simulation: no fetch, backend imports, OAuth, secrets or database.
export function createDemoApi(
  store: Store,
  now = () => new Date(),
  generationDelay = 450,
) {
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now());
  function seed(): DemoState {
    const date = new Date(`${today()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 7);
    const params = periodParameters(
      "1990-01-01",
      date.toISOString().slice(0, 10),
    );
    return {
      version: 1,
      signedIn: false,
      birthDate: "1990-01-01",
      orders: [
        {
          id: "demo-example-week",
          amount: 14900,
          status: "paid",
          paymentUrl: null,
          mode: "mock",
          start: params.start,
          end: params.end,
          createdAt: `${params.start}T09:00:00Z`,
          paymentError: null,
          params,
          requestKey: "demo-example-week",
          forecast: {
            id: "demo-example-forecast",
            status: "completed",
            mode: "mock",
            error: null,
            content: mockForecast(params),
          },
        },
      ],
    };
  }
  let state = seed();
  try {
    const saved = JSON.parse(
      store.getItem(storageKey) || "null",
    ) as DemoState | null;
    if (
      saved?.version === 1 &&
      typeof saved.signedIn === "boolean" &&
      (saved.birthDate === null || typeof saved.birthDate === "string") &&
      Array.isArray(saved.orders) &&
      saved.orders.every(
        (order) =>
          typeof order.id === "string" &&
          Array.isArray(order.params?.days) &&
          order.params.days.length === 7 &&
          (!order.forecast?.content ||
            Array.isArray(order.forecast.content.days)),
      )
    ) {
      state = saved;
      for (const order of state.orders)
        if (order.forecast?.status === "generating")
          order.forecast.status = "pending";
    }
  } catch {
    /* Unavailable/corrupt storage falls back to in-memory samples. */
  }
  const save = () => {
    try {
      store.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* private browsing */
    }
  };
  const requireUser = () => {
    if (!state.signedIn)
      throw new ApiError("Войдите в демонстрационный кабинет.", 401);
  };
  const publicOrder = ({
    params: _params,
    requestKey: _key,
    ...order
  }: DemoOrder): Order => structuredClone(order);
  function orderById(id: string) {
    const order = state.orders.find((order) => order.id === id);
    if (!order) throw new ApiError("Демонстрационный заказ не найден.", 404);
    return order;
  }
  return async function request(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<unknown> {
    const input = (body && typeof body === "object" ? body : {}) as Record<
      string,
      unknown
    >;
    if (path === "/api/config" && method === "GET")
      return structuredClone(demoConfig);
    if (path === "/api/events" && method === "POST") return { ok: true };
    if (path === "/api/calculate" && method === "POST") {
      try {
        return calculateLifePath(input.birthDate, now());
      } catch (e) {
        throw new ApiError((e as Error).message, 400);
      }
    }
    if (path === "/api/auth/sign-in/anonymous" && method === "POST") {
      state.signedIn = true;
      save();
      return { user: { name: "Исследователь (демо)" } };
    }
    if (path === "/api/auth/sign-in/social")
      throw new ApiError(
        "Настоящий OAuth отключён в публичной демонстрации.",
        400,
      );
    if (path === "/api/auth/sign-out" && method === "POST") {
      state.signedIn = false;
      save();
      return { success: true };
    }
    requireUser();
    if (path === "/api/me" && method === "GET") {
      return {
        user: { name: "Исследователь (демо)" },
        birthDate: state.birthDate,
        orders: state.orders.map(publicOrder),
      } satisfies Me;
    }
    if (path === "/api/profile" && method === "PATCH") {
      try {
        state.birthDate =
          input.birthDate === null
            ? null
            : validateBirthDate(input.birthDate, now());
      } catch (e) {
        throw new ApiError((e as Error).message, 400);
      }
      save();
      return { ok: true };
    }
    if (path === "/api/account" && method === "DELETE") {
      if (input.confirmation !== "УДАЛИТЬ")
        throw new ApiError("Введите УДАЛИТЬ для сброса демоданных.", 400);
      state = seed();
      try {
        store.removeItem(storageKey);
      } catch {
        /* memory only */
      }
      return { success: true };
    }
    if (path === "/api/orders" && method === "POST") {
      if (input.acceptTerms !== true || typeof input.requestKey !== "string")
        throw new ApiError("Подтвердите демонстрационную покупку.", 400);
      let params: Parameters;
      try {
        const birthday = validateBirthDate(input.birthDate, now());
        params = periodParameters(birthday, today());
      } catch (e) {
        throw new ApiError((e as Error).message, 400);
      }
      const existing = state.orders.find(
        (order) =>
          order.requestKey === input.requestKey ||
          (order.status !== "canceled" &&
            JSON.stringify(order.params) === JSON.stringify(params)),
      );
      if (existing) return publicOrder(existing);
      const id = crypto.randomUUID();
      const order: DemoOrder = {
        id,
        amount: demoConfig.price,
        status: "pending",
        paymentUrl: `/checkout/${id}`,
        mode: "mock",
        start: params.start,
        end: params.end,
        createdAt: now().toISOString(),
        paymentError: null,
        params,
        requestKey: input.requestKey,
        forecast: {
          id: crypto.randomUUID(),
          status: "pending",
          mode: "mock",
          error: null,
          content: null,
        },
      };
      state.orders.unshift(order);
      save();
      return publicOrder(order);
    }
    const match =
      /^\/api\/orders\/([^/]+)(?:\/(checkout|sync|mock-payment|generate))?$/.exec(
        path,
      );
    if (match) {
      const order = orderById(match[1]);
      if (!match[2] && method === "GET") return publicOrder(order);
      if (method !== "POST")
        throw new ApiError("Действие недоступно в демонстрации.", 405);
      if (match[2] === "checkout" || match[2] === "sync")
        return publicOrder(order);
      if (match[2] === "mock-payment") {
        if (!["succeeded", "canceled"].includes(String(input.outcome)))
          throw new ApiError("Выберите исход демооплаты.", 400);
        if (order.status === "pending") {
          order.status = input.outcome === "succeeded" ? "paid" : "canceled";
          order.paymentUrl = null;
          save();
        }
        return publicOrder(order);
      }
      if (match[2] === "generate") {
        if (order.status !== "paid")
          throw new ApiError(
            "Сначала подтвердите демонстрационную оплату.",
            403,
          );
        if (
          order.forecast!.status === "completed" ||
          order.forecast!.status === "generating"
        )
          return publicOrder(order);
        order.forecast!.status = "generating";
        save();
        if (generationDelay)
          await new Promise((resolve) => setTimeout(resolve, generationDelay));
        order.forecast!.content = mockForecast(order.params);
        order.forecast!.status = "completed";
        save();
        return publicOrder(order);
      }
    }
    // Fail closed: unsupported routes never fall back to HTTP.
    throw new ApiError("Этот API отключён в статической демонстрации.", 404);
  };
}

let request: ReturnType<typeof createDemoApi> | undefined;
export function demoApi(path: string, method?: string, body?: unknown) {
  request ??= createDemoApi({
    getItem: (key) => sessionStorage.getItem(key),
    setItem: (key, value) => sessionStorage.setItem(key, value),
    removeItem: (key) => sessionStorage.removeItem(key),
  });
  return request(path, method, body);
}
