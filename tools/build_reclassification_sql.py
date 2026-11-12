"""Build a guarded, transactional D1 update from the approved manual CSV."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import sqlite3


ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {
    "Фастфуд": "fast-food",
    "Рестораны": "restaurants",
    "Кофейни": "coffee",
    "Транспорт": "transport",
    "Общественный транспорт": "public-transport",
    "Такси": "taxi",
    "Дом": "home",
    "Здоровье": "health",
    "Покупки": "shopping",
    "Одежда и обувь": "clothes",
    "Красота": "beauty",
    "Спорт": "sport",
    "Дети": "children",
    "Подарки и творчество": "gifts",
    "Книги и образование": "education",
    "Связь и интернет": "telecom",
    "Подписки и цифровые сервисы": "subscriptions",
    "Путешествия": "travel",
    "Развлечения": "entertainment",
    "Другое": "other",
    "Супермаркеты": "legacy-supermarkets",
    "Кафе": "legacy-cafe",
}


def sql(value):
    return "'" + str(value).replace("'", "''") + "'"


def norm(value):
    import re

    return " ".join("".join(c if c.isalnum() else " " for c in value.casefold().replace("ё", "е")).split())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("export", type=Path)
    parser.add_argument("csv", type=Path)
    parser.add_argument("output_prefix", type=Path)
    args = parser.parse_args()

    db = sqlite3.connect(":memory:")
    db.executescript(args.export.read_text("utf-8-sig"))
    rows = list(csv.DictReader(args.csv.open(encoding="utf-8-sig", newline=""), delimiter=";"))
    if len(rows) != 51 or len({row["operation_id"] for row in rows}) != len(rows):
        raise SystemExit("CSV must contain exactly 51 unique operation IDs")

    defaults = json.loads((ROOT / "web/merchants.json").read_text("utf-8"))
    known = {}
    for item in defaults:
        for name in [item["name"], *item["aliases"]]:
            known[norm(name)] = (item["id"], item["name"])

    actual = {}
    for expense in db.execute(
        "SELECT user_id,id,date,note,amount,category_id,merchant_id FROM expenses"
    ):
        actual[expense[1]] = expense

    users = set()
    merchant_records = {}
    assignments = []
    for row in rows:
        expense = actual.get(row["operation_id"])
        if not expense:
            raise SystemExit(f"Operation absent from fresh export: {row['operation_id']}")
        uid, oid, date, note, amount, old_category, merchant_id = expense
        expected_date = "-".join(reversed(row["date"].split(".")))
        expected_amount = round(float(row["amount_rub"]) * 100)
        old_id = db.execute("SELECT id FROM categories WHERE name=?", (row["current_category"],)).fetchone()
        new_id = CATEGORIES.get(row["suggested_category"])
        if not old_id or not new_id:
            raise SystemExit(f"Unknown category on operation {oid}")
        if (date, note, amount, old_category, merchant_id) != (
            expected_date, row["description"], expected_amount, old_id[0], None
        ):
            raise SystemExit(f"Operation changed since manual review: {oid}")
        users.add(uid)

        desired_name = row["standard_merchant"].strip()
        match = known.get(norm(desired_name))
        if match:
            desired_id = match[0]
        else:
            existing = db.execute(
                "SELECT id FROM user_merchants WHERE user_id=? AND lower(name)=lower(?)",
                (uid, desired_name),
            ).fetchone()
            if existing:
                desired_id = existing[0]
            else:
                desired_id = "c-" + hashlib.sha256(norm(desired_name).encode()).hexdigest()[:32]
                prior = db.execute(
                    "SELECT name FROM user_merchants WHERE user_id=? AND id=?",
                    (uid, desired_id),
                ).fetchone()
                if prior and prior[0] != desired_name:
                    raise SystemExit(f"Merchant ID collision: {desired_name}")
                merchant_records[(uid, desired_id)] = desired_name
        assignments.append((uid, oid, old_id[0], new_id, desired_id, expected_date, row["description"], expected_amount))

    update_statements = []
    for start in range(0, len(assignments), 5):
        chunk = assignments[start : start + 5]
        user_id = chunk[0][0]
        preconditions = " OR ".join(
            f"(e.user_id={uid} AND e.id={sql(oid)} AND e.date={sql(date)} AND e.note={sql(note)} AND e.amount={amount} AND e.category_id={sql(old_id)} AND e.merchant_id IS NULL)"
            for uid, oid, old_id, _, _, date, note, amount in chunk
        )
        operation_ids = ",".join(sql(a[1]) for a in chunk)
        new_categories = " ".join(
            f"WHEN {sql(oid)} THEN {sql(new_id)}"
            for _, oid, _, new_id, *_ in chunk
        )
        new_merchants = " ".join(
            f"WHEN {sql(oid)} THEN {sql(mid)}"
            for _, oid, _, _, mid, *_ in chunk
        )
        update_statements.append(
            "UPDATE expenses SET category_id=CASE id " + new_categories + " END, "
            "merchant_id=CASE id " + new_merchants + " END "
            f"WHERE user_id={user_id} AND id IN ({operation_ids}) "
            f"AND (SELECT count(*) FROM expenses e WHERE {preconditions})={len(chunk)};"
        )
    prefix = args.output_prefix
    prefix.parent.mkdir(parents=True, exist_ok=True)
    merchants_sql = ""
    if merchant_records:
        values = ",".join(
            f"({uid},{sql(mid)},{sql(name)},'[]',0)"
            for (uid, mid), name in merchant_records.items()
        )
        merchants_sql = (
            "INSERT OR IGNORE INTO user_merchants(user_id,id,name,aliases,hidden) VALUES "
            + values
            + ";\n"
        )
    merchants_path = prefix.with_name(prefix.name + "-merchants.sql")
    update_path = prefix.with_name(prefix.name + "-expenses.sql")
    merchants_path.write_text(merchants_sql, "utf-8")
    update_path.write_text("\n".join(update_statements) + "\n", "utf-8")
    print(json.dumps({"operations": len(rows), "users": len(users), "new_user_merchants": len(merchant_records), "merchant_sql": str(merchants_path), "update_sql": str(update_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
