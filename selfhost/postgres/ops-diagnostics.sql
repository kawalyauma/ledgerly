\pset pager off
\timing off
\echo '== connection pressure =='
SELECT current_setting('max_connections')::int AS max_connections,
       count(*) AS total_connections,
       count(*) FILTER (WHERE state='active') AS active,
       count(*) FILTER (WHERE state='idle in transaction') AS idle_in_transaction
FROM pg_stat_activity;

\echo '== long running queries (> 5s, current session excluded) =='
SELECT pid, usename, application_name, state, wait_event_type, wait_event,
       now()-query_start AS age, left(query,240) AS query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid() AND state <> 'idle' AND query_start < now()-interval '5 seconds'
ORDER BY query_start;

\echo '== blocked / blocking sessions =='
SELECT blocked.pid AS blocked_pid, blocker.pid AS blocker_pid,
       now()-blocked.query_start AS blocked_for,
       left(blocked.query,160) AS blocked_query,
       left(blocker.query,160) AS blocker_query
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocker ON blocker.pid = ANY(pg_blocking_pids(blocked.pid))
ORDER BY blocked.query_start;

\echo '== highest sequential scan tables =='
SELECT schemaname, relname, seq_scan, idx_scan, n_live_tup,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY seq_scan DESC NULLS LAST
LIMIT 30;

\echo '== unused indexes (review before removal; never auto-drop) =='
SELECT schemaname, relname, indexrelname, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 30;

\echo '== dead tuples / vacuum pressure =='
SELECT schemaname, relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 30;

\echo '== pg_stat_statements top total time (when available) =='
DO $$ BEGIN
  IF to_regclass('public.pg_stat_statements') IS NULL THEN
    RAISE NOTICE 'pg_stat_statements view is not available in public schema';
  END IF;
END $$;
SELECT calls, round(total_exec_time::numeric,2) AS total_ms,
       round(mean_exec_time::numeric,2) AS mean_ms, rows,
       left(query,220) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 30;
