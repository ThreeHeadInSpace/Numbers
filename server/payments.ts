import type { Config } from "./config.js";

export type Payment = {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  paid: boolean;
  test: boolean;
  amount: { value: string; currency: string };
  metadata: { order_id: string };
  confirmation?: { confirmation_url: string };
};
export async function yooRequest(
  config: Config,
  path: string,
  fetcher: typeof fetch,
  body?: unknown,
  key?: string,
): Promise<Payment> {
  const response = await fetcher(`https://api.yookassa.ru/v3/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.paymentSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(key ? { "Idempotence-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("PAYMENT_PROVIDER_ERROR");
  return (await response.json()) as Payment;
}
export function validatePayment(
  config: Config,
  payment: Payment,
  order: { id: string; amount: number; payment_id: string | null },
) {
  if (
    payment.id !== order.payment_id ||
    payment.metadata?.order_id !== order.id ||
    payment.amount?.currency !== "RUB" ||
    payment.amount.value !== (order.amount / 100).toFixed(2)
  )
    throw new Error("PAYMENT_MISMATCH");
  // A real shop cannot charge accidentally while the live switch is off, and test payments never unlock a live order.
  if (payment.test !== !config.livePayments)
    throw new Error("PAYMENT_MODE_MISMATCH");
}
