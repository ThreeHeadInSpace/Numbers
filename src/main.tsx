import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  ApiError,
  dateLabel,
  money,
  telemetry,
  type Me,
  type Order,
  type PublicConfig,
} from "./api";
import type { FreeResult } from "../shared/numerology";
import type { ForecastContent } from "../server/forecast";
import { legalPages } from "./legal";
import { appHref, currentPath, currentSearch, isStaticDemo } from "./runtime";
import "./styles.css";

function Star({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 1v38M1 20h38M6.5 6.5l27 27M6.5 33.5l27-27"
        stroke="currentColor"
        strokeWidth="1"
      />
      <circle cx="20" cy="20" r="8" fill="currentColor" />
      <circle cx="20" cy="20" r="3" fill="var(--bg)" />
    </svg>
  );
}
const Arrow = () => <span aria-hidden="true">↗</span>;
function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
function BirthInput({
  value,
  onChange,
  label = "Дата рождения",
}: {
  value: string;
  onChange: (s: string) => void;
  label?: string;
}) {
  return (
    <label className="date-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="date"
        value={value}
        onInput={(e) => onChange(e.currentTarget.value)}
        onChange={(e) => onChange(e.target.value)}
        min="1900-01-01"
        max={new Date().toISOString().slice(0, 10)}
        required
      />
    </label>
  );
}
function Celestial() {
  return (
    <div className="celestial" aria-hidden="true">
      <div className="celestial-top">
        <span>У КАЖДОГО</span>
        <Star />
        <span>СВОЙ РИТМ</span>
      </div>
      <div className="orbit orbit-outer" />
      <div className="orbit orbit-mid" />
      <div className="orbit orbit-inner" />
      <div className="orbit-line diagonal-a" />
      <div className="orbit-line diagonal-b" />
      <span className="chart-mark mark-one">I</span>
      <span className="chart-mark mark-two">XI</span>
      <span className="chart-mark mark-three">XXII</span>
      <span className="chart-mark mark-four">XXXIII</span>
      <Star className="chart-star star-one" />
      <Star className="chart-star star-two" />
      <span className="orbit-dot" />
      <div className="number-disc">
        <span className="disc-label">ВНУТРЕННИЙ КОМПАС</span>
        <span className="hero-number">7</span>
        <span className="disc-bottom">СМЫСЛ ВНУТРИ ВАС</span>
      </div>
      <div className="celestial-bottom">
        <span>ДАТА</span>
        <i />
        <span>ЧИСЛО</span>
        <i />
        <span>ВЫ</span>
      </div>
    </div>
  );
}

