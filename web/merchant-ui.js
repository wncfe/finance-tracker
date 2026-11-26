"use strict";
(() => {
  const D = MerchantDictionary;
  let editing = "",
    draftId = "",
    onSaved = null;

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

  function refreshCategoryOptions(selected = $("merchantCategory").value) {
    $("merchantCategory").innerHTML =
      '<option value="">Выберите категорию</option>' +
      categoryOptions()
        .map(
          (category) =>
            `<option value="${esc(category)}">${esc(category)}</option>`,
        )
        .join("");
    $("merchantCategory").value = selected || "";
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
    refreshCategoryOptions();
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
            `<button class="merchant-list-item" type="button" data-merchant-edit="${esc(m.id)}"><span>${esc(m.name)}${m.hidden ? " <small>(скрыт)</small>" : ""}</span><small>${m.category ? `Категория: ${esc(m.category)} · ` : ""}${esc(m.aliases.join(", "))}</small></button>`,
        )
        .join("") || '<p class="muted">Ничего не найдено</p>';
  }

  function openForm(callback, suggested = "", item = null) {
    if (busy) return;
    onSaved = callback || null;
    clearForm();
    $("merchantName").value = suggested;
    if (item) {
      editing = item.id;
      $("merchantFormTitle").textContent = "Редактировать магазин";
      $("merchantName").value = item.name;
      $("merchantAliases").value = item.aliases.join("\n");
      $("merchantCategory").value = item.category || "";
      $("merchantHidden").checked = !!item.hidden;
    }
    $("merchantFormDialog").showModal();
    $("merchantName").focus();
  }

  function open(callback, suggested = "") {
    openForm(callback, suggested);
  }

  function openLibrary() {
    if (busy) return;
    $("merchantSearch").value = "";
    renderList();
    $("merchantDialog").showModal();
  }

  $("merchantOpen").onclick = openLibrary;
  $("merchantAdd").onclick = () => openForm();
  $("merchantClose").onclick = () => {
    if (!busy) $("merchantDialog").close();
  };
  $("merchantFormClose").onclick = () => {
    if (!busy) $("merchantFormDialog").close();
  };
  $("merchantCategoryChoose").onclick = () =>
    CategoryUI.open((category) => {
      refreshCategoryOptions(category);
    });
  $("merchantDialog").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  $("merchantSearch").oninput = renderList;
  $("merchantList").onclick = (e) => {
    const id = e.target.closest("[data-merchant-edit]")?.dataset.merchantEdit;
    const item = D.all(state.merchants || [], true).find((m) => m.id === id);
    if (!item) return;
    openForm(null, "", item);
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
    const category = $("merchantCategory").value;
    const item = {
      id,
      name,
      aliases,
      category,
      hidden: $("merchantHidden").checked,
    };
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
      if (onSaved && !item.hidden) {
        const callback = onSaved;
        onSaved = null;
        $("merchantFormDialog").close();
        callback(id);
      } else {
        $("merchantFormDialog").close();
        if (!$("merchantDialog").open) openLibrary();
      }
    } else
      $("merchantError").textContent =
        "Не удалось сохранить. Проверьте сообщение и повторите.";
  };

  globalThis.MerchantUI = {
    options,
    open,
    hint,
    refreshCategoryOptions,
  };
})();
