"use strict";
(() => {
  let onSelect = null;

  function renderList() {
    const query = MerchantDictionary.normalize($("categorySearch").value),
      matches = categoryOptions().filter((name) =>
        MerchantDictionary.normalize(name).includes(query),
      );
    $("categoryList").innerHTML =
      matches
        .map(
          (name) =>
            `<button class="merchant-list-item" type="button" data-category-select="${esc(name)}"><span>${esc(name)}</span></button>`,
        )
        .join("") || '<p class="muted">Ничего не найдено</p>';
  }

  function open(callback = null) {
    if (busy) return;
    onSelect = callback;
    $("categorySearch").value = "";
    renderList();
    $("categoryDialog").showModal();
    $("categorySearch").focus();
  }

  $("categoryOpen").onclick = () => open();
  $("categoryClose").onclick = () => {
    if (!busy) $("categoryDialog").close();
  };
  $("categorySearch").oninput = renderList;
  $("categoryList").onclick = (event) => {
    const name = event.target.closest("[data-category-select]")?.dataset
      .categorySelect;
    if (!name || !onSelect) return;
    const callback = onSelect;
    onSelect = null;
    $("categoryDialog").close();
    callback(name);
  };
  $("categoryAdd").onclick = () => {
    if (busy) return;
    $("categoryForm").reset();
    $("categoryError").textContent = "";
    $("categoryFormDialog").showModal();
    $("categoryName").focus();
  };
  $("categoryFormClose").onclick = () => {
    if (!busy) $("categoryFormDialog").close();
  };
  $("categoryForm").onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const name = $("categoryName").value.trim(),
      normalized = MerchantDictionary.normalize(name);
    if (
      !name ||
      name.length > 60 ||
      categoryOptions().some(
        (item) => MerchantDictionary.normalize(item) === normalized,
      )
    ) {
      $("categoryError").textContent =
        name.length > 60
          ? "Название категории должно быть не длиннее 60 символов."
          : "Укажите новое название категории.";
      return;
    }
    const item = {
      id: "uc-" + crypto.randomUUID().replaceAll("-", ""),
      name,
    };
    if (await mutate({ type: "category_save", category: item })) {
      $("categoryFormDialog").close();
      renderList();
      MerchantUI?.refreshCategoryOptions();
      if (onSelect) {
        const callback = onSelect;
        onSelect = null;
        $("categoryDialog").close();
        callback(name);
      }
    } else
      $("categoryError").textContent =
        "Не удалось сохранить. Проверьте сообщение и повторите.";
  };

  globalThis.CategoryUI = { open };
})();
