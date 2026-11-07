"use strict";

// A receipt is committed together with the financial change on the server.
// Reusing this ID is safe even when the first response was lost.
async function sendOperation(
  request,
  revision,
  action,
  operationId = crypto.randomUUID(),
) {
  const body = { revision, action, operationId };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await request("action", body);
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      if (attempt === 1) {
        error.uncertain = true;
        throw error;
      }
    }
  }
}

// Keep unresolved requests across reloads, separately for each signed-in account.
function readPendingOperation(storage, key) {
  let saved;
  try {
    saved = storage.getItem(key);
  } catch {
    throw Error(
      "Браузер запретил хранилище запросов. Разрешите sessionStorage перед сохранением.",
    );
  }
  if (!saved) return null;
  let pending;
  try {
    pending = JSON.parse(saved);
  } catch {
    throw Error(
      "Повреждён неподтверждённый запрос. Сначала проверьте историю расходов; запрос сохранён в браузере.",
    );
  }
  if (
    !pending ||
    !Number.isInteger(pending.revision) ||
    pending.revision < 0 ||
    typeof pending.operationId !== "string" ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(pending.operationId) ||
    !pending.action ||
    typeof pending.action.type !== "string" ||
    (pending.action.type === "expenses" &&
      (!Array.isArray(pending.action.items) ||
        !pending.action.items.length ||
        pending.action.items.length > 50 ||
        pending.action.items.some(
          (item) =>
            !item ||
            typeof item.date !== "string" ||
            !Number.isSafeInteger(item.amount) ||
            typeof item.category !== "string" ||
            typeof item.note !== "string",
        )))
  )
    throw Error(
      "Некорректный неподтверждённый запрос. Проверьте историю расходов; запрос сохранён в браузере.",
    );
  return pending;
}
async function sendPendingOperation(request, revision, action, storage, key) {
  const pending = readPendingOperation(storage, key) || {
    revision,
    action,
    operationId: crypto.randomUUID(),
  };
  try {
    storage.setItem(key, JSON.stringify(pending));
  } catch {
    throw Error(
      "Не удалось сохранить запрос в браузере. Расходы не отправлены.",
    );
  }
  try {
    const result = await sendOperation(
      request,
      pending.revision,
      pending.action,
      pending.operationId,
    );
    try {
      storage.removeItem(key);
    } catch {
      throw Object.assign(
        Error(
          "Расходы сохранены, но квитанция осталась в браузере. Повтор безопасен.",
        ),
        { uncertain: true },
      );
    }
    return {
      result,
      recoveredOther: JSON.stringify(pending.action) !== JSON.stringify(action),
    };
  } catch (error) {
    if (!error.uncertain) {
      try {
        storage.removeItem(key);
      } catch {
        error.uncertain = true;
      }
    }
    throw error;
  }
}

globalThis.sendPendingOperation = sendPendingOperation;
globalThis.readPendingOperation = readPendingOperation;
if (typeof module !== "undefined")
  module.exports = {
    sendOperation,
    sendPendingOperation,
    readPendingOperation,
  };
