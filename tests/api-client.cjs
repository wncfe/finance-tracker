const assert = require("node:assert/strict");
const { sendOperation, sendPendingOperation } = require("../web/api-client.js");
(async () => {
  const calls = [];
  const result = await sendOperation(
    async (path, body) => {
      calls.push(structuredClone(body));
      if (calls.length === 1) throw new TypeError("response lost");
      return { revision: 2 };
    },
    1,
    { type: "expense" },
    "fixed-operation-id",
  );
  assert.deepEqual(result, { revision: 2 });
  assert.deepEqual(calls[0], calls[1]);
  let attempts = 0;
  await assert.rejects(
    sendOperation(
      async () => {
        attempts++;
        throw Object.assign(Error("conflict"), { status: 409 });
      },
      0,
      {},
    ),
    /conflict/,
  );
  assert.equal(attempts, 1);
  await assert.rejects(
    sendOperation(
      async () => {
        throw Error("offline");
      },
      0,
      {},
    ),
    (error) => error.uncertain === true,
  );
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const action = { type: "expense", amount: 100 };
  await assert.rejects(
    sendPendingOperation(
      async () => {
        throw Error("offline");
      },
      0,
      action,
      storage,
      "alice",
    ),
    (error) => error.uncertain,
  );
  const pending = JSON.parse(values.get("alice"));
  const recovered = await sendPendingOperation(
    async (path, body) => {
      assert.equal(body.operationId, pending.operationId);
      assert.deepEqual(body.action, action);
      return { revision: 1 };
    },
    5,
    { type: "expense", amount: 200 },
    storage,
    "alice",
  );
  assert.equal(recovered.recoveredOther, true);
  assert.equal(values.size, 0);
  console.log("Client retry checks passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
