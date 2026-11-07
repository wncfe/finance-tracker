-- Category-only merge: financial amounts/dates/weeks and expense IDs are untouched.
UPDATE expenses SET category_id='legacy-supermarkets' WHERE category_id='groceries';
DELETE FROM categories WHERE id='groceries';
