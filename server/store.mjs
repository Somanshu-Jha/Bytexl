import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Single-user local storage. Raw uploaded documents never reach the public folder. */
export function createStore(databasePath, { patient, records = [] } = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  const read = value => value ? JSON.parse(value.payload) : undefined;
  const recordGet = db.prepare('SELECT payload FROM records WHERE id = ?');
  const recordPut = db.prepare('INSERT OR REPLACE INTO records(id,payload) VALUES(?,?)');
  const settingGet = db.prepare('SELECT payload FROM settings WHERE id = ?');
  const settingPut = db.prepare('INSERT OR REPLACE INTO settings(id,payload) VALUES(?,?)');
  const jobGet = db.prepare('SELECT payload FROM jobs WHERE id = ?');
  const jobPut = db.prepare('INSERT OR REPLACE INTO jobs(id,payload) VALUES(?,?)');
  const store = {
    getPatient: () => read(settingGet.get('patient')),
    savePatient(value) { settingPut.run('patient', JSON.stringify(value)); return value; },
    listRecords: () => db.prepare('SELECT payload FROM records').all().map(read).sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt)),
    getRecord: id => read(recordGet.get(id)),
    saveRecord(record) { recordPut.run(record.id, JSON.stringify(record)); return record; },
    deleteRecord: id => db.prepare('DELETE FROM records WHERE id = ?').run(id).changes > 0,
    getJob: id => read(jobGet.get(id)),
    saveJob(job) { jobPut.run(job.id, JSON.stringify(job)); return job; },
    reset() {
      db.exec('BEGIN');
      try {
        db.exec('DELETE FROM records; DELETE FROM jobs;');
        if (patient) store.savePatient(structuredClone(patient));
        records.forEach(record => store.saveRecord(structuredClone(record)));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close(),
  };
  if (!store.getPatient() && patient) store.reset();
  for (const job of db.prepare('SELECT payload FROM jobs').all().map(read)) {
    if (job.status === 'processing' || job.status === 'queued') {
      store.saveJob({ ...job, status: 'failed', stage: 'Interrupted', error: 'The local server restarted during processing. Please upload the document again.' });
    }
  }
  return store;
}
