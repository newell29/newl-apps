# Agent Operations: Data model

> Evidence status: Confirmed from code.

No new database table is introduced. The read model merges:

- `AutomationJobRun` for Hunter, Rivet, and Website Scout work;
- `AssistantAutomation` and `AssistantAutomationRun` for Nemo schedules and results;
- `GarlandEmailSyncRun` for Garland Intake;
- `TeamshipDailySyncRun` and `TeamshipBrowserReadJob` for Teamship Reader.

Every source query carries the authenticated `tenantId`. Display IDs are namespaced by source to avoid collisions. A synthetic `SCHEDULE_MONITOR` record is generated only when a database-backed active Nemo automation remains overdue for more than five minutes.
