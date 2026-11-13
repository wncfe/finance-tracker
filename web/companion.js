"use strict";
(() => {
  const panel = $("companionPanel");
  let loading = false;
  async function refresh() {
    if (loading) return;
    loading = true;
    const owner = accountLogin;
    try {
      const [inbox, devices] = await Promise.all([
        api("companion/inbox"),
        api("companion/devices"),
      ]);
      if ($("dashboard").hidden || owner !== accountLogin) return;
      $("companionDevices").innerHTML = devices.devices
        .map(
          (d) =>
            `<p>${esc(d.name)} · до ${esc(new Date(d.expires * 1000).toLocaleDateString("ru-RU"))} <button type="button" data-revoke="${esc(d.id)}">Отозвать доступ</button></p>`,
        )
        .join("");
      $("companionLegacy").hidden = !inbox.entries.length;
      $("companionInbox").innerHTML = inbox.entries.length
        ? ""
        : '<p class="muted">Нет входящих расходов</p>';
      for (const entry of inbox.entries) {
        const form = document.createElement("form");
        form.className = "card";
        form.innerHTML =
          `<h3>Расход с Android</h3><p>${esc(entry.text)}</p>` +
          entry.items
            .map(
              (r) =>
                `<fieldset><legend>${esc(r.raw)}</legend><p class="muted">${esc([...r.issues, ...(!r.category ? ["Выберите категорию"] : [])].join(" · "))}</p><label>Сумма, ₽<input name="amount" type="number" min="0.01" max="100000000" step="0.01" required value="${r.amount == null ? "" : r.amount / 100}"></label><label>Дата<input name="date" type="date" required value="${esc(r.date)}"></label><label>Категория<select name="category" required><option value="">Выберите</option>${cats.map((c) => `<option${c === r.category ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label><label>Описание<input name="note" maxlength="200" value="${esc(r.note)}"></label><label><input type="checkbox" name="include" checked> Включить расход</label></fieldset>`,
            )
            .join("") +
          `<button type="submit" class="primary">Подтвердить выбранные</button> <button type="button" data-dismiss>Исключить весь черновик</button>`;
        let sending = false,
          pendingReview = null;
        async function review(status) {
          if (sending) return;
          const items = [...form.querySelectorAll("fieldset")]
            .filter((f) => f.querySelector('[name="include"]').checked)
            .map((f) => ({
              amount: Math.round(
                Number(f.querySelector('[name="amount"]').value) * 100,
              ),
              date: f.querySelector('[name="date"]').value,
              category: f.querySelector('[name="category"]').value,
              note: f.querySelector('[name="note"]').value,
            }));
          if (status === "confirmed" && !items.length) {
            toast("Выберите хотя бы один расход");
            return;
          }
          // Preserve the exact request after an ambiguous response until retry succeeds.
          pendingReview ||= {
            id: entry.id,
            status,
            items: status === "confirmed" ? items : [],
          };
          sending = true;
          form
            .querySelectorAll("button,input,select")
            .forEach((e) => (e.disabled = true));
          try {
            await api("companion/review", pendingReview);
            await load();
            await refresh();
          } catch (e) {
            toast(e.message);
            if (e.status && e.status < 500) pendingReview = null;
          } finally {
            sending = false;
            form
              .querySelectorAll("button,input,select")
              .forEach((e) => (e.disabled = false));
            form.querySelectorAll('[name="include"]').forEach((box) => {
              box
                .closest("fieldset")
                .querySelectorAll("input:not([name=include]),select")
                .forEach((input) => (input.disabled = !box.checked));
            });
          }
        }
        form.onsubmit = (e) => {
          e.preventDefault();
          review("confirmed");
        };
        form.querySelector("[data-dismiss]").onclick = () =>
          review("dismissed");
        form.querySelectorAll('[name="include"]').forEach(
          (box) =>
            (box.onchange = () => {
              box
                .closest("fieldset")
                .querySelectorAll("input:not([name=include]),select")
                .forEach((input) => (input.disabled = !box.checked));
            }),
        );
        $("companionInbox").append(form);
      }
    } catch (e) {
      if ($("dashboard").hidden || owner !== accountLogin) return;
      $("companionInbox").textContent =
        e.status === 404
          ? "Компаньон доступен в Cloudflare-версии после обновления Worker."
          : e.message;
    } finally {
      loading = false;
    }
  }
  $("companionOpen").onclick = () => {
    panel.showModal();
    refresh();
  };
  $("companionClose").onclick = () => panel.close();
  panel.addEventListener("close", () => {
    $("companionCode").textContent = "";
  });
  $("companionRefresh").onclick = refresh;
  $("companionPair").onclick = async () => {
    try {
      const owner = accountLogin;
      const r = await api("companion/pair", {});
      if ($("dashboard").hidden || owner !== accountLogin) return;
      $("companionCode").textContent =
        `Сервер: ${location.origin}\nОдноразовый код (10 минут): ${r.code}\nВведите его в Android-компаньоне. Код даёт доступ к вашему бюджету — передавайте только своему устройству.`;
    } catch (e) {
      toast(e.message);
    }
  };
  $("companionDevices").onclick = async (e) => {
    const b = e.target.closest("[data-revoke]");
    if (!b) return;
    try {
      await api("companion/revoke", { id: b.dataset.revoke });
      await refresh();
    } catch (e) {
      toast(e.message);
    }
  };
  new MutationObserver(() => {
    $("companionOpen").hidden = $("dashboard").hidden;
    if ($("dashboard").hidden) {
      panel.close();
      for (const id of ["companionCode", "companionInbox", "companionDevices"])
        $(id).textContent = "";
    }
  }).observe($("dashboard"), { attributes: true, attributeFilter: ["hidden"] });
  $("companionOpen").hidden = $("dashboard").hidden;
})();
