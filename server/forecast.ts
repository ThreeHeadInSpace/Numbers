import { z } from "zod";
import type { Parameters } from "../shared/numerology.js";
import { interpretations } from "../shared/numerology.js";
import type { Config } from "./config.js";

const text = z.string().min(20).max(7000);
export const forecastSchema = z.object({
  theme: text,
  numbers: text,
  work: text,
  relationships: text,
  energy: text,
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        title: z.string().min(2).max(160),
        text,
      }),
    )
    .length(7),
  conclusion: text,
});
export type ForecastContent = z.infer<typeof forecastSchema>;

export function mockForecast(params: Parameters): ForecastContent {
  return {
    theme: `Демонстрационный прогноз. Тема недели — «${interpretations[params.lifePath].title.toLowerCase()}». Попробуйте присмотреться к привычному ритму и выбрать одно намерение на ближайшие семь дней. Этот текст подготовлен локально, без обращения к ИИ.`,
    numbers: `Число жизненного пути ${params.lifePath} здесь используется как символическая отправная точка. ${interpretations[params.lifePath].paragraphs.join(" ")}`,
    work: "Начните неделю с короткого списка важных дел. Выберите задачу, которую можно завершить за один спокойный подход. Оставьте время на неожиданные изменения и оценивайте нагрузку по своим реальным возможностям.",
    relationships:
      "Обратите внимание на качество небольших разговоров. Уточняйте, правильно ли вы поняли собеседника, и говорите о своих желаниях прямо и бережно. Для тёплого общения не нужен особенный повод.",
    energy:
      "Прислушивайтесь к своему состоянию в течение дня. Небольшие паузы, прогулка или спокойный вечер могут стать способом переключиться. Выбирайте то, что подходит именно вам, без обязательных правил.",
    days: params.days.map((day) => ({
      date: day.date,
      title: interpretations[day.personalDay].words[0],
      text: `Символическое число дня — ${day.personalDay}. ${interpretations[day.personalDay].paragraphs[0]} В качестве небольшого эксперимента запишите вечером одно наблюдение, которое захотелось сохранить.`,
    })),
    conclusion:
      "Воспринимайте этот материал как повод для самонаблюдения. Вы можете выбрать одну подходящую идею, а остальное оставить. Решения и темп остаются за вами; числа не определяют события вашей жизни.",
  };
}

export async function generateForecast(
  config: Config,
  params: Parameters,
  fetcher: typeof fetch = fetch,
) {
  if (config.aiMode === "mock") {
    if (config.mockAiFailure) throw new Error("MOCK_API_UNAVAILABLE");
    return mockForecast(params);
  }
  const response = await fetcher("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.aiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(config.aiTimeout),
    body: JSON.stringify({
      model: "deepseek-flash",
      thinking: { type: "disabled" },
      max_tokens: config.aiMaxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Ты пишешь доброжелательную русскую нумерологическую интерпретацию на 7 дней. Это развлекательная символическая практика, не научно доказанный прогноз. Не обещай события, не запугивай, не делай медицинских или финансовых предсказаний, не давай инвестиционных советов. Не запрашивай персональные данные. Пиши конкретно и мягко, без фатализма, 900–1300 слов максимум. Верни только JSON с полями theme (общая тема недели), numbers (интерпретация чисел), work (работа и повседневность), relationships (общение), energy (настроение), days (массив ровно 7 объектов date YYYY-MM-DD, title, text), conclusion. Все текстовые поля — строки без Markdown. Используй только переданные даты периода. На каждый день дай отличающуюся интерпретацию и небольшой необязательный шаг.",
        },
        { role: "user", content: JSON.stringify(params) },
      ],
    }),
  });
  if (!response.ok) throw new Error("AI_PROVIDER_ERROR");
  const data = (await response.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  if (data.choices?.[0]?.finish_reason !== "stop")
    throw new Error("AI_INCOMPLETE");
  const content = forecastSchema.parse(
    JSON.parse(data.choices[0]?.message?.content || "{}"),
  );
  if (content.days.some((day, i) => day.date !== params.days[i].date))
    throw new Error("AI_INVALID_DATES");
  return content;
}
