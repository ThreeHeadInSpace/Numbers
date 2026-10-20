-- All-time event funnel, not a user cohort. Never includes birthdays, names, or email.
WITH steps(position, name, label) AS (
  VALUES (1,'landing_view','Посещение'),(2,'calculation_started','Запуск расчёта'),
  (3,'free_result','Бесплатный результат'),(4,'purchase_click','Нажатие покупки'),
  (5,'order_created','Создан заказ'),(6,'payment_succeeded','Оплата подтверждена'),
  (7,'generation_succeeded','Прогноз готов')
), totals AS (
  SELECT steps.position,steps.label,COUNT(events.id) AS events,
    COUNT(DISTINCT events.visitor_id) AS visitors,
    COUNT(DISTINCT events.order_id) AS orders
  FROM steps LEFT JOIN events ON events.name=steps.name
  GROUP BY steps.position,steps.label
)
SELECT label,events,visitors,orders,
  ROUND(100.0 * visitors / NULLIF((SELECT visitors FROM totals WHERE position=1),0),1) AS percent_of_landing_visitors
FROM totals ORDER BY position;
