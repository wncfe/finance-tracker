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
async function sendPendingOperation(request, revision, action, storage, key) {
  const saved = storage.getItem(key);
  const pending = saved
    ? JSON.parse(saved)
    : {
        revision,
        action,
        operationId: crypto.randomUUID(),
      };
  storage.setItem(key, JSON.stringify(pending));
  try {
    const result = await sendOperation(
      request,
      pending.revision,
      pending.action,
      pending.operationId,
    );
    storage.removeItem(key);
    return {
      result,
      recoveredOther: JSON.stringify(pending.action) !== JSON.stringify(action),
    };
  } catch (error) {
    if (!error.uncertain) storage.removeItem(key);
    throw error;
  }
}

globalThis.sendPendingOperation = sendPendingOperation;
if (typeof module !== "undefined")
  module.exports = { sendOperation, sendPendingOperation };
