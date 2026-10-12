-- Correct only the eight-hour start-time shift corroborated by model-call timestamps.
UPDATE analysis_jobs AS job
SET started_at = job.started_at - interval '8 hours'
FROM (
  SELECT job_id, min(started_at) AT TIME ZONE 'UTC' AS first_call
  FROM analysis_model_calls
  GROUP BY job_id
) AS calls
WHERE job.id = calls.job_id
  AND job.started_at - calls.first_call BETWEEN interval '7 hours 55 minutes' AND interval '8 hours 5 minutes'
  AND (job.started_at > job.completed_at OR job.started_at > (now() AT TIME ZONE 'UTC'));