function LoginDialog({
  config,
  onClose,
  onDone,
}: {
  config: PublicConfig;
  onClose: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  async function login(provider: string) {
    setBusy(provider);
    setError("");
    try {
      if (provider === "demo") {
        await api("/api/auth/sign-in/anonymous", "POST", {});
        onDone();
        return;
      }
      const result = await api<{ url?: string }>(
        "/api/auth/sign-in/social",
        "POST",
        {
          provider,
          callbackURL: `${location.origin}/account`,
          errorCallbackURL: `${location.origin}/account?auth_error=1`,
        },
      );
      if (!result.url) throw new Error("Провайдер не вернул адрес входа.");
      location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <dialog ref={ref} className="login-dialog" onCancel={onClose}>
      <button className="close-button" onClick={onClose} aria-label="Закрыть">
        ×
      </button>
      <Star />
      <p className="eyebrow">ВАШЕ ПРОСТРАНСТВО</p>
      <h2>Сохраните свой ритм</h2>
      <p className="muted">
        Войдите, чтобы получить подробный прогноз и вернуться к нему в любое
        время.
      </p>
      <div className="provider-list">
        {[
          ["vk", "VK ID", "VK"],
          ["yandex", "Яндекс ID", "Я"],
          ["google", "Google", "G"],
          ...(config.providers.apple ? [["apple", "Apple", "●"]] : []),
        ].map(([id, name, icon]) => (
          <button
            key={id}
            disabled={!config.providers[id] || !!busy}
            onClick={() => void login(id)}
            className="provider-button"
          >
            <span className={`provider-icon ${id}`}>{icon}</span>
            <span>Войти через {name}</span>
            <small>{!config.providers[id] ? "Не подключён" : "→"}</small>
          </button>
        ))}
      </div>
      {config.demoAuth && (
        <div className="demo-login">
          <p>
            {isStaticDemo
              ? "Визуальная демонстрация — без регистрации и списаний."
              : "Локальный деморежим — без регистрации и списаний."}
          </p>
          <button
            className="button secondary full"
            disabled={!!busy}
            onClick={() => void login("demo")}
          >
            {busy === "demo" ? "Входим…" : "Попробовать демо-вход"}
            <Arrow />
          </button>
        </div>
      )}
      {!Object.values(config.providers).some(Boolean) && !config.demoAuth && (
        <Notice>
          Вход появится после подключения OAuth владельцем сервиса.
        </Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      <p className="fine">
        Продолжая вход, вы принимаете{" "}
        <a href={appHref("/legal/agreement")}>соглашение</a> и ознакомлены с{" "}
        <a href={appHref("/legal/privacy")}>политикой обработки данных</a>.
      </p>
    </dialog>
  );
}

function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [path, setPath] = useState(currentPath());
  const [birthDate, setBirthDate] = useState(
    () => sessionStorage.getItem("chisla_birth") || "",
  );
  const [result, setResult] = useState<FreeResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [buying, setBuying] = useState(false);
  const [terms, setTerms] = useState(false);
  const resultRef = useRef<HTMLElement>(null);
  const navigate = useCallback((url: string) => {
    history.pushState({}, "", appHref(url));
    setPath(currentPath());
    window.scrollTo(0, 0);
  }, []);
  const refreshMe = useCallback(async () => {
    try {
      const data = await api<Me>("/api/me");
      setMe(data);
      return data;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        return null;
      }
      throw e;
    } finally {
      setAuthLoading(false);
    }
  }, []);
  useEffect(() => {
    void api<PublicConfig>("/api/config")
      .then(setConfig)
      .catch(() =>
        setConfigError("Не удалось подключиться к серверу. Обновите страницу."),
      );
    void refreshMe().catch(() =>
      setError("Не удалось проверить вход. Обновите страницу."),
    );
    const listener = () => {
      setPath(currentPath());
      setError("");
    };
    window.addEventListener("popstate", listener);
    window.addEventListener("hashchange", listener);
    if (currentPath() === "/") telemetry("landing_view");
    return () => {
      window.removeEventListener("popstate", listener);
      window.removeEventListener("hashchange", listener);
    };
  }, [refreshMe]);
  useEffect(() => {
    if (birthDate) sessionStorage.setItem("chisla_birth", birthDate);
    else sessionStorage.removeItem("chisla_birth");
  }, [birthDate]);
  useEffect(() => {
    if (path === "/account")
      void refreshMe().catch((e) => setError((e as Error).message));
    if (isStaticDemo && path === "/" && /^#[a-z-]+$/.test(location.hash)) {
      const frame = requestAnimationFrame(() =>
        document.getElementById(location.hash.slice(1))?.scrollIntoView(),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [path, refreshMe]);
  async function calculate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setCalculating(true);
    try {
      const data = await api<FreeResult>("/api/calculate", "POST", {
        birthDate,
      });
      setResult(data);
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
            block: "start",
          }),
        30,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCalculating(false);
    }
  }
  function startPurchase() {
    telemetry("purchase_click");
    if (!birthDate || !result) {
      document
        .getElementById("calculator")
        ?.scrollIntoView({ behavior: "smooth" });
      document
        .querySelector<HTMLInputElement>("#calculator input")
        ?.focus({ preventScroll: true });
      return;
    }
    sessionStorage.setItem(
      "chisla_purchase",
      JSON.stringify({ birthDate, requestKey: crypto.randomUUID() }),
    );
    if (!me) setLoginOpen(true);
    else navigate("/account?purchase=1");
  }
  async function confirmPurchase() {
    setError("");
    setBuying(true);
    try {
      const pending = JSON.parse(
        sessionStorage.getItem("chisla_purchase") || "{}",
      ) as { birthDate?: string; requestKey?: string };
      const order = await api<Order>("/api/orders", "POST", {
        birthDate: pending.birthDate || birthDate,
        requestKey: pending.requestKey || crypto.randomUUID(),
        acceptTerms: terms,
      });
      sessionStorage.removeItem("chisla_purchase");
      if (order.paymentUrl) {
        location.assign(appHref(order.paymentUrl));
        return;
      }
      await refreshMe();
      navigate(`/forecast/${order.id}`);
    } catch (e) {
      setError((e as Error).message);
      void refreshMe();
    } finally {
      setBuying(false);
    }
  }
  async function logout() {
    try {
      await api("/api/auth/sign-out", "POST", {});
      setMe(null);
      sessionStorage.removeItem("chisla_purchase");
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const legalId = path.startsWith("/legal/") ? path.split("/")[2] : null;
  const isHome = path === "/";
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          if (isStaticDemo) {
            e.preventDefault();
            document.getElementById("main")?.focus();
            document.getElementById("main")?.scrollIntoView();
          }
        }}
      >
        К содержанию
      </a>
      <header className="site-header">
        <a
          href={appHref("/")}
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <Star />
          <span>числа</span>
        </a>
        <nav aria-label="Главная навигация">
          <a href={appHref("/#how")}>Как это работает</a>
          <a href={appHref("/#weekly")}>Прогноз на неделю</a>
          <a href={appHref("/#faq")}>Вопросы</a>
        </nav>
        <button
          className="header-login"
          onClick={() => (me ? navigate("/account") : setLoginOpen(true))}
        >
          {me ? "Личный кабинет" : "Войти"}
          <span aria-hidden="true">↗</span>
        </button>
      </header>
      {config && (config.paymentMode === "mock" || !config.livePayments) && (
        <div className="demo-bar">
          <span className="status-dot" />
          {isStaticDemo
            ? "Визуальное демо · Данные только в этом браузере · Оплата без списаний"
            : config.paymentMode === "mock"
              ? "Деморежим · Оплата без списаний"
              : "Тестовый магазин ЮKassa · Реальные списания отключены"}
          {!isStaticDemo &&
            config.aiMode === "mock" &&
            " · Локальный пример прогноза"}
        </div>
      )}
      <main id="main" tabIndex={-1}>
        {configError && (
          <div className="container">
            <Notice error>{configError}</Notice>
          </div>
        )}
        {isHome ? (
          <>
            <section className="hero container" id="calculator">
              <div className="hero-copy">
                <p className="eyebrow">
                  <span className="small-line" /> НЕМНОГО БЛИЖЕ К СЕБЕ
                </p>
                <h1>
                  У жизни есть ритм.
                  <br />
                  <em>У вас — свой.</em>
                </h1>
                <p className="hero-description">
                  Ваша дата рождения — начало истории.
                  <br className="desktop-break" /> Узнайте своё число и
                  посмотрите на себя
                  <br className="desktop-break" /> с новой, неожиданной стороны.
                </p>
                <form onSubmit={calculate} className="calculator-form">
                  <BirthInput
                    value={birthDate}
                    onChange={(value) => {
                      setBirthDate(value);
                      setResult(null);
                    }}
                  />
                  <button
                    className="button primary"
                    type="submit"
                    disabled={calculating}
                  >
                    {calculating ? "Считаем…" : "Узнать своё число"}
                    <Arrow />
                  </button>
                </form>
                <p className="form-note">
                  <span aria-hidden="true">✧</span> Бесплатно. Без регистрации.
                  Только ваша дата.
                </p>
                {error && <Notice error>{error}</Notice>}
                <div className="hero-footnote">
                  <span className="tiny-star">✳</span>
                  <p>
                    Не предсказываем судьбу.
                    <br />
                    <span>Предлагаем повод прислушаться к себе.</span>
                  </p>
                </div>
              </div>
              <Celestial />
            </section>
            <div className="intro-rule container">
              <span>СИМВОЛЫ. СМЫСЛЫ. ВОЗМОЖНОСТИ.</span>
              <span>
                Всё начинается с одного числа <span aria-hidden="true">↓</span>
              </span>
            </div>
            {result && (
              <section
                ref={resultRef}
                className="free-result container"
                id="result"
                tabIndex={-1}
              >
                <div className="result-number">
                  <p className="eyebrow">ВАШЕ ЧИСЛО ЖИЗНЕННОГО ПУТИ</p>
                  <span>{result.number}</span>
                  <small>
                    {result.isMaster
                      ? "Мастер-число"
                      : "Ваша символическая отправная точка"}
                  </small>
                </div>
                <div className="result-text">
                  <p className="eyebrow">{result.essence}</p>
                  <h2>{result.title}</h2>
                  {result.paragraphs.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                  <details>
                    <summary>Как получилось это число?</summary>
                    <p>{result.explanation}</p>
                    <p>
                      Используем сокращение дня, месяца и года по отдельности.
                      Мастер-числа 11, 22 и 33 сохраняем на каждом этапе. В
                      других школах алгоритм может отличаться.
                    </p>
                  </details>
                  <button className="text-link" onClick={startPurchase}>
                    А что приготовит ваша неделя?
                    <Arrow />
                  </button>
                </div>
              </section>
            )}
            <section className="how-section container" id="how">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">ПРОСТАЯ ПРАКТИКА САМОНАБЛЮДЕНИЯ</p>
                  <h2>
                    Не ответы на всё.
                    <br />
                    <em>Новый угол зрения.</em>
                  </h2>
                </div>
                <p>
                  Нумерология работает с символами чисел.
                  <br />
                  Используйте их как приглашение к размышлению,
                  <br />а важные решения принимайте сами.
                </p>
              </div>
              <div className="steps">
                {[
                  [
                    "01",
                    "Ваша дата",
                    "Никаких длинных анкет. День, месяц и год рождения — всё, что нужно для начала.",
                    "⌁",
                  ],
                  [
                    "02",
                    "Ваше число",
                    "Понятный расчёт, сильные стороны и темы для размышления. Бесплатно и сразу.",
                    "✳",
                  ],
                  [
                    "03",
                    "Ваши семь дней",
                    "Если захочется глубже — персональная интерпретация недели в вашем кабинете.",
                    "◷",
                  ],
                ].map(([num, title, text, icon]) => (
                  <article className="step" key={num}>
                    <div className="step-top">
                      <span>{num}</span>
                      <span className="step-icon" aria-hidden="true">
                        {icon}
                      </span>
                    </div>
                    <h3>{title}</h3>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
            </section>
            <section className="weekly-section container" id="weekly">
              <div className="weekly-copy">
                <p className="eyebrow">ВАША НЕДЕЛЯ В ДЕТАЛЯХ</p>
                <h2>
                  Семь дней.
                  <br />
                  <em>Больше ясности.</em>
                </h2>
                <p>
                  Не готовый сценарий, а бережный ориентир.
                  <br />
                  Персональный прогноз поможет заметить темы,
                  <br />
                  на которые хочется обратить внимание.
                </p>
                <ul className="week-features">
                  <li>
                    <span>✧</span> Общая тема недели и ваши числа
                  </li>
                  <li>
                    <span>✧</span> Работа, отношения, энергия и настроение
                  </li>
                  <li>
                    <span>✧</span> Отдельная интерпретация каждого дня
                  </li>
                  <li>
                    <span>✧</span> Сохраняется в личном кабинете
                  </li>
                </ul>
                <div className="price-row">
                  <strong>{config ? money(config.price) : "149 ₽"}</strong>
                  <span>
                    Один прогноз на 7 дней.
                    <br />
                    Без подписки и автосписаний.
                  </span>
                </div>
                <button
                  className="button light"
                  onClick={startPurchase}
                  disabled={!config}
                >
                  Получить полный прогноз
                  <Arrow />
                </button>
                <p className="fine">
                  Оплата через ЮKassa. Подготовка с помощью ИИ.
                </p>
              </div>
              <div className="week-preview">
                <div className="preview-top">
                  <span>ВАШ ЛИЧНЫЙ РИТМ</span>
                  <Star />
                </div>
                <div className="preview-title">
                  Маленькие шаги.
                  <br />
                  <em>Важные открытия.</em>
                </div>
                <p className="preview-subtitle">
                  Пример оформления · не персональный прогноз
                </p>
                <div className="week-days">
                  {["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"].map((day, i) => (
                    <div key={day} className={i === 2 ? "selected" : ""}>
                      <span>{day}</span>
                      <b>{[1, 2, 3, 4, 5, 6, 7][i]}</b>
                    </div>
                  ))}
                </div>
                <div className="preview-content">
                  <span className="eyebrow">
                    СРЕДА · ПРОСТРАНСТВО ДЛЯ НОВОГО
                  </span>
                  <h3>Дайте идее немного воздуха</h3>
                  <p>
                    Иногда достаточно изменить привычный маршрут, чтобы увидеть
                    больше возможностей. Оставьте сегодня место любопытству.
                  </p>
                  <div className="preview-tags">
                    <span>Творчество</span>
                    <span>Общение</span>
                  </div>
                </div>
                <div className="preview-bottom">
                  <span>✧</span> Подсказка, которую можно взять с собой
                </div>
              </div>
            </section>
            <section className="faq-section container" id="faq">
              <div>
                <p className="eyebrow">БЕЗ ЛИШНЕЙ ТАИНСТВЕННОСТИ</p>
                <h2>
                  Возможно,
                  <br />
                  <em>вам интересно.</em>
                </h2>
              </div>
              <div className="faq-list">
                {[
                  [
                    "Это научный прогноз?",
                    "Нет. Нумерология — символическая практика, а не научно доказанный способ предсказывать будущее. Наши материалы — для развлечения и самонаблюдения, без обещаний и категоричных выводов.",
                  ],
                  [
                    "Как считается число жизненного пути?",
                    "Мы сокращаем день, месяц и год по отдельности, сохраняя мастер-числа 11, 22 и 33. Затем складываем результаты и сокращаем сумму по тому же правилу. Под бесплатным результатом вы увидите все шаги.",
                  ],
                  [
                    "Что входит в 149 рублей?",
                    "Одна персональная интерпретация на семь дней с даты создания заказа по московскому времени. Тема недели, ваши числа, работа, отношения, настроение и каждый день отдельно. Подписок нет.",
                  ],
                  [
                    "Кто пишет подробный прогноз?",
                    "DeepSeek получает вычисленные числа и период прогноза. Мы не передаём ему ваше имя, email, ID аккаунта или полную дату рождения. Бесплатная интерпретация собирается из локальных шаблонов.",
                  ],
                  [
                    "А если после оплаты возникнет ошибка?",
                    "Заказ останется оплаченным. Вы сможете повторить генерацию из личного кабинета без доплаты. Готовый прогноз сохраняется — повторно платить или генерировать его не нужно.",
                  ],
                ].map(([q, a]) => (
                  <details key={q}>
                    <summary>
                      {q}
                      <span aria-hidden="true">+</span>
                    </summary>
                    <p>{a}</p>
                  </details>
                ))}
              </div>
            </section>
          </>
        ) : legalId ? (
          <LegalPage id={legalId} draft={!config?.legalReady} />
        ) : path === "/account" ? (
          <div className="container page">
            <p className="eyebrow">ВАШЕ ПРОСТРАНСТВО</p>
            <h1 className="page-title">
              {me
                ? `Здравствуйте${me.user.name ? `, ${me.user.name}` : ""}.`
                : "Личный кабинет"}
            </h1>
            {authLoading ? (
              <p>Проверяем вход…</p>
            ) : !me ? (
              <div className="empty-card">
                <Star />
                <h2>Ваша история начинается здесь</h2>
                <p>
                  Войдите, чтобы сохранить дату рождения и получить доступ к
                  своим прогнозам.
                </p>
                {new URLSearchParams(currentSearch()).has("auth_error") && (
                  <Notice error>
                    Не удалось войти через провайдера. Проверьте доступ к
                    аккаунту или выберите другой способ.
                  </Notice>
                )}
                <button
                  className="button primary"
                  onClick={() => setLoginOpen(true)}
                >
                  Войти в кабинет
                  <Arrow />
                </button>
              </div>
            ) : (
              <>
                {sessionStorage.getItem("chisla_purchase") && (
                  <section className="purchase-confirm">
                    <div>
                      <p className="eyebrow">ОДИН ШАГ ДО ВАШЕЙ НЕДЕЛИ</p>
                      <h2>Персональный прогноз на 7 дней</h2>
                      <p>
                        {money(config?.price || 14900)} · разовый платёж · дата
                        рождения{" "}
                        {dateLabel(
                          JSON.parse(sessionStorage.getItem("chisla_purchase")!)
                            .birthDate,
                        )}{" "}
                        {JSON.parse(
                          sessionStorage.getItem("chisla_purchase")!,
                        ).birthDate.slice(0, 4)}
                      </p>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={terms}
                          onChange={(e) => setTerms(e.target.checked)}
                        />
                        <span>
                          Принимаю{" "}
                          <a
                            href={appHref("/legal/service")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            условия платной услуги
                          </a>{" "}
                          и{" "}
                          <a
                            href={appHref("/legal/agreement")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            соглашение
                          </a>
                          ; ознакомлен с{" "}
                          <a
                            href={appHref("/legal/privacy")}
                            target="_blank"
                            rel="noreferrer"
                          >
                            политикой обработки данных
                          </a>
                          .
                        </span>
                      </label>
                    </div>
                    <div className="purchase-actions">
                      <button
                        className="button primary"
                        onClick={() => void confirmPurchase()}
                        disabled={!terms || buying}
                      >
                        {buying
                          ? "Создаём заказ…"
                          : config?.paymentMode === "mock"
                            ? "К демооплате"
                            : "Перейти к оплате"}
                        <Arrow />
                      </button>
                      <button
                        className="text-link"
                        onClick={() => {
                          sessionStorage.removeItem("chisla_purchase");
                          navigate("/account");
                        }}
                      >
                        Отложить покупку
                      </button>
                    </div>
                  </section>
                )}
                <Account
                  me={me}
                  config={config}
                  refresh={refreshMe}
                  navigate={navigate}
                  logout={logout}
                  onDeleted={() => {
                    setMe(null);
                    setBirthDate("");
                    setResult(null);
                    sessionStorage.clear();
                    navigate("/");
                  }}
                />
              </>
            )}
            {error && <Notice error>{error}</Notice>}
          </div>
        ) : path.startsWith("/checkout/") ? (
          <Checkout
            id={path.split("/")[2]}
            config={config}
            navigate={navigate}
            onLogin={() => setLoginOpen(true)}
          />
        ) : path.startsWith("/forecast/") ? (
          <ForecastPage
            id={path.split("/")[2]}
            navigate={navigate}
            onLogin={() => setLoginOpen(true)}
          />
        ) : (
          <div className="container page empty-card">
            <h1>Эта страница не найдена</h1>
            <a className="button primary" href={appHref("/")}>
              На главную
              <Arrow />
            </a>
          </div>
        )}
      </main>
      <footer className="site-footer container">
        <div className="footer-main">
          <a href={appHref("/")} className="brand">
            <Star />
            <span>числа</span>
          </a>
          <p>
            У каждого свой ритм.
            <br />
            Найдите время прислушаться.
          </p>
          <div className="footer-links">
            <a href={appHref("/legal/privacy")}>Политика обработки данных</a>
            <a href={appHref("/legal/agreement")}>
              Пользовательское соглашение
            </a>
            <a href={appHref("/legal/service")}>Условия платной услуги</a>
            <a href={appHref("/legal/contacts")}>Контакты и возвраты</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Числа</span>
          <p>
            Развлекательные интерпретации. Нумерология не является научным
            методом прогнозирования.
          </p>
          <span>
            С вниманием к вам <span aria-hidden="true">✧</span>
          </span>
        </div>
      </footer>
      {loginOpen && config && (
        <LoginDialog
          config={config}
          onClose={() => setLoginOpen(false)}
          onDone={() => {
            setLoginOpen(false);
            void refreshMe()
              .then(() => navigate("/account"))
              .catch((e) => setError((e as Error).message));
          }}
        />
      )}
    </>
  );
}

function Account({
  me,
  config,
  refresh,
  navigate,
  logout,
  onDeleted,
}: {
  me: Me;
  config: PublicConfig | null;
  refresh: () => Promise<Me | null>;
  navigate: (s: string) => void;
  logout: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [birthday, setBirthday] = useState(me.birthDate || "");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    const id = new URLSearchParams(currentSearch()).get("order");
    if (id)
      void api(`/api/orders/${id}/sync`, "POST", {})
        .then(refresh)
        .catch((e) => setError((e as Error).message));
  }, [refresh]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("profile");
    setError("");
    try {
      await api("/api/profile", "PATCH", { birthDate: birthday || null });
      await refresh();
      setMessage(birthday ? "Дата сохранена." : "Дата удалена.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function action(order: Order, type: "sync" | "checkout") {
    setBusy(order.id);
    setError("");
    try {
      const data = await api<Order>(
        `/api/orders/${order.id}/${type}`,
        "POST",
        {},
      );
      if (type === "checkout" && data.paymentUrl)
        location.assign(appHref(data.paymentUrl));
      else await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function deleteAccount() {
    setBusy("delete");
    setError("");
    try {
      await api("/api/account", "DELETE", { confirmation });
      onDeleted();
    } catch (e) {
      setError(
        (e as Error).message +
          " Если сессия устарела, выйдите и войдите снова.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="account-grid">
        <section className="profile-card">
          <p className="eyebrow">ВАШ ПРОФИЛЬ</p>
          <h2>Знакомая дата</h2>
          <p>Сохраните её, если хотите. Для покупки это необязательно.</p>
          <form onSubmit={save}>
            <BirthInput value={birthday} onChange={setBirthday} />
            <button className="button secondary full" disabled={!!busy}>
              Сохранить дату
              <Arrow />
            </button>
          </form>
          {me.birthDate && (
            <button
              className="text-link"
              onClick={() => {
                setBirthday("");
                void api("/api/profile", "PATCH", { birthDate: null })
                  .then(refresh)
                  .then(() => setMessage("Дата удалена."))
                  .catch((e) => setError((e as Error).message));
              }}
            >
              Удалить сохранённую дату
            </button>
          )}
          <button className="text-link" onClick={() => void logout()}>
            Выйти из аккаунта →
          </button>
        </section>
        <section className="history">
          <div className="history-heading">
            <h2>Мои прогнозы</h2>
            <span>{me.orders.length.toString().padStart(2, "0")}</span>
          </div>
          {!me.orders.length ? (
            <div className="empty-card">
              <Star />
              <h3>Впереди — ваша первая неделя</h3>
              <p>
                Начните с бесплатного расчёта, а затем решите, хочется ли узнать
                больше.
              </p>
              <button
                className="button secondary"
                onClick={() => navigate("/")}
              >
                Узнать своё число
                <Arrow />
              </button>
            </div>
          ) : (
            me.orders.map((order) => (
              <article className="order-card" key={order.id}>
                <div className="order-top">
                  <span className={`badge ${order.status}`}>
                    {order.status === "paid"
                      ? order.forecast?.status === "completed"
                        ? "Прогноз готов"
                        : "Оплачено"
                      : order.status === "canceled"
                        ? "Отменён"
                        : "Ожидает оплаты"}
                  </span>
                  <span>{money(order.amount)}</span>
                </div>
                <h3>
                  {dateLabel(order.start)} — {dateLabel(order.end)}
                </h3>
                <p>
                  Персональный прогноз на 7 дней{" "}
                  {order.mode === "mock" && "· Демо"}
                </p>
                <small className="order-id">Заказ {order.id}</small>
                {order.paymentError && (
                  <Notice error>{order.paymentError}</Notice>
                )}
                <div className="order-actions">
                  {order.status === "paid" ? (
                    <button
                      className="button secondary"
                      onClick={() => navigate(`/forecast/${order.id}`)}
                    >
                      {order.forecast?.status === "completed"
                        ? "Открыть прогноз"
                        : order.forecast?.status === "failed"
                          ? "Повторить бесплатно"
                          : "Подготовить прогноз"}
                      <Arrow />
                    </button>
                  ) : order.status === "pending" ? (
                    <>
                      <button
                        className="button primary"
                        disabled={!!busy}
                        onClick={() => void action(order, "checkout")}
                      >
                        Продолжить оплату
                        <Arrow />
                      </button>
                      <button
                        className="text-link"
                        disabled={!!busy}
                        onClick={() => void action(order, "sync")}
                      >
                        Проверить оплату
                      </button>
                    </>
                  ) : (
                    <button className="text-link" onClick={() => navigate("/")}>
                      Начать новый расчёт
                      <Arrow />
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      </div>
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
      <section className="account-delete">
        <details
          open={deleting || undefined}
          onToggle={(e) => setDeleting(e.currentTarget.open)}
        >
          <summary>Управление данными и удаление аккаунта</summary>
          <p>
            Удалятся сессии, OAuth-аккаунты, сохранённая дата и прогнозы.
            Обезличенные записи реальных платежей сохраняются для учётных
            обязательств. Действие нельзя отменить.
          </p>
          <label>
            Введите УДАЛИТЬ
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className="button danger"
            disabled={confirmation !== "УДАЛИТЬ" || !!busy}
            onClick={() => void deleteAccount()}
          >
            Удалить мой аккаунт
          </button>
        </details>
      </section>
      {config?.demoAuth && (
        <p className="fine">
          {isStaticDemo
            ? "Это тестовые данные в текущей вкладке браузера. Демо-вход снова откроет этот пример; OAuth и база данных не используются."
            : "Демо-аккаунт привязан к текущему браузеру. После выхода для него нет способа повторного входа."}
        </p>
      )}
    </>
  );
}

function Checkout({
  id,
  config,
  navigate,
  onLogin,
}: {
  id: string;
  config: PublicConfig | null;
  navigate: (s: string) => void;
  onLogin: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<Order>(`/api/orders/${id}`)
      .then(setOrder)
      .catch((e) => {
        setError(e.message);
        setUnauthorized(e.status === 401);
      });
  }, [id]);
  async function pay(outcome: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/orders/${id}/mock-payment`, "POST", { outcome });
      navigate(outcome === "succeeded" ? `/forecast/${id}` : "/account");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container page checkout-page">
      <div className="checkout-card">
        <p className="eyebrow">ТЕСТОВАЯ ОПЛАТА</p>
        <Star />
        <h1>Попробуйте весь путь</h1>
        <p>
          Это локальная имитация ЮKassa. Деньги не списываются, вводить данные
          карты не нужно.
        </p>
        {order && (
          <>
            <div className="checkout-product">
              <span>Персональный прогноз на 7 дней</span>
              <strong>{money(order.amount)}</strong>
            </div>
            <p>
              {dateLabel(order.start)} — {dateLabel(order.end)}
            </p>
            {order.status === "pending" && config?.paymentMode === "mock" ? (
              <>
                <button
                  className="button primary full"
                  disabled={busy}
                  onClick={() => void pay("succeeded")}
                >
                  {busy ? "Подтверждаем…" : "Подтвердить демооплату"}
                  <Arrow />
                </button>
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => void pay("canceled")}
                >
                  Отменить тестовый платёж
                </button>
              </>
            ) : (
              <button
                className="button secondary"
                onClick={() => navigate("/account")}
              >
                Вернуться в кабинет
                <Arrow />
              </button>
            )}
          </>
        )}
        {error && <Notice error>{error}</Notice>}
        {unauthorized && (
          <button className="button primary" onClick={onLogin}>
            Войти
          </button>
        )}
      </div>
    </div>
  );
}

function ForecastPage({
  id,
  navigate,
  onLogin,
}: {
  id: string;
  navigate: (s: string) => void;
  onLogin: () => void;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  useEffect(() => {
    void api<Order>(`/api/orders/${id}`)
      .then(setOrder)
      .catch((e) => {
        setError(e.message);
        setUnauthorized(e.status === 401);
      });
  }, [id]);
  useEffect(() => {
    if (order?.forecast?.status !== "generating") return;
    const timer = setInterval(() => {
      void api<Order>(`/api/orders/${id}`)
        .then(setOrder)
        .catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [id, order?.forecast?.status]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      setOrder(await api<Order>(`/api/orders/${id}/generate`, "POST", {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const content = order?.forecast?.content;
  return (
    <div className="container page forecast-page">
      <button className="text-link" onClick={() => navigate("/account")}>
        ← Мои прогнозы
      </button>
      <p className="eyebrow">ВАШ ЛИЧНЫЙ РИТМ</p>
      <h1 className="page-title">Семь дней для себя.</h1>
      {order && (
        <p className="period-label">
          {dateLabel(order.start)} — {dateLabel(order.end)} ·{" "}
          {order.start.slice(0, 4)}
        </p>
      )}
      {error && <Notice error>{error}</Notice>}
      {unauthorized && (
        <button className="button primary" onClick={onLogin}>
          Войти в кабинет
          <Arrow />
        </button>
      )}
      {!order && !error && <p>Открываем прогноз…</p>}
      {order && order.status !== "paid" && (
        <Notice>
          Оплата ещё не подтверждена.{" "}
          <a href={appHref("/account")}>Проверьте статус в кабинете.</a>
        </Notice>
      )}
      {order?.status === "paid" && !content && (
        <div className="generation-card">
          <Star />
          <h2>
            {busy || order.forecast?.status === "generating"
              ? "Находим слова для вашей недели…"
              : "Ваша неделя ждёт"}
          </h2>
          <p>
            Подготовка обычно занимает до минуты. После этого текст останется в
            кабинете.
          </p>
          {order.forecast?.error && (
            <Notice error>{order.forecast.error}</Notice>
          )}
          <button
            className="button primary"
            disabled={busy || order.forecast?.status === "generating"}
            onClick={() => void generate()}
          >
            {busy || order.forecast?.status === "generating"
              ? "Готовим прогноз…"
              : order.forecast?.status === "failed"
                ? "Повторить бесплатно"
                : "Подготовить прогноз"}
            <Arrow />
          </button>
        </div>
      )}
      {content && (
        <>
          {order?.forecast?.mode === "mock" && (
            <Notice>
              Демонстрационный текст. Создан локально без DeepSeek и без
              расходов на модель.
            </Notice>
          )}
          <ForecastBody content={content} />
          <div className="forecast-end">
            <Star />
            <p>
              Это символическая интерпретация, а не предсказание событий.
              <br />
              Берите то, что откликается. Выбор всегда остаётся за вами.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
function ForecastBody({ content }: { content: ForecastContent }) {
  return (
    <article className="forecast-body">
      <section className="forecast-theme">
        <p className="eyebrow">ОБЩАЯ ТЕМА НЕДЕЛИ</p>
        <p>{content.theme}</p>
      </section>
      <section>
        <h2>Язык ваших чисел</h2>
        <p>{content.numbers}</p>
      </section>
      <div className="forecast-areas">
        {[
          ["Работа и повседневность", content.work],
          ["Отношения и общение", content.relationships],
          ["Энергия и настроение", content.energy],
        ].map(([title, text]) => (
          <section key={title}>
            <h3>{title}</h3>
            <p>{text}</p>
          </section>
        ))}
      </div>
      <h2>День за днём</h2>
      <div className="forecast-days">
        {content.days.map((day, i) => (
          <section key={day.date}>
            <div className="day-number">0{i + 1}</div>
            <div>
              <p className="eyebrow">{dateLabel(day.date)}</p>
              <h3>{day.title}</h3>
              <p>{day.text}</p>
            </div>
          </section>
        ))}
      </div>
      <section className="forecast-conclusion">
        <h2>Возьмите с собой</h2>
        <p>{content.conclusion}</p>
      </section>
    </article>
  );
}
function LegalPage({ id, draft }: { id: string; draft: boolean }) {
  const page = legalPages[id];
  if (!page)
    return (
      <div className="container page">
        <h1>Документ не найден</h1>
      </div>
    );
  return (
    <article className="container page legal-page">
      <p className="eyebrow">ДОКУМЕНТЫ · РЕДАКЦИЯ 16 ОКТЯБРЯ 2026</p>
      <h1 className="page-title">{page.title}</h1>
      {draft && (
        <Notice>
          Шаблон для редактирования. Реквизиты и отдельные условия не заполнены.
          Владелец должен проверить и опубликовать окончательную редакцию до
          приёма реальных платежей.
        </Notice>
      )}
      {page.sections.map((section) => (
        <section key={section.title}>
          <h2>{section.title}</h2>
          <p>{section.text}</p>
        </section>
      ))}
    </article>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
