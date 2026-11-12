// Relational rows are the source of truth. State is only an API/domain projection.
export async function loadFinance(db, userId) {
  const result = await db.batch([
    db.prepare("SELECT revision FROM users WHERE id=?").bind(userId),
    db
      .prepare(
        "SELECT month,budget,incoming,outgoing FROM months WHERE user_id=? ORDER BY month",
      )
      .bind(userId),
    db
      .prepare("SELECT * FROM weeks WHERE user_id=? ORDER BY month,week_index")
      .bind(userId),
    db
      .prepare(
        "SELECT e.*,c.name AS category FROM expenses e JOIN categories c ON c.id=e.category_id WHERE e.user_id=? ORDER BY month,position",
      )
      .bind(userId),
    db
      .prepare(
        "SELECT id,name,aliases,hidden FROM user_merchants WHERE user_id=? ORDER BY id",
      )
      .bind(userId),
  ]);
  const state = { months: {} };
  for (const m of result[1].results)
    state.months[m.month] = {
      budget: m.budget,
      incoming: m.incoming,
      outgoing: m.outgoing,
      weeks: [],
      expenses: [],
    };
  for (const w of result[2].results) {
    const week = {
      start: w.start_day,
      end: w.end_day,
      days: w.days,
      limit: w.limit_amount,
      closed: !!w.closed,
    };
    if (w.settled !== null) week.settled = w.settled;
    const weeks = state.months[w.month].weeks;
    if (w.week_index !== weeks.length) throw Error("Non-contiguous weeks");
    weeks.push(week);
  }
  for (const e of result[3].results)
    state.months[e.month].expenses.push({
      id: e.id,
      week: e.week_index,
      amount: e.amount,
      date: e.date,
      category: e.category,
      note: e.note,
      ...(e.merchant_id !== null ? { merchantId: e.merchant_id } : {}),
    });
  if (result[4].results.length)
    state.merchants = result[4].results.map((m) => ({
      id: m.id,
      name: m.name,
      aliases: JSON.parse(m.aliases),
      hidden: !!m.hidden,
    }));
  return { state, revision: result[0].results[0].revision };
}

export function financeWrites(db, userId, before, after, token) {
  const statements = [];
  // A unique token is set by the CAS as the first statement in the same batch.
  // Unlike a revision-only predicate, it cannot match another request's commit.
  const guard = "EXISTS(SELECT 1 FROM users WHERE id=? AND mutation_token=?)";
  const add = (sql, args) =>
    statements.push(db.prepare(sql).bind(...args, userId, token));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const m of after.merchants || []) {
    const previous = (before.merchants || []).find(
      (entry) => entry.id === m.id,
    );
    if (!same(previous, m))
      add(
        `INSERT INTO user_merchants(user_id,id,name,aliases,hidden) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(user_id,id) DO UPDATE SET name=excluded.name,aliases=excluded.aliases,hidden=excluded.hidden`,
        [userId, m.id, m.name, JSON.stringify(m.aliases), m.hidden ? 1 : 0],
      );
  }
  for (const [key, m] of Object.entries(after.months)) {
    const old = before.months[key];
    if (same(old, m)) continue;
    if (!old)
      add(
        `INSERT INTO months(user_id,month,budget,incoming,outgoing) SELECT ?,?,?,?,? WHERE ${guard}`,
        [userId, key, m.budget, m.incoming, m.outgoing],
      );
    else if (
      m.budget !== old.budget ||
      m.incoming !== old.incoming ||
      m.outgoing !== old.outgoing
    )
      add(
        `UPDATE months SET budget=?,incoming=?,outgoing=? WHERE user_id=? AND month=? AND ${guard}`,
        [m.budget, m.incoming, m.outgoing, userId, key],
      );
    m.weeks.forEach((w, i) => {
      if (old && same(old.weeks[i], w)) return;
      add(
        `INSERT INTO weeks(user_id,month,week_index,start_day,end_day,days,limit_amount,closed,settled) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(user_id,month,week_index) DO UPDATE SET start_day=excluded.start_day,end_day=excluded.end_day,days=excluded.days,limit_amount=excluded.limit_amount,closed=excluded.closed,settled=excluded.settled`,
        [
          userId,
          key,
          i,
          w.start,
          w.end,
          w.days,
          w.limit,
          w.closed ? 1 : 0,
          w.settled ?? null,
        ],
      );
    });
    const previous = new Map(
      (old?.expenses || []).map((e, i) => [e.id, { e, i }]),
    );
    const present = new Set(m.expenses.map((e) => e.id));
    for (const id of previous.keys())
      if (!present.has(id))
        add(`DELETE FROM expenses WHERE user_id=? AND id=? AND ${guard}`, [
          userId,
          id,
        ]);
    m.expenses.forEach((e, i) => {
      const prior = previous.get(e.id);
      if (prior && prior.i === i && same(prior.e, e)) return;
      add(
        `INSERT INTO expenses(user_id,id,month,week_index,amount,date,category_id,note,position,merchant_id) SELECT ?,?,?,?,?,?,(SELECT id FROM categories WHERE name=?),?,?,? WHERE ${guard} ON CONFLICT(user_id,id) DO UPDATE SET month=excluded.month,week_index=excluded.week_index,amount=excluded.amount,date=excluded.date,category_id=excluded.category_id,note=excluded.note,position=excluded.position,merchant_id=excluded.merchant_id`,
        [
          userId,
          e.id,
          key,
          e.week,
          e.amount,
          e.date,
          e.category,
          e.note,
          i,
          e.merchantId ?? null,
        ],
      );
    });
  }
  return statements;
}
