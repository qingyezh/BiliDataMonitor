const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('app/data/monitor.db');
db.exec(`
  CREATE TABLE monitor_tasks_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_type TEXT NOT NULL CHECK(task_type IN ('up','video','dynamic','column')),
    target TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    max_videos INTEGER NOT NULL DEFAULT 0,
    last_run_at INTEGER,
    next_run_at INTEGER,
    last_status TEXT NOT NULL DEFAULT 'never',
    error TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(task_type, target)
  );
  INSERT INTO monitor_tasks_new SELECT * FROM monitor_tasks;
  DROP TABLE monitor_tasks;
  ALTER TABLE monitor_tasks_new RENAME TO monitor_tasks;
`);
console.log('迁移完成');
db.close();
