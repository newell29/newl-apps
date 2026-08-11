# Agent Operations: Failure modes

> Evidence status: Confirmed from code unless otherwise marked.

- A source with no stored run evidence shows **Not recorded** instead of inventing activity.
- Garland's external cadence is shown as not centrally declared; the page can show its run records but cannot promise a next start time.
- Protected local environment overrides can differ from repository-declared defaults. The page labels those schedules as runtime defaults.
- A worker that never creates a database record cannot provide a specific failure reason. Only database-backed overdue Nemo schedules are marked `MISSED`; their explanation states that no more specific cause was reported.
- Unknown error strings are redacted and truncated. This can remove details an operator would otherwise see in protected local logs.
- Source reads are bounded to 500 rows each and the visible result set is capped at 150 records.
