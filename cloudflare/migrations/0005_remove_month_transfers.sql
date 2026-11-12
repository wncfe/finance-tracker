-- Apply atomically, after backup, with old writers stopped.
CREATE TABLE transfer_months AS
 SELECT user_id,month FROM months WHERE incoming<>0 OR outgoing<>0;
CREATE TABLE transfer_check(valid INTEGER NOT NULL CHECK(valid=1));
INSERT INTO transfer_check
 SELECT CASE WHEN m.budget >= COALESCE((SELECT sum(COALESCE(w.settled,w.limit_amount))
 FROM weeks w WHERE w.user_id=m.user_id AND w.month=m.month AND w.closed=1
 AND (EXISTS(SELECT 1 FROM weeks o WHERE o.user_id=m.user_id AND o.month=m.month AND o.closed=0)
 OR w.week_index < (SELECT max(z.week_index) FROM weeks z WHERE z.user_id=m.user_id AND z.month=m.month))),0)
 THEN 1 ELSE 0 END FROM months m JOIN transfer_months t USING(user_id,month);
CREATE TABLE transfer_limits AS
 WITH allocation AS (
 SELECT w.user_id,w.month,w.week_index,w.days,
 m.budget-COALESCE((SELECT sum(COALESCE(c.settled,c.limit_amount)) FROM weeks c
 WHERE c.user_id=w.user_id AND c.month=w.month AND c.closed=1),0) AS available,
 sum(w.days) OVER(PARTITION BY w.user_id,w.month ORDER BY w.week_index) AS cumulative,
 sum(w.days) OVER(PARTITION BY w.user_id,w.month) AS total
 FROM weeks w JOIN transfer_months t USING(user_id,month) JOIN months m USING(user_id,month)
 WHERE w.closed=0)
 SELECT user_id,month,week_index,
 (available*cumulative/total)-(available*(cumulative-days)/total) AS amount FROM allocation;
UPDATE weeks SET limit_amount=(SELECT amount FROM transfer_limits t
 WHERE t.user_id=weeks.user_id AND t.month=weeks.month AND t.week_index=weeks.week_index)
 WHERE EXISTS(SELECT 1 FROM transfer_limits t WHERE t.user_id=weeks.user_id AND t.month=weeks.month AND t.week_index=weeks.week_index);
UPDATE weeks SET limit_amount=(SELECT m.budget FROM months m WHERE m.user_id=weeks.user_id AND m.month=weeks.month)
 -COALESCE((SELECT sum(COALESCE(c.settled,c.limit_amount)) FROM weeks c WHERE c.user_id=weeks.user_id
 AND c.month=weeks.month AND c.week_index<weeks.week_index),0), settled=NULL
 WHERE EXISTS(SELECT 1 FROM transfer_months t WHERE t.user_id=weeks.user_id AND t.month=weeks.month)
 AND week_index=(SELECT max(z.week_index) FROM weeks z WHERE z.user_id=weeks.user_id AND z.month=weeks.month)
 AND NOT EXISTS(SELECT 1 FROM weeks o WHERE o.user_id=weeks.user_id AND o.month=weeks.month AND o.closed=0);
ALTER TABLE months DROP COLUMN incoming;
ALTER TABLE months DROP COLUMN outgoing;
DROP TABLE transfer_limits;
DROP TABLE transfer_check;
DROP TABLE transfer_months;
