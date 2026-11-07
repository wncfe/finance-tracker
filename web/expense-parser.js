(function (root) {
  "use strict";
  const normalize = (s) =>
    String(s)
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[’']/g, "")
      .replace(/[_–—-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const groups = {
    Продукты: [
      "продукты",
      "пятерочка",
      "пятёрка",
      "5ка",
      "магнит",
      "лента",
      "монетка",
      "чижик",
      "вкусвилл",
      "вкус вилл",
      "перекресток",
      "ашан",
      "окей",
      "азбука вкуса",
      "красное и белое",
      "кб",
      "яндекс лавка",
      "овощи",
      "супермаркет",
    ],
    Кофейни: [
      "кофе",
      "кофейня",
      "капучино",
      "капуч",
      "латте",
      "раф",
      "эспрессо",
      "дрип",
      "дринкит",
      "drinkit",
      "monkey grinder",
      "манки гриндер",
      "red cup",
      "ред кап",
    ],
    Фастфуд: [
      "фастфуд",
      "бургер",
      "бургер кинг",
      "burger king",
      "бк",
      "ростикс",
      "ростикс",
      "rostics",
      "kfc",
      "кфс",
      "вкусно и точка",
      "макдональдс",
      "макдак",
      "шаурма",
      "шаверма",
      "додо",
      "додо пицца",
      "пицца",
    ],
    Рестораны: [
      "ресторан",
      "кафе",
      "обед",
      "ужин",
      "бизнес ланч",
      "суши",
      "роллы",
      "evo dzhermuk",
      "джермук",
      "pla yoo",
      "ни хао",
    ],
    Транспорт: [
      "такси",
      "яндекс такси",
      "яндекс го",
      "yandex go",
      "yandex fasten",
      "fasten",
      "автобус",
      "метро",
      "тройка",
      "тройка пермь",
      "московский метрополитен",
      "автовокзалы прикамья",
      "единая транспортная карта",
      "проезд",
      "бензин",
      "заправка",
      "парковка",
      "аренда самоката",
      "самокат аренда",
    ],
    Здоровье: [
      "аптека",
      "планета здоровья",
      "будь здоров",
      "лекарства",
      "врач",
      "стоматолог",
      "анализы",
      "альфа центр здоровье",
      "tekhnologii zreniya",
    ],
    "Одежда и обувь": [
      "одежда",
      "обувь",
      "кроссовки",
      "befree",
      "бифри",
      "zolla",
      "new yorker",
      "куртка",
      "футболка",
    ],
    Спорт: [
      "спорт",
      "фитнес",
      "тренировка",
      "yobody fitness",
      "йободи",
      "абонемент в зал",
    ],
    "Подписки и цифровые сервисы": [
      "подписка",
      "яндекс плюс",
      "okko",
      "okko.tv",
      "окко",
      "steam",
      "стим",
      "adminvps",
      "хостинг",
      "vpn",
      "впн",
      "софт",
    ],
    "Связь и интернет": [
      "связь",
      "интернет",
      "ростелеком",
      "теле2",
      "tele2",
      "t2",
      "т2",
      "мтс",
      "мегафон",
      "билайн",
      "мобильная связь",
    ],
    Дом: [
      "дом",
      "мебель",
      "ремонт",
      "жкх",
      "квартплата",
      "коммуналка",
      "аренда квартиры",
      "порошок",
      "бытовая химия",
    ],
    Красота: [
      "красота",
      "парикмахерская",
      "стрижка",
      "маникюр",
      "косметика",
      "м косметик",
    ],
    Дети: ["детский мир", "детские товары", "подгузники", "игрушки"],
    "Подарки и творчество": [
      "подарок",
      "цветы",
      "modi",
      "моди",
      "леонардо",
      "творчество",
    ],
    "Книги и образование": [
      "книга",
      "книги",
      "читай город",
      "канцтовары",
      "образование",
      "курсы",
      "учеба",
    ],
    Развлечения: [
      "кино",
      "театр",
      "зоопарк",
      "пермский зоопарк",
      "play day",
      "playoo",
      "игротека",
      "концерт",
      "музей",
      "лотерея",
      "betboom",
      "балтбет",
    ],
    Покупки: [
      "ozon",
      "озон",
      "wildberries",
      "вайлдберриз",
      "вб",
      "wb",
      "маркетплейс",
      "fix price",
      "фикс прайс",
    ],
    Путешествия: ["отель", "гостиница", "авиабилет", "тур", "хостел"],
    Другое: ["другое"],
  };
  function categoryFor(note, rules = {}, history = []) {
    const key = normalize(note);
    if (
      rules &&
      typeof rules === "object" &&
      Object.hasOwn(rules, key) &&
      typeof rules[key] === "string"
    )
      return { category: rules[key], source: "Ваше правило" };
    const past = new Set(
      history.filter((e) => normalize(e.note) === key).map((e) => e.category),
    );
    if (past.size === 1)
      return { category: [...past][0], source: "История расходов" };
    if (past.size > 1)
      return { category: "", source: "В истории разные категории" };
    if (/^(самокат|яндекс|магазин|пекарня|foreignpay|jj svit)$/.test(key))
      return { category: "", source: "Нужен контекст покупки" };
    const seed = (root.ExpenseHistory || []).find(
      (e) => normalize(e.note) === key,
    );
    if (seed) return { category: seed.category, source: "Словарь из выписки" };
    let hits = [];
    for (const [category, words] of Object.entries(groups))
      for (const word of words) {
        const w = normalize(word);
        if ((" " + key + " ").includes(" " + w + " "))
          hits.push({ category, length: w.length });
      }
    hits.sort((a, b) => b.length - a.length);
    if (!hits.length) {
      const close = new Set();
      const distance = (a, b) => {
        const dp = Array.from({ length: a.length + 1 }, (_, i) => [
          i,
          ...Array(b.length).fill(0),
        ]);
        for (let j = 0; j <= b.length; j++) dp[0][j] = j;
        for (let i = 1; i <= a.length; i++)
          for (let j = 1; j <= b.length; j++)
            dp[i][j] = Math.min(
              dp[i - 1][j] + 1,
              dp[i][j - 1] + 1,
              dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        return dp[a.length][b.length];
      };
      if (key.length >= 6 && key.length <= 40)
        for (const [cat, words] of Object.entries(groups))
          if (
            words.some(
              (w) =>
                Math.abs(normalize(w).length - key.length) <= 1 &&
                distance(normalize(w), key) === 1,
            )
          )
            close.add(cat);
      return {
        category: close.size === 1 ? [...close][0] : "",
        source:
          close.size === 1
            ? "Похожее написание — проверьте"
            : "Выберите категорию",
      };
    }
    const choices = new Set(hits.map((h) => h.category));
    return {
      category: choices.size === 1 ? hits[0].category : "",
      source: choices.size === 1 ? "Словарь" : "Несколько категорий",
    };
  }
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const months = [
    "январ",
    "феврал",
    "март",
    "апрел",
    "ма",
    "июн",
    "июл",
    "август",
    "сентябр",
    "октябр",
    "ноябр",
    "декабр",
  ];
  function parseDate(text, today) {
    let found = [],
      errors = [];
    let rest = text;
    rest = rest.replace(
      /(?<!\p{L})(?:сегодня|позавчера|вчера)(?!\p{L})/giu,
      (m) => {
        const d = new Date(today);
        d.setDate(
          d.getDate() -
            (m.toLowerCase() === "вчера"
              ? 1
              : m.toLowerCase() === "позавчера"
                ? 2
                : 0),
        );
        found.push(iso(d));
        return " ";
      },
    );
    function date(y, m, d) {
      const v = new Date(y, m - 1, d, 12);
      if (y < 2000 || y > 2100 || v.getMonth() !== m - 1 || v.getDate() !== d) {
        errors.push("Некорректная дата");
        return;
      }
      found.push(iso(v));
    }
    rest = rest.replace(
      /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g,
      (_, y, m, d) => {
        date(+y, +m, +d);
        return " ";
      },
    );
    rest = rest.replace(
      /(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?!\d)/g,
      (matched, d, m, y, offset, original) => {
        if (!y && matched.includes(".")) {
          const after = original.slice(offset + matched.length);
          if (/^\s*(?:₽|руб|р(?!\p{L}))/iu.test(after)) return matched;
          if (+d > 31 || +m > 12) return matched;
          const other =
            original.slice(0, offset) +
            " " +
            original.slice(offset + matched.length);
          if (!/\d/.test(other)) {
            errors.push(
              "Число с точкой может быть датой или суммой — уточните",
            );
            return matched;
          }
        }
        date(y ? +y : today.getFullYear(), +m, +d);
        return " ";
      },
    );
    rest = rest.replace(
      /(?<!\d)(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4})(?=\s|$))?/giu,
      (_, d, m, y) => {
        date(
          y ? +y : today.getFullYear(),
          months.findIndex((x) => m.toLowerCase().startsWith(x)) + 1,
          +d,
        );
        return " ";
      },
    );
    if (found.length > 1) errors.push("Указано несколько дат — выберите одну");
    return { rest, date: errors.length ? "" : found[0] || iso(today), errors };
  }
  function parse(text, options = {}) {
    const today = options.today || new Date();
    // Decimal commas stay inside a number; comma before a word separates expenses.
    const parts = text.split(/\n|;|,(?!\d)/iu).filter((x) => x.trim());
    return parts.map((raw) => {
      const parsed = parseDate(raw, today),
        issues = [...parsed.errors];
      let rest = parsed.rest;
      if (
        /завтра|недел|понедельник|вторник|сред[ау]|четверг|пятниц|суббот|воскресень|прошл|следующ/iu.test(
          rest,
        )
      ) {
        issues.push("Уточните дату в поле предпросмотра");
        parsed.date = "";
      }
      if (/[$€]|(?<!\p{L})(?:usd|eur|доллар\p{L}*|евро)(?!\p{L})/iu.test(rest))
        issues.push("Поддерживаются только расходы в рублях — уточните сумму");
      rest = rest.replace(/(\d)(?:рублей|рубля|руб|р)(?!\p{L})/giu, "$1 ");
      rest = rest.replace(/[−–]\s*(?=\d)|-\s+(?=\d)/gu, "-");
      if (
        /возврат|вернул|перевод|перев[её]л|пополнил|пополнение|снятие|доход|зарплата|кешбэк|кэшбэк/iu.test(
          rest,
        )
      )
        issues.push("Это может быть не расход: уточните назначение");
      const amounts = [
        ...rest.matchAll(
          /(?<![\p{L}\d])[-+]?\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?(?![\p{L}\d])/gu,
        ),
      ];
      let amount = null;
      if (amounts.length === 1) {
        const value = amounts[0][0]
          .replace(/[ \u00a0\u202f]/g, "")
          .replace(",", ".");
        amount = Math.round(Number(value) * 100);
        if (amount <= 0 || amount > 1e10) {
          amount = null;
          issues.push("Нужна положительная сумма до 100 000 000 ₽");
        }
        rest =
          rest.slice(0, amounts[0].index) +
          " " +
          rest.slice(amounts[0].index + amounts[0][0].length);
      } else
        issues.push(
          amounts.length
            ? "Несколько сумм — уточните расход"
            : "Не найдена сумма",
        );
      const note = rest
        .replace(/(?:₽|(?<!\p{L})(?:рублей|рубля|руб|р)(?!\p{L})\.?)/giu, " ")
        .replace(
          /(?<!\p{L})(?:купил|купила|потратил|потратила|за|на)(?!\p{L})/giu,
          " ",
        )
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("ru-RU"));
      if (!note) issues.push("Добавьте описание");
      const inferred = categoryFor(note, options.rules, options.history);
      if (
        !inferred.category &&
        amounts.length === 1 &&
        /\d[ \u00a0\u202f]\d/.test(amounts[0][0])
      )
        issues.push("Числа могут быть частью названия или суммы — проверьте");
      return {
        raw: raw.trim(),
        note,
        amount,
        date: parsed.date,
        ...inferred,
        issues,
      };
    });
  }
  const api = { parse, normalize, categoryFor, groups, iso };
  root.ExpenseParser = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
