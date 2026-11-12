"use strict";
(() => {
  const D = MerchantDictionary;
  let editing = "",
    draftId = "",
    onSaved = null,
    weekManual = false;

  function options(selectedId = "") {
    const items = D.all(state.merchants || []);
    return (
      '<option value="">Не указан</option>' +
      items
        .map(
          (m) =>
            `<option value="${esc(m.id)}"${m.id === selectedId ? " selected" : ""}>${esc(m.name)}</option>`,
        )
        .join("")
    );
  }

  function updateWeek(guess = false) {
    const select = $("weekMerchant"),
      previous = select.value;
    const match = D.resolve(
      $("expenseform").elements.note.value,
      D.all(state.merchants || []),
    );
    const value =
      guess && !weekManual
        ? match.status === "matched"
          ? match.matches[0].id
          : ""
        : previous;
    select.innerHTML = options(value);
    $("weekMerchantHint").textContent = guess && !weekManual ? hint(match) : "";
  }

  function hint(match) {
    if (match.status === "ambiguous")
      return "Найдено несколько магазинов — выберите вручную.";
    if (match.suggestions?.length)
      return `Возможно: ${match.suggestions.map((m) => m.name).join(", ")}. Выберите магазин вручную.`;
    return "";
  }

  function clearForm() {
    editing = "";
    draftId = "";
    $("merchantForm").reset();
    $("merchantFormTitle").textContent = "Новый магазин или сервис";
    $("merchantError").textContent = "";
  }

  function renderList() {
    const query = D.normalize($("merchantSearch").value);
    const matches = D.all(state.merchants || [], true).filter((m) =>
      [m.name, ...m.aliases].some((name) => D.normalize(name).includes(query)),
    );
    $("merchantList").innerHTML =
      matches
        .map(
          (m) =>
            `<button class="merchant-list-item" type="button" data-merchant-edit="${esc(m.id)}"><span>${esc(m.name)}${m.hidden ? " <small>(скрыт)</small>" : ""}</span><small>${esc(m.aliases.join(", "))}</small></button>`,
        )
        .join("") || '<p class="muted">Ничего не найдено</p>';
  }

  function open(callback, suggested = "") {
    if (busy) return;
    onSaved = callback || null;
    clearForm();
    $("merchantSearch").value = "";
    $("merchantName").value = suggested;
    renderList();
    $("merchantDialog").showModal();
  }

  $("merchantOpen").onclick = () => open();
  $("merchantClose").onclick = () => {
    if (!busy) $("merchantDialog").close();
  };
  $("merchantDialog").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  $("merchantSearch").oninput = renderList;
  $("merchantClear").onclick = clearForm;
  $("merchantList").onclick = (e) => {
    const id = e.target.closest("[data-merchant-edit]")?.dataset.merchantEdit;
    const item = D.all(state.merchants || [], true).find((m) => m.id === id);
    if (!item) return;
    editing = item.id;
    $("merchantFormTitle").textContent = "Изменить магазин или сервис";
    $("merchantName").value = item.name;
    $("merchantAliases").value = item.aliases.join("\n");
    $("merchantHidden").checked = !!item.hidden;
    $("merchantError").textContent = "";
    $("merchantName").focus();
  };
  $("merchantForm").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const name = $("merchantName").value.trim();
    const aliases = $("merchantAliases")
      .value.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name || aliases.length > 30 || aliases.some((s) => s.length > 100)) {
      $("merchantError").textContent =
        "Укажите название и не более 30 вариантов длиной до 100 символов.";
      return;
    }
    const id =
      editing ||
      draftId ||
      (draftId = "c-" + crypto.randomUUID().replaceAll("-", ""));
    const item = { id, name, aliases, hidden: $("merchantHidden").checked };
    const sameName = D.all(state.merchants || [], true).find(
      (m) => m.id !== id && D.normalize(m.name) === D.normalize(name),
    );
    if (sameName) {
      $("merchantError").textContent =
        "Магазин с таким названием уже существует.";
      return;
    }
    if (await mutate({ type: "merchant_save", merchant: item })) {
      renderList();
      updateWeek();
      if (onSaved && !item.hidden) {
        const callback = onSaved;
        onSaved = null;
        $("merchantDialog").close();
        callback(id);
      } else {
        editing = id;
        $("merchantFormTitle").textContent = "Изменить магазин или сервис";
        $("merchantError").textContent = "Сохранено";
      }
    } else
      $("merchantError").textContent =
        "Не удалось сохранить. Проверьте сообщение и повторите.";
  };

  $("weeks").addEventListener("click", (e) => {
    if (e.target.closest("[data-week]")) {
      weekManual = false;
      updateWeek(true);
    }
  });
  $("expenseform").elements.note.addEventListener("input", () =>
    updateWeek(true),
  );
  $("weekMerchant").addEventListener("change", () => {
    weekManual = true;
    $("weekMerchantHint").textContent = "";
  });
  $("weekMerchantNew").onclick = () =>
    open((id) => {
      weekManual = true;
      $("weekMerchant").innerHTML = options(id);
    }, $("expenseform").elements.note.value.trim());
  globalThis.MerchantUI = {
    options,
    open,
    hint,
    resetWeek() {
      weekManual = false;
      updateWeek(true);
    },
  };
})();
