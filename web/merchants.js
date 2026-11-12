(function (root) {
  "use strict";

  let defaults =
    typeof module !== "undefined" ? require("./merchants.json") : [];

  function normalize(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/g, "е")
      .replace(/[’']/g, "")
      .replace(/[_–—-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function all(overrides = [], includeHidden = false) {
    const items = new Map(defaults.map((merchant) => [merchant.id, merchant]));
    for (const merchant of overrides) items.set(merchant.id, merchant);
    return [...items.values()]
      .filter((merchant) => includeHidden || !merchant.hidden)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  function resolve(value, merchants = all()) {
    const key = normalize(value);
    if (!key) return { status: "unknown", matches: [], suggestions: [] };
    const matches = merchants.filter((merchant) =>
      [merchant.name, ...(merchant.aliases || [])].some(
        (alias) => normalize(alias) === key,
      ),
    );
    const suggestions =
      matches.length || key.length < 5
        ? []
        : merchants
            .filter((merchant) =>
              [merchant.name, ...(merchant.aliases || [])].some((alias) =>
                oneEditApart(key, normalize(alias)),
              ),
            )
            .slice(0, 3);
    return {
      status:
        matches.length === 1
          ? "matched"
          : matches.length
            ? "ambiguous"
            : "unknown",
      matches,
      suggestions,
    };
  }

  function oneEditApart(a, b) {
    if (Math.abs(a.length - b.length) > 1 || a === b) return false;
    let i = 0,
      j = 0,
      edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
        continue;
      }
      if (++edits > 1) return false;
      if (a.length >= b.length) i++;
      if (b.length >= a.length) j++;
    }
    return edits + (i < a.length || j < b.length ? 1 : 0) === 1;
  }

  const api = {
    normalize,
    resolve,
    all,
    setDefaults(value) {
      defaults = value;
    },
  };
  if (typeof document !== "undefined") {
    let pending;
    api.loadDefaults = () => {
      if (!pending)
        pending = fetch("/merchants.json")
          .then((response) => {
            if (!response.ok)
              throw Error("Не удалось загрузить справочник магазинов");
            return response.json();
          })
          .then((value) => {
            defaults = value;
          })
          .catch((error) => {
            pending = null;
            throw error;
          });
      return pending;
    };
  }
  root.MerchantDictionary = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
