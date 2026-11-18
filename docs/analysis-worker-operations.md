# Analysis worker recovery

The worker removes U+0000 from report text and metadata before writing PostgreSQL
text columns. Source files remain unchanged. Failure messages are bounded and use
the underlying error rather than Drizzle's SQL parameters. Failure handling and
lease cleanup errors are isolated per task; transient polling failures retry after
the configured polling interval.

For automatic restart and startup at login, install the user service (adjust paths
if the repository is not at `~/StockDepth`):

```sh
mkdir -p ~/.config/systemd/user
cp deploy/systemd/stockdepth-analysis.service ~/.config/systemd/user/
./bin/stockdepth stop analysis
systemctl --user daemon-reload
systemctl --user enable --now stockdepth-analysis.service
```

Use `systemctl --user restart stockdepth-analysis` to restart a supervised worker.
Do not start a second worker through the local process manager. Both
`systemctl --user status stockdepth-analysis` and `./bin/stockdepth status analysis`
can check its state. Logs remain in `var/analysis.log`. With user lingering enabled,
the unit also starts at boot without an interactive login.

On startup, the worker reclaims expired running jobs and reads existing runner
results before applying timeouts. Completed runs can therefore synchronize reports
without another model request. Queued resumptions may call the configured models.
New runner launches reset the persisted execution start time, so time spent waiting
in the queue does not exhaust the new attempt's timeout. Reattaching to a running
process keeps its existing deadline.

Run the regression test from the repository root:

```sh
apps/workers/node_modules/.bin/tsx scripts/tests/worker-resilience.ts
```

With `POSTGRES_URL` set, append `--database` to verify actual PostgreSQL rejection
and sanitized writes using only a session-local temporary table.
