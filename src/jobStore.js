import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.resolve('data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(JOBS_FILE)) {
    fs.writeFileSync(JOBS_FILE, '[]', 'utf8');
  }
}

export function readJobs() {
  ensureStore();

  const raw = fs.readFileSync(JOBS_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeJobs(jobs) {
  ensureStore();
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), 'utf8');
}

export function appendJobs(newJobs) {
  const currentJobs = readJobs();
  const nextJobs = [...currentJobs, ...newJobs];
  writeJobs(nextJobs);
  return nextJobs;
}

export function replaceJobs(nextJobs) {
  writeJobs(nextJobs);
  return nextJobs;
}

export function updateJobs(updater) {
  const currentJobs = readJobs();
  const nextJobs = updater(currentJobs);
  writeJobs(nextJobs);
  return nextJobs;
}